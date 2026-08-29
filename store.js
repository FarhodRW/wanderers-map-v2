// ============================================================
//  store.js — permanent storage (MongoDB Atlas)
//  The server loads this only if present; if MONGO_URL is unset
//  or the connection fails, the server keeps running in memory.
// ============================================================

let trips = null;       // trips collection
let profiles = null;    // profiles collection
let messages = null;    // messages collection
let places = null;      // saved places collection
let ready = false;

async function init(mongoUrl) {
  if (!mongoUrl) { console.log('  storage: MONGO_URL not set — memory only'); return; }
  try {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    const db = client.db('wanderers');
    trips = db.collection('trips');
    profiles = db.collection('profiles');
    messages = db.collection('messages');
    places = db.collection('places');
    await trips.createIndex({ ownerId: 1, startedAt: -1 });
    await profiles.createIndex({ ownerId: 1 }, { unique: true });
    await places.createIndex({ ownerId: 1, createdAt: -1 });
    // pair = the two ids sorted and joined, so both directions share one thread
    await messages.createIndex({ pair: 1, ts: 1 });
    await messages.createIndex({ to: 1, read: 1 });
    ready = true;
    console.log('  storage: connected to MongoDB — trips & profiles are permanent ✓');
  } catch (e) {
    console.error('  storage: MongoDB connection failed —', e.message);
    trips = null; profiles = null; messages = null; places = null; ready = false;
  }
}

// ---- trips ----
async function saveTrip(trip) {
  if (!ready || !trips) { trip._id = 'mem-' + Date.now(); return trip; }
  const res = await trips.insertOne(trip);
  trip._id = res.insertedId;
  return trip;
}
async function listTrips(ownerId, limit = 50) {
  if (!ready || !trips) return [];
  return trips.find({ ownerId: String(ownerId) }).sort({ startedAt: -1 }).limit(limit).toArray();
}
async function getTrip(id, ownerId) {
  if (!ready || !trips) return null;
  const { ObjectId } = require('mongodb');
  let _id; try { _id = new ObjectId(id); } catch { return null; }
  return trips.findOne({ _id, ownerId: String(ownerId) });
}
async function deleteTrip(id, ownerId) {
  if (!ready || !trips) return false;
  const { ObjectId } = require('mongodb');
  let _id; try { _id = new ObjectId(id); } catch { return false; }
  const r = await trips.deleteOne({ _id, ownerId: String(ownerId) });
  return r.deletedCount > 0;
}

// ---- profiles ----
async function saveProfile(ownerId, name, photo, status) {
  const doc = {
    ownerId: String(ownerId),
    name: String(name || 'Wanderer').slice(0, 24),
    photo: (typeof photo === 'string' && photo.length < 60000) ? photo : null,
    status: (typeof status === 'string') ? status.slice(0, 40) : '',
    updatedAt: Date.now()
  };
  if (!ready || !profiles) return doc;
  await profiles.updateOne({ ownerId: doc.ownerId }, { $set: doc }, { upsert: true });
  return doc;
}
async function getProfiles(ownerIds) {
  const ids = [...new Set((ownerIds || []).map(String))].slice(0, 100);
  const out = {};
  if (!ready || !profiles) return out;
  const docs = await profiles.find({ ownerId: { $in: ids } }).toArray();
  for (const d of docs) out[d.ownerId] = { name: d.name, photo: d.photo, status: d.status };
  return out;
}

// ---- messages ----
// A "pair" key makes both directions (A→B and B→A) land in one thread.
function pairKey(a, b) { return [String(a), String(b)].sort().join('__'); }

// In-memory fallback so chat still works with no Mongo (lost on restart).
const memMsgs = [];

async function saveMessage(from, to, text) {
  const doc = {
    pair: pairKey(from, to),
    from: String(from), to: String(to),
    text: String(text || '').slice(0, 2000),
    ts: Date.now(), read: false
  };
  if (!ready || !messages) { doc._id = 'mem-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); memMsgs.push(doc); return doc; }
  const res = await messages.insertOne(doc);
  doc._id = res.insertedId;
  return doc;
}

// Full conversation between two people, oldest first.
async function getThread(a, b, limit = 500) {
  const key = pairKey(a, b);
  if (!ready || !messages) return memMsgs.filter(m => m.pair === key).slice(-limit);
  return messages.find({ pair: key }).sort({ ts: 1 }).limit(limit).toArray();
}

// One row per conversation for `me`: the other person, last message, unread count.
async function getOverview(me) {
  me = String(me);
  let rows;
  if (!ready || !messages) {
    rows = memMsgs.filter(m => m.from === me || m.to === me);
  } else {
    rows = await messages.find({ $or: [{ from: me }, { to: me }] }).sort({ ts: 1 }).toArray();
  }
  const threads = new Map();
  for (const m of rows) {
    const other = m.from === me ? m.to : m.from;
    let t = threads.get(other);
    if (!t) { t = { with: other, lastText: '', lastTs: 0, lastFrom: '', unread: 0 }; threads.set(other, t); }
    if (m.ts >= t.lastTs) { t.lastText = m.text; t.lastTs = m.ts; t.lastFrom = m.from; }
    if (m.to === me && !m.read) t.unread++;
  }
  return [...threads.values()].sort((x, y) => y.lastTs - x.lastTs);
}

// Total unread across all threads (for the top-left badge).
async function unreadCount(me) {
  me = String(me);
  if (!ready || !messages) return memMsgs.filter(m => m.to === me && !m.read).length;
  return messages.countDocuments({ to: me, read: false });
}

// Mark everything `from`→`me` as read (call when the thread is opened).
async function markRead(me, from) {
  me = String(me); from = String(from);
  if (!ready || !messages) { memMsgs.forEach(m => { if (m.to === me && m.from === from) m.read = true; }); return; }
  await messages.updateMany({ to: me, from, read: false }, { $set: { read: true } });
}

// ---- saved places ----
const memPlaces = [];
function pid() { return 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

async function savePlace(ownerId, place) {
  const doc = {
    _id: place.id || pid(),
    ownerId: String(ownerId),
    name: String(place.name || 'Place').slice(0, 80),
    label: ['home', 'work', 'star'].includes(place.label) ? place.label : 'star',
    lat: Number(place.lat), lon: Number(place.lon),
    createdAt: Date.now()
  };
  if (!ready || !places) {
    const i = memPlaces.findIndex(p => p._id === doc._id && p.ownerId === doc.ownerId);
    if (i >= 0) memPlaces[i] = doc; else memPlaces.push(doc);
    return doc;
  }
  await places.replaceOne({ _id: doc._id }, doc, { upsert: true });
  return doc;
}

async function listPlaces(ownerId) {
  ownerId = String(ownerId);
  if (!ready || !places) return memPlaces.filter(p => p.ownerId === ownerId).sort((a, b) => b.createdAt - a.createdAt);
  return places.find({ ownerId }).sort({ createdAt: -1 }).toArray();
}

async function deletePlace(ownerId, id) {
  ownerId = String(ownerId); id = String(id);
  if (!ready || !places) { const i = memPlaces.findIndex(p => p._id === id && p.ownerId === ownerId); if (i >= 0) memPlaces.splice(i, 1); return; }
  await places.deleteOne({ _id: id, ownerId });
}

module.exports = {
  init, saveTrip, listTrips, getTrip, deleteTrip, saveProfile, getProfiles,
  saveMessage, getThread, getOverview, unreadCount, markRead,
  savePlace, listPlaces, deletePlace
};
