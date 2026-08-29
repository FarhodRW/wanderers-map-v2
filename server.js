// ============================================================
//  The Wanderers' Map — server (v2, clean rebuild)
//  Zero-dependency core; MongoDB optional for permanence.
//  Node 18+.
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');

let store = null;               // optional Mongo-backed store
try { store = require('./store'); } catch (_) { store = null; }

const CONFIG = {
  PORT: Number(process.env.PORT) || 3000,
  STALE_MINUTES: 12,            // drop a wanderer after this silence
  TRAIL_MINUTES: 120,
  TRAIL_MAX_POINTS: 400,
  MONGO_URL: process.env.MONGO_URL || ''
};

// ---------- geometry ----------
function metres(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * 111320;
  const dLon = (bLon - aLon) * 111320 * Math.cos(aLat * Math.PI / 180);
  return Math.hypot(dLat, dLon);
}

// ---------- live state (in memory) ----------
// id -> { name, lat, lon, ts, speed, gspeed, heading, battery, status, circles, settledCount, trail }
const people = new Map();
// id -> active trip
const activeTrips = new Map();

function recordPosition(d) {
  const id = String(d.id);
  const now = Date.now();
  const old = people.get(id);
  const trail = old ? old.trail : [];

  // stillness filter: converge on fresh fixes, then hold against jitter
  if (old) {
    const move = metres(old.lat, old.lon, d.lat, d.lon);
    const settled = (old.settledCount || 0) >= 3;
    if (move < 4 && settled) {
      old.ts = now; old.speed = 0; old.gspeed = 0;
      old.settledCount = (old.settledCount || 0) + 1;
      Object.assign(old, pick(d));
      feedTrip(id, old);
      return old;
    }
    old.settledCount = (move < 15) ? (old.settledCount || 0) + 1 : 0;
  }

  let speed = 0;
  if (old) {
    const dt = (now - old.ts) / 1000;
    const dd = metres(old.lat, old.lon, d.lat, d.lon);
    if (dt > 0.5 && dd > 5) {
      const kmh = (dd / dt) * 3.6;
      if (kmh < 300) speed = kmh;
    }
  }

  if (CONFIG.TRAIL_MINUTES > 0) {
    const last = trail[trail.length - 1];
    if (!last || metres(last.lat, last.lon, d.lat, d.lon) > 10) trail.push({ lat: d.lat, lon: d.lon, ts: now });
    const cutoff = now - CONFIG.TRAIL_MINUTES * 60 * 1000;
    while (trail.length && (trail[0].ts < cutoff || trail.length > CONFIG.TRAIL_MAX_POINTS)) trail.shift();
  }

  const entry = {
    name: String(d.name || 'Wanderer').slice(0, 24),
    lat: d.lat, lon: d.lon, ts: now,
    speed,
    gspeed: (typeof d.gspeed === 'number') ? d.gspeed : null,
    heading: (typeof d.heading === 'number') ? d.heading : (old ? old.heading : null),
    battery: (typeof d.battery === 'number') ? d.battery : (old ? old.battery : null),
    status: (typeof d.status === 'string') ? d.status.slice(0, 40) : (old ? old.status : ''),
    circles: Array.isArray(d.circles) ? d.circles.map(String).slice(0, 20) : (old ? old.circles : []),
    settledCount: old ? old.settledCount : 0,
    trail
  };
  people.set(id, entry);
  feedTrip(id, entry);
  return entry;
}

function pick(d) {
  const o = {};
  if (typeof d.gspeed === 'number') o.gspeed = d.gspeed;
  if (typeof d.heading === 'number') o.heading = d.heading;
  if (typeof d.battery === 'number') o.battery = d.battery;
  if (typeof d.status === 'string') o.status = d.status.slice(0, 40);
  if (Array.isArray(d.circles)) o.circles = d.circles.map(String).slice(0, 20);
  return o;
}

// effective km/h preferring device speed
function kmh(p) {
  return Math.round(((typeof p.gspeed === 'number' ? p.gspeed * 3.6 : p.speed) || 0) * 10) / 10;
}

// ---------- trips ----------
function feedTrip(id, p) {
  const t = activeTrips.get(id);
  if (!t) return;
  const now = Date.now();
  if (t.lastLat != null) {
    const d = metres(t.lastLat, t.lastLon, p.lat, p.lon);
    if (d > 4) { t.distanceM += d; t.route.push([p.lat, p.lon]); t.movingMs += now - t.lastTs; }
    else { t.stoppedMs += now - t.lastTs; }
  } else t.route.push([p.lat, p.lon]);
  const sp = kmh(p);
  if (sp > t.topKmh && sp < 300) t.topKmh = sp;
  if (sp > 2 && (t.lowKmh === null || sp < t.lowKmh)) t.lowKmh = sp;  // lowest *moving* speed
  t.lastLat = p.lat; t.lastLon = p.lon; t.lastTs = now; t.name = p.name;
}

// ---------- visibility by circle ----------
function visibleTo(viewerCircles) {
  const now = Date.now();
  const staleMs = CONFIG.STALE_MINUTES * 60 * 1000;
  const vc = Array.isArray(viewerCircles) ? viewerCircles : [];
  const out = [];
  for (const [id, p] of people) {
    if (now - p.ts > staleMs) { people.delete(id); continue; }
    const pc = p.circles || [];
    const visible = (vc.length === 0 && pc.length === 0) ? true : pc.some(c => vc.includes(c));
    if (!visible) continue;
    out.push({
      id, name: p.name, lat: p.lat, lon: p.lon,
      speed: kmh(p),
      heading: (typeof p.heading === 'number') ? Math.round(p.heading) : null,
      battery: (typeof p.battery === 'number') ? p.battery : null,
      status: p.status || '',
      ageSec: Math.round((now - p.ts) / 1000),
      trail: (p.trail || []).map(q => [Math.round(q.lat * 1e5) / 1e5, Math.round(q.lon * 1e5) / 1e5, Math.round((now - q.ts) / 1000)])
    });
  }
  return out;
}

// ---------- SSE ----------
const clients = new Set();  // { res, circles, id }
function broadcast() {
  for (const c of clients) {
    try { c.res.write(`data: ${JSON.stringify({ friends: visibleTo(c.circles) })}\n\n`); }
    catch (_) { clients.delete(c); }
  }
}
setInterval(broadcast, 5000);

// Push an arbitrary event down the SSE stream(s) belonging to one user.
// Used for live message delivery so the recipient sees it without polling.
function pushToUser(id, payload) {
  id = String(id);
  for (const c of clients) {
    if (c.id !== id) continue;
    try { c.res.write(`data: ${JSON.stringify(payload)}\n\n`); }
    catch (_) { clients.delete(c); }
  }
}

// ---------- http ----------
function readBody(req, cb, max) {
  const limit = max || 8000; let b = '';
  req.on('data', c => { b += c; if (b.length > limit) req.destroy(); });
  req.on('end', () => cb(b));
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const qs = new URL(req.url, 'http://x').searchParams;
  const circles = (qs.get('circles') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);

  if (url === '/positions') return json(res, 200, { friends: visibleTo(circles) });

  if (url === '/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive' });
    res.write(`data: ${JSON.stringify({ friends: visibleTo(circles) })}\n\n`);
    const c = { res, circles, id: String(qs.get('id') || '') }; clients.add(c);
    req.on('close', () => clients.delete(c));
    return;
  }

  if (req.method === 'POST' && url === '/update') {
    return readBody(req, body => {
      try {
        const d = JSON.parse(body);
        if (typeof d.lat !== 'number' || typeof d.lon !== 'number' || !d.id) throw new Error('bad data');
        recordPosition(d);
        broadcast();
        json(res, 200, { ok: true });
      } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    }, 4000);
  }

  if (req.method === 'POST' && url === '/leave') {
    return readBody(req, body => {
      try { const d = JSON.parse(body); people.delete(String(d.id)); broadcast(); } catch (_) {}
      json(res, 200, { ok: true });
    });
  }

  // ---- trips ----
  if (req.method === 'POST' && url === '/trip/start') {
    return readBody(req, body => {
      try {
        const d = JSON.parse(body); if (!d.id) throw new Error('no id');
        activeTrips.set(String(d.id), {
          name: String(d.name || 'Wanderer').slice(0, 24),
          startedAt: Date.now(), route: [], distanceM: 0,
          topKmh: 0, lowKmh: null, movingMs: 0, stoppedMs: 0,
          lastLat: null, lastLon: null, lastTs: Date.now()
        });
        json(res, 200, { ok: true });
      } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    });
  }
  if (url === '/trip/live') {
    const t = activeTrips.get(String(qs.get('id')));
    if (!t) return json(res, 200, { active: false });
    const dur = (Date.now() - t.startedAt) / 1000;
    return json(res, 200, {
      active: true, distanceM: Math.round(t.distanceM), durationSec: Math.round(dur),
      avgKmh: dur > 0 ? Math.round((t.distanceM / dur) * 3.6 * 10) / 10 : 0,
      topKmh: Math.round(t.topKmh * 10) / 10,
      lowKmh: t.lowKmh === null ? 0 : Math.round(t.lowKmh * 10) / 10,
      movingSec: Math.round(t.movingMs / 1000), stoppedSec: Math.round(t.stoppedMs / 1000)
    });
  }
  if (req.method === 'POST' && url === '/trip/end') {
    return readBody(req, async body => {
      try {
        const d = JSON.parse(body); const id = String(d.id);
        const t = activeTrips.get(id);
        if (!t) return json(res, 200, { ok: true, trip: null });
        activeTrips.delete(id);
        const endedAt = Date.now(); const dur = (endedAt - t.startedAt) / 1000;
        const trip = {
          ownerId: id, name: t.name, startedAt: t.startedAt, endedAt,
          distanceM: Math.round(t.distanceM), durationSec: Math.round(dur),
          avgKmh: dur > 0 ? Math.round((t.distanceM / dur) * 3.6 * 10) / 10 : 0,
          topKmh: Math.round(t.topKmh * 10) / 10, lowKmh: t.lowKmh === null ? 0 : Math.round(t.lowKmh * 10) / 10,
          movingSec: Math.round(t.movingMs / 1000), stoppedSec: Math.round(t.stoppedMs / 1000),
          route: t.route.map(p => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5])
        };
        const saved = store ? await store.saveTrip(trip) : (trip._id = 'mem-' + Date.now(), trip);
        json(res, 200, { ok: true, trip: saved });
      } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    });
  }
  if (url === '/trip/list') {
    const id = qs.get('id'); if (!id) return json(res, 400, { ok: false });
    if (!store) return json(res, 200, { ok: true, trips: [] });
    return store.listTrips(String(id)).then(t => json(res, 200, { ok: true, trips: t })).catch(e => json(res, 500, { ok: false, error: e.message }));
  }

  // ---- profiles ----
  if (req.method === 'POST' && url === '/profile/save') {
    return readBody(req, async body => {
      try {
        const d = JSON.parse(body); if (!d.id) throw new Error('no id');
        if (store) await store.saveProfile(String(d.id), d.name, d.photo, d.status);
        else memProfiles[String(d.id)] = { name: d.name, photo: d.photo, status: d.status };
        json(res, 200, { ok: true });
      } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    }, 200000);
  }
  if (url === '/profile/many') {
    const ids = (qs.get('ids') || '').split(',').filter(Boolean);
    if (store) return store.getProfiles(ids).then(m => json(res, 200, { ok: true, profiles: m })).catch(e => json(res, 500, { ok: false }));
    const out = {}; for (const i of ids) if (memProfiles[i]) out[i] = memProfiles[i];
    return json(res, 200, { ok: true, profiles: out });
  }

  // ---- messages ----
  if (req.method === 'POST' && url === '/msg/send') {
    return readBody(req, async body => {
      try {
        const d = JSON.parse(body);
        const from = String(d.from || ''), to = String(d.to || '');
        const text = String(d.text || '').trim();
        if (!from || !to || !text) throw new Error('from, to and text required');
        if (from === to) throw new Error('cannot message yourself');
        const msg = store
          ? await store.saveMessage(from, to, text)
          : { _id: 'mem-' + Date.now(), pair: [from, to].sort().join('__'), from, to, text: text.slice(0, 2000), ts: Date.now(), read: false };
        // live-deliver to the recipient (and echo to the sender's other tabs)
        pushToUser(to, { type: 'msg', msg });
        pushToUser(from, { type: 'msg', msg });
        json(res, 200, { ok: true, msg });
      } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    }, 5000);
  }
  if (url === '/msg/thread') {
    const me = qs.get('me'), other = qs.get('with');
    if (!me || !other) return json(res, 400, { ok: false, error: 'me and with required' });
    if (!store) return json(res, 200, { ok: true, messages: [] });
    return store.getThread(me, other)
      .then(m => json(res, 200, { ok: true, messages: m }))
      .catch(e => json(res, 500, { ok: false, error: e.message }));
  }
  if (url === '/msg/overview') {
    const me = qs.get('me');
    if (!me) return json(res, 400, { ok: false });
    if (!store) return json(res, 200, { ok: true, threads: [], unread: 0 });
    return Promise.all([store.getOverview(me), store.unreadCount(me)])
      .then(([threads, unread]) => json(res, 200, { ok: true, threads, unread }))
      .catch(e => json(res, 500, { ok: false, error: e.message }));
  }
  if (req.method === 'POST' && url === '/msg/read') {
    return readBody(req, async body => {
      try {
        const d = JSON.parse(body);
        const me = String(d.me || ''), from = String(d.from || '');
        if (!me || !from) throw new Error('me and from required');
        if (store) await store.markRead(me, from);
        json(res, 200, { ok: true });
      } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    });
  }

  // ---- saved places ----
  if (req.method === 'POST' && url === '/places/save') {
    return readBody(req, async body => {
      try {
        const d = JSON.parse(body);
        const owner = String(d.ownerId || '');
        if (!owner || d.lat == null || d.lon == null) throw new Error('ownerId, lat, lon required');
        const saved = store ? await store.savePlace(owner, d) : { ...d, _id: 'mem' };
        json(res, 200, { ok: true, place: saved });
      } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    });
  }
  if (url === '/places/list') {
    const owner = qs.get('ownerId');
    if (!owner) return json(res, 400, { ok: false });
    if (!store) return json(res, 200, { ok: true, places: [] });
    return store.listPlaces(owner)
      .then(p => json(res, 200, { ok: true, places: p }))
      .catch(e => json(res, 500, { ok: false, error: e.message }));
  }
  if (req.method === 'POST' && url === '/places/delete') {
    return readBody(req, async body => {
      try {
        const d = JSON.parse(body);
        if (!d.ownerId || !d.id) throw new Error('ownerId and id required');
        if (store) await store.deletePlace(d.ownerId, d.id);
        json(res, 200, { ok: true });
      } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    });
  }

  // static
  const file = url === '/' ? '/index.html' : url;
  const fp = path.join(__dirname, 'public', path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
});

const memProfiles = {};

server.listen(CONFIG.PORT, () => {
  console.log(`\nThe Wanderers' Map (v2) live on :${CONFIG.PORT}`);
  console.log(store ? '  storage: module loaded' : '  storage: in-memory only');
});

if (store && CONFIG.MONGO_URL) store.init(CONFIG.MONGO_URL);
