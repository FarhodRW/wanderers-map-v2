(function(){
  "use strict";

  // ---------- theme ----------
  const root=document.documentElement;
  let mapReady=false;   // becomes true once the map + tiles exist
  let followMode=false; // map follows me while navigating / free-roaming
  const savedTheme=localStorage.getItem('wm_theme'); if(savedTheme) root.setAttribute('data-theme',savedTheme);
  function applyThemeUI(){
    const t=root.getAttribute('data-theme');
    const tv=document.getElementById('themeVal'); if(tv) tv.textContent = t==='dark'?'Dark':'Light';
    if(mapReady) applyTiles();
  }
  document.getElementById('themeRow').onclick=()=>{
    const next=root.getAttribute('data-theme')==='dark'?'light':'dark';
    root.setAttribute('data-theme',next); localStorage.setItem('wm_theme',next); applyThemeUI();
  };

  // ---------- identity ----------
  let myId=localStorage.getItem('wm_id');
  if(!myId){ myId='w-'+Math.random().toString(36).slice(2)+Date.now().toString(36); localStorage.setItem('wm_id',myId); }
  let myName=localStorage.getItem('wm_name')||'';
  let myPhoto=localStorage.getItem('wm_photo')||'';
  let myStatus=localStorage.getItem('wm_status')||'';
  // Groups replace the old single "circle". Each group = {id, name}. The id is the
  // code the visibility engine matches on; name is a friendly label. Multiple allowed.
  let myGroups=[];
  try{ myGroups=JSON.parse(localStorage.getItem('wm_groups')||'[]'); }catch(_){ myGroups=[]; }
  if(!Array.isArray(myGroups)) myGroups=[];
  // migrate an old single circle into the groups list, once
  const _oldCircle=localStorage.getItem('wm_circle')||'';
  if(_oldCircle && !myGroups.some(g=>g.id===_oldCircle)){
    myGroups.push({id:_oldCircle,name:_oldCircle});
    localStorage.setItem('wm_groups',JSON.stringify(myGroups));
    localStorage.removeItem('wm_circle');
  }
  const groupIds=()=>myGroups.map(g=>g.id);
  function saveGroups(){ localStorage.setItem('wm_groups',JSON.stringify(myGroups)); }
  // register my membership for every group I'm in (covers groups joined before
  // rosters existed, and refreshes my name/photo). Runs once at startup.
  function syncMembership(){
    myGroups.forEach(g=>fetch('/group/join',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({code:g.id,id:myId,name:myName,groupName:g.name})}).catch(()=>{}));
  }

  function initials(n){ n=(n||'').trim(); return n?n[0].toUpperCase():'?'; }

  // reflect identity into the various avatar/name slots
  function paintIdentity(){
    // top-right profile buttons
    ['profImg','profImg2','profImg3'].forEach(id=>{const e=document.getElementById(id); if(!e)return; if(myPhoto){e.src=myPhoto;e.style.display='block';}else e.style.display='none';});
    ['profIni','profIni2','profIni3'].forEach(id=>{const e=document.getElementById(id); if(!e)return; e.style.display=myPhoto?'none':'block'; e.textContent=initials(myName);});
    // profile page hero
    const pImg=document.getElementById('profAvImg'),pIni=document.getElementById('profAvIni');
    if(myPhoto){pImg.src=myPhoto;pImg.style.display='block';pIni.style.display='none';}else{pImg.style.display='none';pIni.style.display='flex';pIni.textContent=initials(myName);}
    document.getElementById('profName').textContent = myName || 'Set your name';
    document.getElementById('statusInput').value = myStatus;
    renderGroups();
  }
  paintIdentity(); applyThemeUI();

  // ---------- tabs ----------
  const pages={map:document.getElementById('page-map'),friends:document.getElementById('page-friends'),trips:document.getElementById('page-trips'),profile:document.getElementById('page-profile'),summary:document.getElementById('page-summary'),messages:document.getElementById('page-messages')};
  function showTab(name){
    for(const k in pages) pages[k].classList.toggle('active', k===name);
    document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));
    if(name==='map' && map) setTimeout(()=>map.invalidateSize(),50);
  }
  document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>showTab(t.dataset.tab));
  // profile & messages open from corners
  ['profBtn','profBtn2'].forEach(id=>{const e=document.getElementById(id);if(e)e.onclick=()=>showTab('profile');});
  ['msgBtn','msgBtn2','msgBtn3'].forEach(id=>{const e=document.getElementById(id);if(e)e.onclick=()=>openMessages();});

  // ---------- map ----------
  const map=L.map('map',{zoomControl:false,attributionControl:true}).setView([41.0,71.67],14);
  const TILES={
    light:{url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',attribution:'&copy; OpenStreetMap',sub:'abc'},
    dark:{url:'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',attribution:'&copy; OpenStreetMap &copy; CARTO',sub:'abcd'}
  };
  let tileLayer=null;
  function applyTiles(){
    const theme=root.getAttribute('data-theme')==='dark'?'dark':'light';
    if(tileLayer) map.removeLayer(tileLayer);
    const t=TILES[theme];
    tileLayer=L.tileLayer(t.url,{maxZoom:19,attribution:t.attribution,subdomains:t.sub}).addTo(map);
  }
  applyTiles();
  mapReady=true;
  // ensure the map sizes correctly once laid out
  setTimeout(()=>map.invalidateSize(),200);
  window.addEventListener('load',()=>map.invalidateSize());

  const circleQS = groupIds().length ? ('?circles='+encodeURIComponent(groupIds().join(','))) : '';

  // ---------- people & photos ----------
  const people=new Map();     // id -> {marker,lat,lon,tLat,tLon,data,stepAcc,side,_plat,_plon}
  const photoCache=new Map();
  photoCache.set(myId, myPhoto||null);

  function avInner(id,name){ const p=photoCache.get(id); return p?`<img src="${p}">`:`<div class="ini">${initials(name)}</div>`; }

  function makeMarker(f){
    const el=L.divIcon({className:'wm',iconSize:[56,64],html:
      `<div class="avatar-arrow" data-id="${f.id}">
        <div class="aa-arrow"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 4 22l8-5 8 5z"/></svg></div>
        <div class="aa-ring">${avInner(f.id,f.name)}</div>
      </div>`});
    const m=L.marker([f.lat,f.lon],{icon:el,keyboard:false}).addTo(map);
    m.on('click',()=>openFriendCard(f.id));
    return m;
  }

  async function ensurePhotos(ids){
    const missing=ids.filter(i=>i&&!photoCache.has(i));
    if(!missing.length) return;
    try{
      const r=await fetch('/profile/many?ids='+encodeURIComponent(missing.join(',')),{cache:'no-store'});
      const d=await r.json(); let changed=false;
      for(const id of missing){ const ph=d.profiles&&d.profiles[id]&&d.profiles[id].photo; photoCache.set(id,ph||null); if(ph)changed=true; }
      if(changed){ for(const[id,p]of people){const ring=p.marker.getElement()?.querySelector('.aa-ring'); if(ring)ring.innerHTML=avInner(id,p.data.name);} renderFriends(); }
    }catch(_){}
  }

  function metres(aLat,aLon,bLat,bLon){const dLat=(bLat-aLat)*111320,dLon=(bLon-aLon)*111320*Math.cos(aLat*Math.PI/180);return Math.hypot(dLat,dLon);}
  function fmtDist(m){return m<1000?Math.round(m)+' m':(m/1000).toFixed(1)+' km';}
  function myPos(){const me=people.get(myId);return me?[me.lat,me.lon]:null;}

  // ---------- incoming data ----------
  let centred=false;
  function handle(data){
    const ids=data.friends.map(f=>f.id); ensurePhotos(ids);
    const seen=new Set();
    for(const f of data.friends){
      seen.add(f.id);
      let p=people.get(f.id);
      if(!p){ p={marker:makeMarker(f),lat:f.lat,lon:f.lon,tLat:f.lat,tLon:f.lon,data:f,stepAcc:0,side:1}; people.set(f.id,p); }
      else{ const jump=metres(p.tLat,p.tLon,f.lat,f.lon); if(jump>2||(f.speed||0)>0.5){p.tLat=f.lat;p.tLon=f.lon;} p.data=f; }
      if(f.heading!=null){const a=p.marker.getElement()?.querySelector('.aa-arrow'); if(a)a.style.transform=`translateX(-50%) rotate(${f.heading}deg)`;}
    }
    for(const[id,p]of people){ if(!seen.has(id)){ map.removeLayer(p.marker); people.delete(id); } }
    if(!centred && people.has(myId)){ const me=people.get(myId); map.setView([me.lat,me.lon],16,{animate:true}); centred=true;
      // if the route sheet is open waiting for my location, fetch routes now
      if(destination && routeSheet.classList.contains('on') && !routeData[curMode]) fetchAllModes();
    }
    renderFriends();
    if(openCardId) renderFriendCard(openCardId);
  }

  // ---------- glide + footsteps ----------
  let _followCounter=0;
  function animate(){
    for(const[id,p]of people){
      p.lat+=(p.tLat-p.lat)*0.30; p.lon+=(p.tLon-p.lon)*0.30;
      p.marker.setLatLng([p.lat,p.lon]);
      const moved=metres(p.lat,p.lon,p._plat??p.lat,p._plon??p.lon);
      const driving=(p.data.speed||0)>12;
      p.stepAcc+=moved;
      if(p.stepAcc>(driving?32:9)){ p.stepAcc=0; p.side*=-1; dropStep(p.lat,p.lon,p.data.heading||0,p.side,driving); }
      p._plat=p.lat; p._plon=p.lon;
    }
    // follow mode: keep the map centered on me while navigating / free-roaming
    if(followMode && (++_followCounter%8===0)){
      const me=people.get(myId);
      if(me) map.panTo([me.lat,me.lon],{animate:true,duration:.6});
    }
    requestAnimationFrame(animate);
  }
  function dropStep(lat,lon,heading,side,driving){
    const offLat=Math.cos((heading+90)*Math.PI/180)*0.00003*side, offLon=Math.sin((heading+90)*Math.PI/180)*0.00003*side;
    const s=driving?1:(0.9+Math.random()*0.2), rot=heading+(driving?0:(Math.random()*14-7));
    const ink=getComputedStyle(root).getPropertyValue('--ink').trim()||'#2C2620';
    const body=driving?`<rect x='5' y='2' width='6' height='16' rx='3' fill='${ink}'/>`
      :`<path d='M8 1 C10.6 1.2 11.8 4 11.4 6.6 C11 9 9.6 10.8 8 11 C6.2 10.8 4.2 9 3.8 6.6 C3.4 4 5.4 1.2 8 1 Z' fill='${ink}'/><ellipse cx='8' cy='16' rx='2.6' ry='3' fill='${ink}'/>`;
    const svg=encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 20'>${body}</svg>`);
    const icon=L.divIcon({className:'fp',iconSize:[16,20],html:`<img style="width:${(16*s).toFixed(0)}px;height:${(20*s).toFixed(0)}px;transform:rotate(${rot}deg)" src="data:image/svg+xml,${svg}">`});
    const m=L.marker([lat+offLat,lon+offLon],{icon,interactive:false,keyboard:false}).addTo(map);
    const el=m.getElement()?.querySelector('img');
    if(el)el.animate([{opacity:0,filter:'blur(2px)'},{opacity:.85,filter:'blur(0)',offset:.15},{opacity:.7,offset:.5},{opacity:0,filter:'blur(1px)'}],{duration:8000,easing:'ease-out'});
    setTimeout(()=>map.removeLayer(m),8000);
  }

  // ---------- friends list ----------
  const friendList=document.getElementById('friendList'), onlineCount=document.getElementById('onlineCount');
  function renderFriends(){
    const all=[...people.values()].map(p=>p.data);
    const online=all.filter(f=>f.ageSec<90);
    onlineCount.innerHTML=`<span class="d"></span>${online.length} online`;
    const mp=myPos();
    if(!all.length){ friendList.innerHTML=`<div class="empty">No one is sharing yet.<br>Invite friends to a group so they appear here.</div>`; return; }
    friendList.innerHTML=all.map(f=>{
      const isMe=f.id===myId;
      const on=f.ageSec<90;
      const moving=(f.speed||0)>3;
      const dist=isMe?'you':(mp?fmtDist(metres(mp[0],mp[1],f.lat,f.lon)):'—');
      const statusLine=f.status?`<div class="fstat">${esc(f.status)}</div>`:'';
      const sub=isMe?'this is you':(moving?'Moving':(on?'Nearby':`Last seen ${Math.round(f.ageSec/60)} min ago`));
      return `<div class="frow" data-id="${f.id}">
        <div class="fav">${avInner(f.id,f.name)}<span class="livedot ${on?'on':'off'}"></span></div>
        <div class="fmeta"><div class="fn">${isMe?'You':esc(f.name)}</div>${statusLine}<div class="fsub">${esc(sub)}</div></div>
        <div class="fnums">
          <div class="fnum"><b>${moving?Math.round(f.speed):'—'}</b><span>${moving?'km/h':'Speed'}</span></div>
          <div class="fnum"><b>${dist}</b><span>${isMe?'':'from me'}</span></div>
          <div class="fnum"><b>${f.battery!=null?f.battery+'%':'—'}</b><span>Battery</span></div>
        </div>
      </div>`;
    }).join('');
    friendList.querySelectorAll('.frow').forEach(el=>el.onclick=()=>{ showTab('map'); const p=people.get(el.dataset.id); if(p) map.setView([p.lat,p.lon],16,{animate:true}); openFriendCard(el.dataset.id); });
  }
  function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');}

  // ---------- friend detail sheet (mockup img 7) ----------
  let openCardId=null, pathMap=null, pathLayer=null;
  const fsheet=document.getElementById('fsheet'), fsheetScrim=document.getElementById('fsheetScrim');
  function openFriendCard(id){
    if(id===myId) return;           // tapping yourself doesn't open a card
    openCardId=id; renderFriendCard(id);
    fsheet.classList.add('on'); fsheetScrim.classList.add('on');
    setTimeout(initPathMap,320);
  }
  function closeFriendCard(){ openCardId=null; fsheet.classList.remove('on'); fsheetScrim.classList.remove('on'); }
  document.getElementById('fsheetClose').onclick=closeFriendCard;
  fsheetScrim.onclick=closeFriendCard;

  function avBig(id,name){ const p=photoCache.get(id); return p?`<img src="${p}">`:`<div class="ini">${initials(name)}</div>`; }

  function renderFriendCard(id){
    const p=people.get(id); if(!p){ closeFriendCard(); return; } const f=p.data;
    const mp=myPos(); const dist=mp?metres(mp[0],mp[1],f.lat,f.lon):null;
    const moving=(f.speed||0)>3;
    const eta=(dist!=null)?Math.max(1,Math.round(dist/((Math.max(f.speed,4.5))*1000/60))):null;
    document.getElementById('fsheetAv').innerHTML=avBig(id,f.name);
    document.getElementById('fsheetName').textContent=f.name;
    document.getElementById('fsheetStatus').textContent=f.status||'';
    document.getElementById('fsheetMoving').textContent=moving?'Moving':'Stopped';
    document.getElementById('fssSpeed').textContent=moving?Math.round(f.speed):'0';
    document.getElementById('fssDist').textContent=dist!=null?(dist<1000?Math.round(dist):(dist/1000).toFixed(1)):'—';
    document.getElementById('fssEta').textContent=eta!=null?eta:'—';
    document.getElementById('fssBatt').textContent=f.battery!=null?f.battery:'—';
    // wire actions (rebind each open, closure over current f)
    document.getElementById('fsheetNav').onclick=()=>window.open(`https://www.google.com/maps/dir/?api=1&destination=${f.lat},${f.lon}`,'_blank');
    document.getElementById('fsheetFocus').onclick=()=>{ map.setView([p.lat,p.lon],17,{animate:true}); closeFriendCard(); };
    document.getElementById('fsheetMsg').onclick=()=>{ const who=openCardId; closeFriendCard(); openChat(who, f.name); };
    drawPath(f);
  }
  function initPathMap(){
    if(!openCardId) return;
    if(!pathMap){
      pathMap=L.map('fsheetPathMap',{zoomControl:false,attributionControl:false,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,boxZoom:false,keyboard:false,tap:false});
      const theme=root.getAttribute('data-theme')==='dark'?'dark':'light';
      L.tileLayer(TILES[theme].url,{maxZoom:19,subdomains:TILES[theme].sub}).addTo(pathMap);
    }
    pathMap.invalidateSize();
    const p=people.get(openCardId); if(p) drawPath(p.data);
  }
  function drawPath(f){
    if(!pathMap) return;
    if(pathLayer){ pathLayer.forEach(l=>pathMap.removeLayer(l)); }
    pathLayer=[];
    const trail=(f.trail||[]).map(t=>[t[0],t[1]]);
    if(trail.length>1){
      const line=L.polyline(trail,{color:getComputedStyle(root).getPropertyValue('--ember').trim(),weight:3,opacity:.5,dashArray:'2 7'}).addTo(pathMap);
      pathLayer.push(line);
      pathMap.fitBounds(line.getBounds(),{padding:[16,16],maxZoom:16});
    } else {
      pathMap.setView([f.lat,f.lon],15);
    }
    const dot=L.circleMarker([f.lat,f.lon],{radius:6,color:'#fff',weight:2,fillColor:getComputedStyle(root).getPropertyValue('--ember').trim(),fillOpacity:1}).addTo(pathMap);
    pathLayer.push(dot);
  }

  // ---------- groups (named, join by link or code, multiple) ----------
  function makeCode(){const A='ABCDEFGHJKMNPQRSTUVWXYZ23456789';let s='WAND-';for(let i=0;i<4;i++)s+=A[Math.floor(Math.random()*A.length)];return s;}
  function grpInitial(name){ name=(name||'').trim(); return name?name[0].toUpperCase():'#'; }

  function renderGroups(){
    const html = myGroups.length
      ? myGroups.map((g,i)=>`
        <div class="grp-wrap" data-i="${i}">
          <div class="grp-row" data-i="${i}">
            <div class="gi">${grpInitial(g.name)}</div>
            <div class="gt gtap"><b>${esc(g.name)}</b><span>${esc(g.id)} · tap to see members</span></div>
            <button class="gact share" data-act="share" title="Invite"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5 8.6 10.5"/></svg></button>
            <button class="gact" data-act="leave" title="Leave"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg></button>
          </div>
          <div class="grp-members" data-for="${i}" style="display:none;"></div>
        </div>`).join('')
      : `<div class="grp-empty">No groups yet. Create one or join with a link/code.</div>`;
    ['groupList','groupListProfile'].forEach(id=>{ const box=document.getElementById(id); if(box) box.innerHTML=html; });
    const desc=document.getElementById('circleDesc');
    if(desc) desc.textContent = myGroups.length ? (myGroups.length+' group'+(myGroups.length>1?'s':'')+' — friends here can see you when you share.') : "You're not in any group yet.";
    // wire rows
    document.querySelectorAll('.grp-wrap').forEach(wrap=>{
      const i=wrap.dataset.i, g=myGroups[i];
      wrap.querySelectorAll('.gact').forEach(btn=>btn.onclick=(ev)=>{
        ev.stopPropagation();
        if(btn.dataset.act==='share') shareGroup(g);
        else leaveGroup(g);
      });
      const tap=wrap.querySelector('.gtap'); const panel=wrap.querySelector('.grp-members');
      if(tap&&panel) tap.onclick=()=>{
        const open=panel.style.display!=='none';
        // close others
        document.querySelectorAll('.grp-members').forEach(p=>p.style.display='none');
        if(!open){ panel.style.display='block'; renderGroupMembers(g,panel); }
      };
    });
  }

  // Full roster (from server) merged with live positions. Everyone in the group
  // shows — live members get status/distance, others show as offline. All get Message.
  async function renderGroupMembers(g,panel){
    panel.innerHTML=`<div class="gm-empty">Loading members…</div>`;
    let roster=[];
    try{
      const r=await fetch('/group/members?codes='+encodeURIComponent(g.id),{cache:'no-store'});
      const d=await r.json();
      roster=(d.ok && d.members && d.members[g.id.toUpperCase()])||[];
    }catch(_){}
    // make sure we have photos for everyone
    await ensurePhotos(roster.map(m=>m.userId));
    const mp=myPos();
    const live=new Map([...people.values()].map(p=>[p.data.id,p.data]));
    // ensure I'm in the list even if the roster fetch lagged
    if(!roster.some(m=>m.userId===myId)) roster.unshift({userId:myId,name:myName});
    // sort: me first, then live/online, then the rest
    roster.sort((a,b)=>{
      if(a.userId===myId)return -1; if(b.userId===myId)return 1;
      const la=live.has(a.userId)?0:1, lb=live.has(b.userId)?0:1; return la-lb;
    });
    panel.innerHTML=roster.map(m=>{
      const isMe=m.userId===myId;
      const f=live.get(m.userId);
      const on=f&&f.ageSec<90;
      const dist=(f&&mp)?fmtDist(metres(mp[0],mp[1],f.lat,f.lon)):'';
      let sub;
      if(isMe) sub='You';
      else if(on) sub=(f.status||(f.speed>3?'Moving':'Nearby'));
      else if(f) sub=`Last seen ${Math.round(f.ageSec/60)} min ago`;
      else sub='Not sharing location';
      const msgBtn=isMe?'':`<button class="gm-msg" data-id="${m.userId}" data-name="${esc(m.name)}" title="Message"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.6-.8L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"/></svg></button>`;
      return `<div class="gm-row" data-id="${m.userId}" data-live="${f?1:0}">
        <div class="gm-av">${avInner(m.userId,m.name)}<span class="livedot ${on?'on':'off'}"></span></div>
        <div class="gm-t"><b>${isMe?'You':esc(m.name)}</b><span>${esc(sub)}</span></div>
        ${dist?`<div class="gm-dist">${dist}</div>`:''}
        ${msgBtn}
      </div>`;
    }).join('') || `<div class="gm-empty">No members yet. Tap the share icon to invite friends.</div>`;
    // message button → open chat (works even if they're not sharing location)
    panel.querySelectorAll('.gm-msg').forEach(b=>b.onclick=(ev)=>{ ev.stopPropagation(); openChat(b.dataset.id,b.dataset.name); });
    // tapping a live member's row → their map card
    panel.querySelectorAll('.gm-row[data-live="1"]').forEach(el=>el.onclick=()=>{ if(el.dataset.id===myId)return; showTab('map'); const f=(people.get(el.dataset.id)||{}).data; if(f) openFriendCard(f.id); });
  }

  function inviteText(g){ return `Join my group "${g.name}" on The Wanderers' Map:\n${location.origin}/?join=${encodeURIComponent(g.id)}&name=${encodeURIComponent(g.name)}\n\nOr open ${location.origin} and enter code ${g.id}`; }
  function shareGroup(g){
    const msg=inviteText(g);
    if(navigator.share) navigator.share({title:g.name,text:msg}).catch(()=>{});
    else if(navigator.clipboard){ navigator.clipboard.writeText(msg); toast('Invite copied'); }
    else prompt('Share this invite:',msg);
  }

  async function registerGroupName(id,name){
    try{ await fetch('/group/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:id,name})}); }catch(_){}
  }
  async function lookupGroupName(id){
    try{ const r=await fetch('/group/name?code='+encodeURIComponent(id)); const d=await r.json(); return (d&&d.name)||''; }catch(_){ return ''; }
  }

  function addGroup(id,name){
    id=(id||'').toUpperCase().replace(/[^A-Z0-9-]/g,'').slice(0,16);
    if(!id) return false;
    if(myGroups.some(g=>g.id===id)){ toast('Already in that group'); return false; }
    myGroups.push({id,name:(name||id).slice(0,40)}); saveGroups(); renderGroups();
    // record persistent membership so others see me in the roster even when not sharing
    fetch('/group/join',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({code:id,id:myId,name:myName,groupName:(name||'')})}).catch(()=>{});
    return true;
  }

  function createGroup(){
    const name=prompt('Name your group (e.g. "Weekend crew"):');
    if(name===null) return;
    const nm=(name.trim()||'My group').slice(0,40);
    const id=makeCode();
    addGroup(id,nm);
    registerGroupName(id,nm);
    // offer the invite right away
    setTimeout(()=>shareGroup({id,name:nm}),200);
    reloadSoon();
  }

  async function joinGroup(){
    const raw=prompt('Enter a group code (or paste an invite link):');
    if(raw===null) return;
    let id=raw.trim(), name='';
    // if they pasted a link, pull code + name out of it
    const m=raw.match(/[?&]join=([^&\s]+)(?:&name=([^&\s]+))?/);
    if(m){ id=decodeURIComponent(m[1]); if(m[2]) name=decodeURIComponent(m[2]); }
    id=id.toUpperCase().replace(/[^A-Z0-9-]/g,'').slice(0,16);
    if(!id){ toast('No valid code found'); return; }
    if(!name) name=await lookupGroupName(id);   // pick up the creator's name
    if(addGroup(id,name||id)){ if(name) registerGroupName(id,name); reloadSoon(); }
  }

  function leaveGroup(g){
    if(!confirm(`Leave "${g.name}"?`)) return;
    myGroups=myGroups.filter(x=>x.id!==g.id); saveGroups(); renderGroups();
    fetch('/group/leave',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({code:g.id,id:myId})}).catch(()=>{});
    reloadSoon();
  }

  // group membership changes what you see, so a quick reload re-subscribes cleanly
  let _reloadT=null;
  function reloadSoon(){ clearTimeout(_reloadT); _reloadT=setTimeout(()=>location.reload(),500); }

  ['createCircle','createCircle2'].forEach(id=>{const e=document.getElementById(id);if(e)e.onclick=createGroup;});
  ['joinCircle','joinCircle2'].forEach(id=>{const e=document.getElementById(id);if(e)e.onclick=joinGroup;});

  // auto-join from an invite link (?join=CODE&name=NAME)
  (function handleInviteLink(){
    const p=new URLSearchParams(location.search);
    const j=p.get('join');
    if(j){
      const nm=p.get('name')||'';
      if(addGroup(j,nm)){ if(nm) registerGroupName(j.toUpperCase(),nm); toast('Joined '+(nm||'group')); }
      // clean the URL so a refresh doesn't rejoin
      history.replaceState({},'',location.pathname);
      reloadSoon();
    }
  })();

  function toast(t){ /* minimal */ const d=document.createElement('div'); d.textContent=t; d.style.cssText='position:fixed;bottom:120px;left:50%;transform:translateX(-50%);background:#141210;color:#fff;padding:10px 18px;border-radius:20px;font:14px Inter;z-index:5000'; document.body.appendChild(d); setTimeout(()=>d.remove(),1600); }

  // ---------- profile editing ----------
  const statusInput=document.getElementById('statusInput');
  statusInput.onchange=()=>{ myStatus=statusInput.value.trim(); localStorage.setItem('wm_status',myStatus); saveProfile(); };
  document.getElementById('profName').onclick=()=>{ const n=prompt('Your name on the map:',myName); if(n&&n.trim()){ myName=n.trim().slice(0,20); localStorage.setItem('wm_name',myName); paintIdentity(); saveProfile(); } };
  // photo picker
  const fileInput=document.createElement('input'); fileInput.type='file'; fileInput.accept='image/*'; fileInput.style.display='none'; document.body.appendChild(fileInput);
  document.getElementById('profAv').onclick=()=>fileInput.click();
  fileInput.onchange=e=>{ const f=e.target.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=()=>openCropper(rd.result); rd.readAsDataURL(f); fileInput.value=''; };

  // ---- interactive photo cropper (drag to position, slider to zoom) ----
  const STAGE=260; let cropState={scale:1,minScale:1,x:0,y:0,natW:0,natH:0};
  let cropImg=null, cropZoom=null;   // resolved lazily when the cropper opens
  function openCropper(src){
    const cropScrim=document.getElementById('cropScrim');
    const cropStage=document.getElementById('cropStage');
    cropImg=document.getElementById('cropImg');
    cropZoom=document.getElementById('cropZoom');
    if(!cropScrim||!cropStage||!cropImg||!cropZoom){ toast('Could not open editor'); return; }
    wireCropperOnce(cropScrim,cropStage);
    const im=new Image();
    im.onload=()=>{
      cropState.natW=im.naturalWidth; cropState.natH=im.naturalHeight;
      const cover=Math.max(STAGE/im.naturalWidth, STAGE/im.naturalHeight);
      cropState.minScale=cover; cropState.scale=cover;
      cropImg.src=src;
      cropImg.style.width=im.naturalWidth+'px'; cropImg.style.height=im.naturalHeight+'px';
      cropZoom.min=cover; cropZoom.max=cover*3; cropZoom.step=cover*0.01; cropZoom.value=cover;
      cropState.x=(STAGE-im.naturalWidth*cover)/2; cropState.y=(STAGE-im.naturalHeight*cover)/2;
      applyCrop();
      cropScrim.classList.add('on');
    };
    im.src=src;
  }
  function clampCrop(){
    const w=cropState.natW*cropState.scale, h=cropState.natH*cropState.scale;
    cropState.x=Math.min(0,Math.max(STAGE-w,cropState.x));
    cropState.y=Math.min(0,Math.max(STAGE-h,cropState.y));
  }
  function applyCrop(){ if(!cropImg)return; clampCrop(); cropImg.style.transform=`translate(${cropState.x}px,${cropState.y}px) scale(${cropState.scale})`; }

  let cropperWired=false;
  function wireCropperOnce(cropScrim,cropStage){
    if(cropperWired) return; cropperWired=true;
    cropZoom.oninput=()=>{
      const old=cropState.scale, ns=parseFloat(cropZoom.value);
      const cx=STAGE/2, cy=STAGE/2;
      cropState.x=cx-(cx-cropState.x)*(ns/old);
      cropState.y=cy-(cy-cropState.y)*(ns/old);
      cropState.scale=ns; applyCrop();
    };
    let drag=null;
    const startDrag=(px,py)=>{ drag={px,py,ox:cropState.x,oy:cropState.y}; };
    const moveDrag=(px,py)=>{ if(!drag)return; cropState.x=drag.ox+(px-drag.px); cropState.y=drag.oy+(py-drag.py); applyCrop(); };
    cropStage.addEventListener('mousedown',e=>startDrag(e.clientX,e.clientY));
    window.addEventListener('mousemove',e=>moveDrag(e.clientX,e.clientY));
    window.addEventListener('mouseup',()=>drag=null);
    cropStage.addEventListener('touchstart',e=>{ if(e.touches[0])startDrag(e.touches[0].clientX,e.touches[0].clientY); },{passive:true});
    cropStage.addEventListener('touchmove',e=>{ if(e.touches[0]){moveDrag(e.touches[0].clientX,e.touches[0].clientY);} },{passive:true});
    cropStage.addEventListener('touchend',()=>drag=null);
    document.getElementById('cropCancel').onclick=()=>cropScrim.classList.remove('on');
    document.getElementById('cropSave').onclick=()=>{
      const S=96, cv=document.createElement('canvas'); cv.width=S; cv.height=S; const x=cv.getContext('2d');
      const sx=-cropState.x/cropState.scale, sy=-cropState.y/cropState.scale, sSide=STAGE/cropState.scale;
      x.drawImage(cropImg,sx,sy,sSide,sSide,0,0,S,S);
      myPhoto=cv.toDataURL('image/jpeg',0.72);
      localStorage.setItem('wm_photo',myPhoto); photoCache.set(myId,myPhoto);
      paintIdentity(); saveProfile(); cropScrim.classList.remove('on'); toast('Photo updated');
    };
  }
  async function saveProfile(){ try{ await fetch('/profile/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:myId,name:myName,photo:myPhoto||null,status:myStatus})}); }catch(_){} }

  // ---------- sharing ----------
  let sharing=false, watch=null, lastSent=0;
  const shareFab=document.getElementById('shareFab'), shareLabel=document.getElementById('shareLabel'), fabPulse=shareFab.querySelector('.pulse');
  const shareSwitch=document.getElementById('shareSwitch'), stState=document.getElementById('stState'), stSub=document.getElementById('stSub');
  function setSharingUI(on){
    shareFab.classList.toggle('on',on); shareLabel.textContent=on?'Sharing':'Share location'; fabPulse.style.display=on?'block':'none';
    shareSwitch.classList.toggle('on',on);
    stState.innerHTML=on?'<span class="d"></span>Sharing':'<span class="d" style="background:#B9B0A2"></span>Hidden';
    stSub.textContent=on?'Your location is visible to your groups.':'You are not sharing your location.';
  }
  function startShare(){
    if(!myName){ showTab('profile'); toast('Set your name first'); return; }
    if(!('geolocation'in navigator)){ toast('Location not available on this device'); return; }
    if(!window.isSecureContext){ toast('Location needs the https:// address'); return; }
    // First, an explicit one-shot request — this reliably shows the
    // permission prompt. Only if it succeeds do we start the live watch.
    toast('Requesting location…');
    navigator.geolocation.getCurrentPosition(()=>{
      sharing=true; setSharingUI(true); beginWatch();
      // If we're inside the native app, also start the background service so
      // sharing continues with the screen off.
      try{ if(window.AndroidBridge&&AndroidBridge.startSharing){
        AndroidBridge.startSharing(myId,myName,groupIds().join(','),myStatus||'');
      }}catch(_){}
    }, err=>{
      if(err.code===1) toast('Location is blocked. Enable it for this site in browser settings.');
      else if(err.code===2) toast('Can’t find your location. Try outside or near a window.');
      else toast('Location timed out. Tap Share to try again.');
    },{enableHighAccuracy:true,timeout:15000,maximumAge:0});
  }
  function beginWatch(){
    let sentOnce=false;
    watch=navigator.geolocation.watchPosition(pos=>{
      const c=pos.coords,now=Date.now();
      if(c.accuracy>80&&sentOnce) return;
      if(now-lastSent<500) return; lastSent=now; sentOnce=true;
      fetch('/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        id:myId,name:myName,lat:c.latitude,lon:c.longitude,circles:groupIds(),
        gspeed:(c.speed>=0)?c.speed:null,heading:(c.heading!=null&&!isNaN(c.heading))?c.heading:null,
        battery:window._batt??null,status:myStatus })}).catch(()=>{});
    },err=>{
      if(err.code===1){ toast('Location permission lost'); sharing=false; setSharingUI(false); }
    },{enableHighAccuracy:true,maximumAge:0,timeout:20000});
    if(navigator.getBattery)navigator.getBattery().then(b=>{window._batt=Math.round(b.level*100);b.addEventListener('levelchange',()=>window._batt=Math.round(b.level*100));});
  }
  function stopShare(){
    sharing=false; setSharingUI(false);
    if(watch!=null){navigator.geolocation.clearWatch(watch);watch=null;}
    try{ if(window.AndroidBridge&&AndroidBridge.stopSharing) AndroidBridge.stopSharing(); }catch(_){}
    fetch('/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:myId})}).catch(()=>{});
  }
  shareFab.onclick=()=>sharing?stopShare():startShare();
  shareSwitch.onclick=()=>sharing?stopShare():startShare();
  setSharingUI(false);

  // ---------- trips ----------
  let tripActive=false, tripTimer=null, summaryMap=null, summaryLine=null;
  const fmtDur=s=>{const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=Math.round(s%60);return (h>0?h+':'+String(m).padStart(2,'0'):m)+':'+String(ss).padStart(2,'0');};
  const fmtDurHMS=s=>{const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=Math.round(s%60);return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(ss).padStart(2,'0');};

  document.getElementById('tripStartBtn').onclick=()=>{ if(window._startFreeTrip) window._startFreeTrip(); else startTrip(); };
  document.getElementById('tripEndBtn').onclick=endTrip;
  ['profBtn3'].forEach(id=>{const e=document.getElementById(id);if(e)e.onclick=()=>showTab('profile');});
  ['msgBtn4'].forEach(id=>{const e=document.getElementById(id);if(e)e.onclick=()=>openMessages();});
  document.getElementById('summaryBack').onclick=()=>showTab('trips');

  async function startTrip(){
    try{
      // a trip records on top of sharing — turn sharing on if it's off,
      // but don't let it block the trip if permission is still pending
      if(!sharing){ try{ startShare(); }catch(_){} }
      const r=await fetch('/trip/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:myId,name:myName})});
      if(!r.ok) throw new Error('server '+r.status);
      const d=await r.json();
      if(!d.ok) throw new Error(d.error||'start failed');
      tripActive=true;
      document.getElementById('tripsIdle').style.display='none';
      document.getElementById('tripsLive').style.display='block';
      document.getElementById('tripsTitle').textContent='Recording trip';
      tripTimer=setInterval(pollTrip,1500); pollTrip();
    }catch(e){ toast('Could not start trip: '+e.message); }
  }
  async function pollTrip(){
    try{
      const r=await fetch('/trip/live?id='+encodeURIComponent(myId),{cache:'no-store'});
      const d=await r.json(); if(!d.active) return;
      const me=people.get(myId);
      document.getElementById('tripSpeed').textContent=Math.round((me&&me.data.speed)||0);
      document.getElementById('tripDist').textContent=(d.distanceM/1000).toFixed(2);
      document.getElementById('tripTime').textContent=fmtDur(d.durationSec);
      document.getElementById('tripAvg').textContent=Math.round(d.avgKmh);
      document.getElementById('tripTop').textContent=Math.round(d.topKmh);
    }catch(_){}
  }
  async function endTrip(){
    clearInterval(tripTimer);
    try{
      const r=await fetch('/trip/end',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:myId,name:myName})});
      const d=await r.json();
      tripActive=false;
      document.getElementById('tripsLive').style.display='none';
      document.getElementById('tripsIdle').style.display='block';
      document.getElementById('tripsTitle').textContent='Trips';
      loadHistory();
      if(d.trip) showSummary(d.trip);
    }catch(_){ toast('Could not end trip'); }
  }

  function showSummary(t){
    showTab('summary');
    const dt=new Date(t.startedAt);
    document.getElementById('summaryDate').textContent=dt.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})+' · '+dt.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
    const cell=(icon,k,v)=>`<div class="summary-cell"><div class="k">${icon} ${k}</div><div class="v">${v}</div></div>`;
    document.getElementById('summaryGrid').innerHTML=
      cell('📍','Distance',`${(t.distanceM/1000).toFixed(2)}<small> km</small>`)+
      cell('⏱','Total time',fmtDurHMS(t.durationSec))+
      cell('⚡','Top speed',`${Math.round(t.topKmh)}<small> km/h</small>`)+
      cell('📊','Avg speed',`${Math.round(t.avgKmh)}<small> km/h</small>`)+
      cell('🐢','Lowest moving',`${Math.round(t.lowKmh)}<small> km/h</small>`)+
      cell('▶','Moving time',fmtDurHMS(t.movingSec));
    setTimeout(()=>drawSummaryMap(t),300);
    document.getElementById('summaryShare').onclick=()=>{
      const txt=`My trip: ${(t.distanceM/1000).toFixed(1)}km, top ${Math.round(t.topKmh)}km/h, ${fmtDur(t.durationSec)} — on The Wanderers' Map`;
      if(navigator.share)navigator.share({text:txt}).catch(()=>{}); else{navigator.clipboard&&navigator.clipboard.writeText(txt);toast('Copied');}
    };
    document.getElementById('summaryReplay').onclick=()=>toast('Replay — coming soon');
  }
  function drawSummaryMap(t){
    const route=(t.route||[]).map(p=>[p[0],p[1]]);
    if(!summaryMap){
      summaryMap=L.map('summaryMap',{zoomControl:false,attributionControl:false});
      const theme=root.getAttribute('data-theme')==='dark'?'dark':'light';
      L.tileLayer(TILES[theme].url,{maxZoom:19,subdomains:TILES[theme].sub}).addTo(summaryMap);
    }
    summaryMap.invalidateSize();
    if(summaryLine)summaryLine.forEach(l=>summaryMap.removeLayer(l)); summaryLine=[];
    if(route.length>1){
      const line=L.polyline(route,{color:getComputedStyle(root).getPropertyValue('--ember').trim(),weight:4}).addTo(summaryMap);
      summaryLine.push(line);
      summaryLine.push(L.circleMarker(route[0],{radius:7,color:'#fff',weight:2,fillColor:'#3FB950',fillOpacity:1}).addTo(summaryMap));
      summaryLine.push(L.circleMarker(route[route.length-1],{radius:7,color:'#fff',weight:2,fillColor:getComputedStyle(root).getPropertyValue('--ember').trim(),fillOpacity:1}).addTo(summaryMap));
      summaryMap.fitBounds(line.getBounds(),{padding:[24,24]});
    } else { summaryMap.setView(route[0]||[41,71.67],14); }
  }

  async function loadHistory(){
    try{
      const r=await fetch('/trip/list?id='+encodeURIComponent(myId),{cache:'no-store'});
      const d=await r.json(); const box=document.getElementById('tripHistory');
      if(!d.trips||!d.trips.length){ box.innerHTML=`<div class="empty" style="padding:20px">No trips yet. Start one above!</div>`; return; }
      box.innerHTML=d.trips.map((t,i)=>{
        const dt=new Date(t.startedAt);
        return `<div class="trip-card" data-i="${i}">
          <div class="trip-card-map" id="thmap-${i}"></div>
          <div class="trip-card-info">
            <div class="d">${dt.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</div>
            <div class="t">${dt.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</div>
            <div class="trip-card-nums">
              <div><b>${(t.distanceM/1000).toFixed(1)}</b><span>km</span></div>
              <div><b>${fmtDur(t.durationSec)}</b><span>time</span></div>
              <div><b>${Math.round(t.topKmh)}</b><span>top</span></div>
            </div>
          </div></div>`;
      }).join('');
      // mini maps + click
      d.trips.forEach((t,i)=>{
        const card=box.querySelector(`[data-i="${i}"]`);
        if(card) card.onclick=()=>showSummary(t);
        const route=(t.route||[]).map(p=>[p[0],p[1]]);
        if(route.length>1){
          const mm=L.map('thmap-'+i,{zoomControl:false,attributionControl:false,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,boxZoom:false,keyboard:false,tap:false});
          const theme=root.getAttribute('data-theme')==='dark'?'dark':'light';
          L.tileLayer(TILES[theme].url,{maxZoom:17,subdomains:TILES[theme].sub}).addTo(mm);
          const line=L.polyline(route,{color:getComputedStyle(root).getPropertyValue('--ember').trim(),weight:2.5}).addTo(mm);
          setTimeout(()=>{mm.invalidateSize();mm.fitBounds(line.getBounds(),{padding:[6,6]});},100);
        }
      });
    }catch(_){}
  }
  loadHistory();

  // ================= NAVIGATION (free: Nominatim + OSRM) =================
  let destination=null, destMarker=null, previewMap=null, previewLines=[], routeData={}, curMode='driving', chosenIdx=0;
  let navigating=false, freeRoaming=false, navRouteLine=null, navSteps=[], navStepIdx=0;
  const $=id=>document.getElementById(id);
  function getEmber(){ return getComputedStyle(root).getPropertyValue('--ember').trim()||'#E8562A'; }
  function clockETA(mins){ const t=new Date(Date.now()+mins*60000); return t.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}); }
  const searchInput=$('search'), searchResults=$('searchResults'), routeSheet=$('routeSheet');
  const navPanel=$('navPanel'), freeBadge=$('freeBadge'), gpsChip=$('gpsChip');

  let searchTimer=null;
  searchInput.addEventListener('focus',()=>{ document.body.classList.add('searching'); if(!searchInput.value.trim()) showSavedPlaces(); });
  searchInput.addEventListener('input',()=>{
    const q=searchInput.value.trim();
    $('searchX').style.display=q?'block':'none';
    clearTimeout(searchTimer);
    if(q.length<2){ showSavedPlaces(); return; }
    searchTimer=setTimeout(()=>doSearch(q),380);
  });
  $('searchX').onclick=()=>{ searchInput.value=''; $('searchX').style.display='none'; searchResults.classList.remove('on'); };
  $('searchCancel').onclick=()=>{ searchInput.value=''; searchInput.blur(); $('searchX').style.display='none'; searchResults.classList.remove('on'); document.body.classList.remove('searching'); };
  async function doSearch(q){
    searchResults.innerHTML=`<div class="sr-empty">Searching…</div>`; searchResults.classList.add('on');
    const me=myPos();
    try{
      // Pass 1: strongly prefer nearby results (bounded viewbox around me)
      let d=[];
      if(me){
        const r=0.6; // ~60km box
        const vb=`&viewbox=${me[1]-r},${me[0]+r},${me[1]+r},${me[0]-r}&bounded=1`;
        d=await nomFetch(q,vb,10);
      }
      // Pass 2: if too few local hits, widen to unbounded (still biased near me)
      if(d.length<3){
        const vb=me?`&viewbox=${me[1]-4},${me[0]+4},${me[1]+4},${me[0]-4}&bounded=0`:'';
        const wide=await nomFetch(q,vb,10);
        // merge, dedupe by place_id
        const seen=new Set(d.map(x=>x.place_id));
        wide.forEach(x=>{ if(!seen.has(x.place_id)){ d.push(x); seen.add(x.place_id); } });
      }
      if(!d.length){ searchResults.innerHTML=`<div class="sr-empty">No places found near you</div>`; return; }
      // sort by distance from me (closest first) — this is the Google-like ranking
      if(me){
        d.forEach(x=>{ x._dist=metres(me[0],me[1],parseFloat(x.lat),parseFloat(x.lon)); });
        d.sort((a,b)=>a._dist-b._dist);
      }
      d=d.slice(0,7);
      searchResults.innerHTML=d.map((x,i)=>{
        const name=x.display_name.split(',')[0];
        const rest=x.display_name.split(',').slice(1,3).join(',').trim();
        const dist=x._dist!=null?(x._dist<1000?Math.round(x._dist)+' m':(x._dist/1000).toFixed(1)+' km'):'';
        return `<div class="sr-item" data-i="${i}"><svg class="sr-pin" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z" opacity=".9"/><circle cx="12" cy="9" r="2.5" fill="white"/></svg><div class="t"><b>${esc(name)}</b><span>${esc(rest)}</span></div>${dist?`<span class="sr-dist">${dist}</span>`:''}</div>`;
      }).join('');
      searchResults.querySelectorAll('.sr-item').forEach(el=>el.onclick=()=>{
        const x=d[el.dataset.i];
        document.body.classList.remove('searching'); searchResults.classList.remove('on');
        openRoutePreview(parseFloat(x.lat),parseFloat(x.lon),x.display_name.split(',')[0]);
      });
    }catch(e){ searchResults.innerHTML=`<div class="sr-empty">Search unavailable — check connection</div>`; }
  }
  async function nomFetch(q,vb,limit){
    const url=`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=${limit}&addressdetails=1${vb||''}`;
    const r=await fetch(url,{headers:{'Accept':'application/json'}});
    return await r.json();
  }

  map.on('click',e=>{ if(navigating||freeRoaming) return; openRoutePreview(e.latlng.lat,e.latlng.lng,'Dropped pin'); });

  function openRoutePreview(lat,lon,name){
    destination={lat,lon,name}; $('rhDest').textContent=name; routeSheet.classList.add('on');
    if(!previewMap){
      previewMap=L.map('routePreviewMap',{zoomControl:false,attributionControl:false});
      const th=root.getAttribute('data-theme')==='dark'?'dark':'light';
      L.tileLayer(TILES[th].url,{maxZoom:19,subdomains:TILES[th].sub}).addTo(previewMap);
    }
    setTimeout(()=>previewMap.invalidateSize(),120);
    routeData={}; curMode='driving';
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.toggle('sel',b.dataset.mode==='driving'));
    fetchAllModes();
  }
  $('rhBack').onclick=closeRoutePreview;
  function closeRoutePreview(){ routeSheet.classList.remove('on'); destination=null; }

  // ================= SAVED PLACES =================
  let savedPlaces=[];
  const placeIcon=label=>{
    if(label==='home') return '<path d="M3 11.5 12 4l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>';
    if(label==='work') return '<path d="M4 7h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm5-3h6a1 1 0 0 1 1 1v2H8V5a1 1 0 0 1 1-1z"/>';
    return '<path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.8 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/>';
  };
  async function loadSavedPlaces(){
    try{ const r=await fetch('/places/list?ownerId='+encodeURIComponent(myId),{cache:'no-store'});
      const d=await r.json(); if(d.ok) savedPlaces=d.places||[]; }catch(_){}
    return savedPlaces;
  }
  async function showSavedPlaces(){
    searchResults.classList.add('on');
    if(!savedPlaces.length) await loadSavedPlaces();
    if(!savedPlaces.length){ searchResults.innerHTML=`<div class="sr-empty">No saved places yet.<br>Pick a destination and tap Pin to save it.</div>`; return; }
    searchResults.innerHTML=savedPlaces.map((p,i)=>`
      <div class="sr-item" data-i="${i}">
        <svg class="sr-pin" viewBox="0 0 24 24" fill="currentColor">${placeIcon(p.label)}</svg>
        <div class="t"><b>${esc(p.name)}</b><span>${p.label==='home'?'Home':p.label==='work'?'Work':'Saved place'}</span></div>
        <svg class="sr-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </div>`).join('') +
      `<div class="sr-empty" style="border-top:1px solid var(--line)">Tap to route · long-press to remove</div>`;
    searchResults.querySelectorAll('.sr-item').forEach(el=>{
      const p=savedPlaces[el.dataset.i];
      el.onclick=()=>{ document.body.classList.remove('searching'); searchResults.classList.remove('on'); searchInput.value=''; openRoutePreview(p.lat,p.lon,p.name); };
      let press; el.addEventListener('touchstart',()=>{ press=setTimeout(()=>removePlace(p),600); },{passive:true});
      el.addEventListener('touchend',()=>clearTimeout(press));
      el.addEventListener('contextmenu',ev=>{ ev.preventDefault(); removePlace(p); });
    });
  }
  async function removePlace(p){
    if(!confirm('Remove "'+p.name+'" from saved places?')) return;
    try{ await fetch('/places/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ownerId:myId,id:p._id})});
      savedPlaces=savedPlaces.filter(x=>x._id!==p._id); showSavedPlaces(); toast('Removed'); }catch(_){ toast('Could not remove'); }
  }
  async function savePinnedPlace(){
    if(!destination){ toast('Pick a destination first'); return; }
    const name=prompt('Save this place as:', destination.name||'Saved place');
    if(name===null) return;
    // quick label guess from the name
    let label='star'; const low=name.toLowerCase();
    if(low.includes('home')||low.includes('uy')) label='home';
    else if(low.includes('work')||low.includes('ish')||low.includes('office')) label='work';
    try{
      const r=await fetch('/places/save',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ownerId:myId,name:name.trim()||'Saved place',label,lat:destination.lat,lon:destination.lon})});
      const d=await r.json();
      if(d.ok){ savedPlaces.unshift(d.place); toast('Saved ★'); }
      else toast(d.error||'Could not save');
    }catch(_){ toast('Could not save'); }
  }
  loadSavedPlaces();

  const OSRM={driving:'driving',cycling:'cycling',walking:'walking'};
  // realistic average speeds for a mid-size Uzbek city (km/h) — accounts for
  // lights, turns, congestion; free routing has no live traffic so we estimate.
  const REAL_SPEED={driving:26,cycling:13,walking:4.7};
  function fetchAllModes(){
    const me=myPos();
    if(!me){
      $('rmTag').textContent='Turn on location sharing to get routes';
      if(!sharing){ startShare(); toast('Turn on sharing to route from your location'); }
      return;
    }
    $('rmTag').textContent='Finding routes…';
    let anyOk=false, done=0;
    for(const m of ['driving','cycling','walking']){
      fetchMode(m,me).then(routes=>{
        done++;
        if(routes&&routes.length){
          anyOk=true;
          // Use the road DISTANCE from routing (reliable), but compute TIME
          // ourselves from realistic mode speeds — the free server's own
          // durations are optimistic (no traffic) and often identical across modes.
          routes.forEach(rt=>{ rt._realMin=Math.max(1,Math.round((rt.distance/1000)/REAL_SPEED[m]*60)); });
          setModeTime(m,routes[0]._realMin);
          routeData[m]=routes;
          if(m===curMode) renderRoutes();
        }
        if(done===3 && !anyOk){ useStraightFallback(me); }
      });
    }
  }
  function setModeTime(m,mins){
    if(m==='driving')$('modeDriveTime').textContent=mins+' min';
    if(m==='cycling')$('modeBikeTime').textContent=mins+' min';
    if(m==='walking')$('modeWalkTime').textContent=mins+' min';
  }
  function useStraightFallback(me){
    const distM=metres(me[0],me[1],destination.lat,destination.lon)*1.3; // road factor
    for(const m of ['driving','cycling','walking']){
      const mins=Math.max(1,Math.round((distM/1000)/REAL_SPEED[m]*60));
      const fake=[{duration:mins*60,distance:distM,_realMin:mins,geometry:{coordinates:[[me[1],me[0]],[destination.lon,destination.lat]]},legs:[{steps:[]}],_straight:true}];
      routeData[m]=fake; setModeTime(m,mins);
    }
    $('rmTag').textContent='Estimated (routing server busy)';
    renderRoutes();
  }
  async function fetchMode(mode,me){
    // Use the profile-correct server FIRST so bike/walk differ from car.
    const profile=mode==='driving'?'car':mode==='cycling'?'bike':'foot';
    const paths=[
      `https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${me[1]},${me[0]};${destination.lon},${destination.lat}?overview=full&geometries=geojson&steps=true&alternatives=3`,
      `https://router.project-osrm.org/route/v1/driving/${me[1]},${me[0]};${destination.lon},${destination.lat}?overview=full&geometries=geojson&steps=true&alternatives=3`
    ];
    for(const url of paths){
      try{
        const ctrl=new AbortController(); const to=setTimeout(()=>ctrl.abort(),7000);
        const r=await fetch(url,{signal:ctrl.signal}); clearTimeout(to);
        const d=await r.json();
        if(d.code==='Ok'&&d.routes&&d.routes.length){ console.log('[route]',mode,d.routes.length+' route(s) via',url.split('/')[2]); return d.routes.slice(0,3); }
      }catch(e){ console.log('[route]',mode,'failed',url.split('/')[2],e.message); }
    }
    return null;
  }
  function renderRoutes(){
    const routes=routeData[curMode]; if(!routes||!previewMap) return;
    chosenIdx=0;
    previewLines.forEach(l=>previewMap.removeLayer(l)); previewLines=[];
    routes.forEach((rt,i)=>{
      const coords=rt.geometry.coordinates.map(c=>[c[1],c[0]]);
      const line=L.polyline(coords,{color:i===0?getEmber():'#9A9A9A',weight:i===0?7:5,opacity:i===0?.95:.5}).addTo(previewMap);
      line.on('click',()=>selectRoute(i)); previewLines.push(line);
    });
    const me=myPos();
    previewLines.push(L.marker([destination.lat,destination.lon],{icon:L.divIcon({className:'dest-pin',iconSize:[30,30],html:`<svg viewBox="0 0 24 24" width="30" height="30"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z" fill="${getEmber()}" stroke="white" stroke-width="1.5"/><circle cx="12" cy="9" r="2.5" fill="white"/></svg>`})}).addTo(previewMap));
    if(me) previewLines.push(L.circleMarker(me,{radius:8,color:'#fff',weight:3,fillColor:getEmber(),fillOpacity:1}).addTo(previewMap));
    previewMap.fitBounds(L.latLngBounds(routes[0].geometry.coordinates.map(c=>[c[1],c[0]])),{padding:[50,50]});
    selectRoute(0);
  }
  function selectRoute(i){
    const routes=routeData[curMode]; if(!routes) return; chosenIdx=i;
    previewLines.forEach((l,j)=>{ if(l.setStyle&&j<routes.length) l.setStyle({color:j===i?getEmber():'#9A9A9A',weight:j===i?7:5,opacity:j===i?.95:.5}); });
    const rt=routes[i];
    $('rmTime').textContent=(rt._realMin||Math.round(rt.duration/60))+' min';
    $('rmDist').textContent='('+(rt.distance/1000).toFixed(1)+' km)';
    $('rmTag').textContent=i===0?'Fastest route':'Alternative route';
    const others=routes.map((r,j)=>({r,j})).filter(o=>o.j!==i);
    $('otherLabel').style.display=others.length?'block':'none';
    $('otherRoutes').innerHTML=others.map(o=>`<div class="other-route" data-i="${o.j}"><b>${o.r._realMin||Math.round(o.r.duration/60)} min</b><span>(${(o.r.distance/1000).toFixed(1)} km)</span></div>`).join('');
    $('otherRoutes').querySelectorAll('.other-route').forEach(el=>el.onclick=()=>selectRoute(+el.dataset.i));
  }
  document.querySelectorAll('.mode-btn').forEach(b=>b.onclick=()=>{
    curMode=b.dataset.mode;
    document.querySelectorAll('.mode-btn').forEach(x=>x.classList.toggle('sel',x===b));
    if(routeData[curMode]) renderRoutes(); else fetchMode(curMode,myPos()).then(r=>{if(r){routeData[curMode]=r;renderRoutes();}});
  });
  $('raStart').onclick=()=>startNavigation();
  $('raPin').onclick=()=>savePinnedPlace();
  $('raSteps').onclick=()=>{ const routes=routeData[curMode]; if(routes&&routes[chosenIdx]) showSteps(routes[chosenIdx]); };

  function startNavigation(){
    if(!sharing) startShare();
    const routes=routeData[curMode]; const rt=routes&&routes[chosenIdx];
    navigating=true; followMode=true;
    document.body.classList.add('navigating');
    routeSheet.classList.remove('on'); navPanel.classList.add('on');
    $('navTurn').style.display=rt?'block':'none';
    $('nsEtaLabel').textContent='ETA'; $('nsDistLabel').textContent='Distance';
    if(rt){
      if(navRouteLine)map.removeLayer(navRouteLine);
      navRouteLine=L.polyline(rt.geometry.coordinates.map(c=>[c[1],c[0]]),{color:getEmber(),weight:7,opacity:.9}).addTo(map);
      navSteps=(rt.legs&&rt.legs[0]&&rt.legs[0].steps)||[]; navStepIdx=0;
      $('nsEta').textContent=clockETA(rt._realMin||Math.round(rt.duration/60));
      $('nsDist').textContent=(rt.distance/1000).toFixed(1);
      updateTurn();
    }
    startTripRecord();
    const me=myPos(); if(me) map.setView(me,17,{animate:true});
  }
  function updateTurn(){
    if(!navSteps.length) return;
    const step=navSteps[navStepIdx]; if(!step) return; const man=step.maneuver||{};
    $('ntDist').innerHTML=(step.distance>=1000?(step.distance/1000).toFixed(1)+'<span> km</span>':Math.round(step.distance)+'<span> m</span>');
    $('ntText').textContent=turnText(man,step.name);
    const nxt=navSteps[navStepIdx+1];
    $('ntThen').innerHTML=nxt?('Then · '+turnText(nxt.maneuver||{},nxt.name)):'';
    $('ntIcon').innerHTML=turnIcon(man);
  }
  function turnText(man,road){
    const t=man.type||'', mod=man.modifier||'';
    if(t==='arrive')return 'Arrive at destination';
    if(t==='depart')return 'Head out'+(road?' on '+road:'');
    const dir=mod.includes('left')?'left':mod.includes('right')?'right':'straight';
    if(t==='roundabout'||t==='rotary')return 'Take the roundabout'+(road?' to '+road:'');
    if(dir==='straight')return 'Continue'+(road?' on '+road:'');
    return 'Turn '+dir+(road?' onto '+road:'');
  }
  function turnIcon(man){
    const mod=(man.modifier||'');
    if((man.type||'')==='arrive')return '<path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z"/>';
    if(mod.includes('right'))return '<path d="M9 18V9a3 3 0 0 1 3-3h6M15 3l3 3-3 3"/>';
    if(mod.includes('left'))return '<path d="M15 18V9a3 3 0 0 0-3-3H6M9 3 6 6l3 3"/>';
    return '<path d="M12 20V5M6 11l6-6 6 6"/>';
  }
  $('navEnd').onclick=stopNavigation;
  $('ntVoice').onclick=()=>toast('Voice guidance — coming soon');

  $('freeTripBtn').onclick=startFreeRoam;
  window._startFreeTrip=()=>{ showTab('map'); startFreeRoam(); };
  function startFreeRoam(){
    if(!sharing) startShare();
    freeRoaming=true; followMode=true;
    document.body.classList.add('freeroam');
    routeSheet.classList.remove('on');
    freeBadge.classList.add('on'); gpsChip.classList.add('on'); navPanel.classList.add('on');
    $('navTurn').style.display='none';
    $('nsEtaLabel').textContent='Time'; $('nsEta').textContent='0:00';
    $('nsDistLabel').textContent='Distance'; $('nsDist').textContent='0.0';
    startTripRecord();
    const me=myPos(); if(me) map.setView(me,17,{animate:true});
  }

  let navTimer=null;
  async function startTripRecord(){
    try{ await fetch('/trip/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:myId,name:myName})}); tripActive=true; }catch(_){}
    navTimer=setInterval(updateNavStats,1000); updateNavStats();
  }
  async function updateNavStats(){
    const me=people.get(myId);
    $('nsSpeed').textContent=Math.round((me&&me.data.speed)||0);
    try{
      const r=await fetch('/trip/live?id='+encodeURIComponent(myId),{cache:'no-store'}); const d=await r.json();
      if(d.active&&freeRoaming){ $('nsEta').textContent=fmtDur(d.durationSec); $('nsDist').textContent=(d.distanceM/1000).toFixed(1); }
    }catch(_){}
  }
  async function stopNavigation(){
    clearInterval(navTimer);
    navigating=false; freeRoaming=false; followMode=false;
    document.body.classList.remove('navigating','freeroam');
    navPanel.classList.remove('on'); freeBadge.classList.remove('on'); gpsChip.classList.remove('on');
    if(navRouteLine){map.removeLayer(navRouteLine);navRouteLine=null;}
    if(destMarker){map.removeLayer(destMarker);destMarker=null;}
    destination=null;
    if(tripActive){ try{ const r=await fetch('/trip/end',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:myId,name:myName})}); const d=await r.json(); tripActive=false; loadHistory(); if(d.trip) showSummary(d.trip); }catch(_){} }
  }
  function showSteps(rt){
    const steps=(rt.legs&&rt.legs[0]&&rt.legs[0].steps)||[];
    if(!steps.length){ toast('No turn steps available'); return; }
    alert('Directions:\n\n'+steps.map(s=>'• '+turnText(s.maneuver||{},s.name)+(s.distance?` (${s.distance>=1000?(s.distance/1000).toFixed(1)+'km':Math.round(s.distance)+'m'})`:'')).join('\n'));
  }

  $('recenterBtn').onclick=()=>{ const me=myPos(); if(me){ followMode=true; map.setView(me,navigating||freeRoaming?17:16,{animate:true}); } };
  $('layersBtn').onclick=()=>{ const next=root.getAttribute('data-theme')==='dark'?'light':'dark'; root.setAttribute('data-theme',next); localStorage.setItem('wm_theme',next); applyThemeUI(); };
  map.on('dragstart',()=>{ if(navigating||freeRoaming) followMode=false; });
  window._followTick=()=>{ if(followMode){ const me=people.get(myId); if(me) map.panTo([me.lat,me.lon],{animate:true,duration:.5}); } };

  // ================= MESSAGES =================
  let chatWith=null, chatName='', msgUnread=0, _fallbackKnown=0;
  const nameFor=id=>{ const p=people.get(id); return (p&&p.data&&p.data.name)||'Wanderer'; };
  function avatarHTML(id,name){ const p=photoCache.get(id); return p?`<img src="${p}">`:`<div class="ini">${initials(name)}</div>`; }

  function setMsgBadge(n){
    msgUnread=n;
    ['msgBadge'].forEach(id=>{ const e=document.getElementById(id); if(!e)return;
      if(n>0){ e.textContent=n>99?'99+':n; e.style.display='flex'; } else e.style.display='none'; });
  }
  async function refreshMsgBadge(){
    try{ const r=await fetch('/msg/overview?me='+encodeURIComponent(myId),{cache:'no-store'});
      const d=await r.json(); if(d.ok) setMsgBadge(d.unread||0); }catch(_){}
  }

  const msgListView=document.getElementById('msgListView');
  const msgChatView=document.getElementById('msgChatView');
  function openMessages(){
    showTab('messages');
    msgChatView.style.display='none'; msgListView.style.display='flex';
    loadThreadList();
  }
  document.getElementById('msgListBack').onclick=()=>showTab('map');
  document.getElementById('msgChatBack').onclick=()=>openMessages();

  async function loadThreadList(){
    const box=document.getElementById('msgThreadList');
    if(!box){ console.log('[msg] msgThreadList element missing'); return; }
    box.innerHTML=`<div class="msg-empty">Loading…</div>`;
    let d;
    try{
      const r=await fetch('/msg/overview?me='+encodeURIComponent(myId),{cache:'no-store'});
      d=await r.json();
    }catch(e){ console.log('[msg] overview fetch failed',e.message); box.innerHTML=`<div class="msg-empty">Couldn't load messages.<br>Check your connection.</div>`; return; }
    console.log('[msg] overview:',d);
    setMsgBadge(d.unread||0);
    const threads=(d.threads||[]);
    if(!threads.length){ box.innerHTML=`<div class="msg-empty">No conversations yet.<br>Open a friend and tap Message to start chatting.</div>`; return; }
    // Render immediately with whatever names/photos we already have,
    // so the list ALWAYS appears; enrich with fetched names/photos after.
    const paint=(profs)=>{
      box.innerHTML=threads.map(t=>{
        const nm=(profs&&profs[t.with])||nameFor(t.with);
        const mine=t.lastFrom===myId;
        const preview=(mine?'You: ':'')+(t.lastText||'');
        return `<div class="msg-row ${t.unread?'unread':''}" data-id="${t.with}" data-name="${esc(nm)}">
          <div class="mr-av">${avatarHTML(t.with,nm)}</div>
          <div class="mr-body">
            <div class="mr-top"><span class="mr-name">${esc(nm)}</span><span class="mr-time">${shortTime(t.lastTs)}</span></div>
            <div class="mr-last">${esc(preview)}</div>
          </div>
          ${t.unread?`<span class="mr-badge">${t.unread}</span>`:''}
        </div>`;
      }).join('');
      box.querySelectorAll('.msg-row').forEach(el=>el.onclick=()=>openChat(el.dataset.id,el.dataset.name));
    };
    paint(null);                      // show the list right away
    try{
      await ensurePhotos(threads.map(t=>t.with));
      const profs=await namesFor(threads.map(t=>t.with));
      paint(profs);                   // re-paint with real names + photos
    }catch(e){ console.log('[msg] enrich failed',e.message); /* list already shown */ }
  }

  // fetch display names for ids we might not have live (uses /profile/many)
  async function namesFor(ids){
    const out={};
    ids.forEach(id=>{ const p=people.get(id); if(p&&p.name) out[id]=p.name; });
    const missing=ids.filter(id=>!out[id]);
    if(missing.length){
      try{ const r=await fetch('/profile/many?ids='+encodeURIComponent(missing.join(',')));
        const d=await r.json(); if(d.ok&&d.profiles) for(const id in d.profiles) out[id]=d.profiles[id].name||'Wanderer'; }catch(_){}
    }
    return out;
  }

  async function openChat(id,name){
    if(!id||id===myId) return;
    chatWith=id; chatName=name||nameFor(id); _fallbackKnown=0;
    showTab('messages');
    msgListView.style.display='none'; msgChatView.style.display='flex';
    document.getElementById('msgChatName').textContent=chatName;
    const bubbles=document.getElementById('msgBubbles');
    bubbles.innerHTML=`<div class="msg-empty">Loading…</div>`;
    await ensurePhotos([id]);
    try{
      const r=await fetch(`/msg/thread?me=${encodeURIComponent(myId)}&with=${encodeURIComponent(id)}`,{cache:'no-store'});
      const d=await r.json();
      const list=d.messages||[];
      renderBubbles(list);
      _fallbackKnown=list.length;   // baseline so the poll only reacts to NEW messages
    }catch(e){ bubbles.innerHTML=`<div class="msg-empty">Couldn't load this chat.</div>`; }
    // mark read + clear badge
    try{ await fetch('/msg/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({me:myId,from:id})}); }catch(_){}
    refreshMsgBadge();
    setTimeout(()=>document.getElementById('msgInput').focus(),120);
  }

  function renderBubbles(list){
    const box=document.getElementById('msgBubbles');
    if(!list.length){ box.innerHTML=`<div class="msg-empty">Say hello 👋</div>`; return; }
    let html='', lastDay='';
    list.forEach(m=>{
      const day=dayLabel(m.ts);
      if(day!==lastDay){ html+=`<div class="msg-daysep">${day}</div>`; lastDay=day; }
      const mine=m.from===myId;
      html+=`<div class="bubble ${mine?'me':'them'}">${esc(m.text)}<div class="bt">${shortTime(m.ts)}</div></div>`;
    });
    box.innerHTML=html;
    box.scrollTop=box.scrollHeight;
  }

  function appendBubble(m){
    const box=document.getElementById('msgBubbles');
    const empty=box.querySelector('.msg-empty'); if(empty) box.innerHTML='';
    const mine=m.from===myId;
    const near=box.scrollHeight-box.scrollTop-box.clientHeight<80;
    const div=document.createElement('div');
    div.className='bubble '+(mine?'me':'them');
    div.innerHTML=esc(m.text)+`<div class="bt">${shortTime(m.ts)}</div>`;
    box.appendChild(div);
    if(near||mine) box.scrollTop=box.scrollHeight;
  }

  async function sendMsg(){
    const input=document.getElementById('msgInput');
    const text=input.value.trim();
    if(!text||!chatWith) return;
    input.value='';
    try{
      const r=await fetch('/msg/send',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({from:myId,to:chatWith,text})});
      const d=await r.json();
      if(!d.ok){ toast(d.error||'Message failed'); input.value=text; }
      // the SSE echo will append it; if SSE is down, append now as fallback
      else if(!sseAlive) appendBubble(d.msg);
    }catch(e){ toast('Message failed'); input.value=text; }
  }
  document.getElementById('msgSend').onclick=sendMsg;
  document.getElementById('msgInput').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); sendMsg(); } });

  // live incoming message (from SSE)
  let sseAlive=false;
  function handleIncomingMsg(m){
    if(!m) return;
    const other = m.from===myId ? m.to : m.from;
    const viewingThis = pages.messages.classList.contains('active')
      && msgChatView.style.display!=='none' && chatWith===other;
    if(viewingThis){
      appendBubble(m);
      _fallbackKnown++;   // keep poll baseline in step with the live append
      if(m.to===myId){ fetch('/msg/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({me:myId,from:other})}).catch(()=>{}); }
    } else {
      if(m.to===myId){ setMsgBadge(msgUnread+1); if(m.from!==myId) toast('New message'); }
      // if the list is open, refresh it
      if(pages.messages.classList.contains('active') && msgChatView.style.display==='none') loadThreadList();
    }
  }

  function shortTime(ts){ if(!ts)return''; const d=new Date(ts); return d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}); }
  function dayLabel(ts){ const d=new Date(ts), now=new Date();
    const same=(a,b)=>a.toDateString()===b.toDateString();
    if(same(d,now))return'Today';
    const y=new Date(now); y.setDate(now.getDate()-1); if(same(d,y))return'Yesterday';
    return d.toLocaleDateString(undefined,{month:'short',day:'numeric'}); }

  // Reliable receive: poll the open thread + badge on a short timer.
  // Runs even when SSE is up, as a safety net — the live push is the fast path,
  // this guarantees delivery if a push is ever missed. Cheap (one small request).
  async function pollMsgsFallback(){
    refreshMsgBadge();
    const viewingChat = pages.messages.classList.contains('active') && msgChatView.style.display!=='none' && chatWith;
    if(viewingChat){
      try{ const r=await fetch(`/msg/thread?me=${encodeURIComponent(myId)}&with=${encodeURIComponent(chatWith)}`,{cache:'no-store'});
        const d=await r.json(); const list=d.messages||[];
        if(list.length!==_fallbackKnown){ _fallbackKnown=list.length; renderBubbles(list);
          fetch('/msg/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({me:myId,from:chatWith})}).catch(()=>{}); }
      }catch(_){}
    } else if(pages.messages.classList.contains('active')){
      loadThreadList();
    }
  }
  setInterval(pollMsgsFallback, 3000);

  refreshMsgBadge();
  setInterval(refreshMsgBadge, 30000);

  // include my id on the stream so the server can push messages addressed to me
  const streamQS = (circleQS ? circleQS+'&' : '?') + 'id=' + encodeURIComponent(myId);
  function poll(){ fetch('/positions'+circleQS,{cache:'no-store'}).then(r=>r.json()).then(handle).catch(()=>{}); }
  function onStreamData(data){
    if(data && data.type==='msg'){ handleIncomingMsg(data.msg); return; }
    handle(data);
  }
  function connect(){
    poll();
    try{ const es=new EventSource('/stream'+streamQS); es.onopen=()=>{sseAlive=true;}; es.onmessage=e=>{try{onStreamData(JSON.parse(e.data));}catch(_){}}; es.onerror=()=>{sseAlive=false;es.close();setInterval(poll,2000);}; }
    catch(_){ setInterval(poll,2000); }
  }
  connect();
  syncMembership();
  requestAnimationFrame(animate);

  // register the service worker so the app is installable (PWA / TWA)
  if('serviceWorker' in navigator){
    window.addEventListener('load',()=>{
      navigator.serviceWorker.register('/sw.js').then(reg=>{
        // when a new SW takes control (after a deploy), reload once to get fresh code
        let reloaded=false;
        navigator.serviceWorker.addEventListener('controllerchange',()=>{
          if(reloaded) return; reloaded=true; location.reload();
        });
      }).catch(()=>{});
    });
  }
})();
