(function(){
  "use strict";

  // ---------- theme ----------
  const root=document.documentElement;
  let mapReady=false;   // becomes true once the map + tiles exist
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
  let myCircle=localStorage.getItem('wm_circle')||'';

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
    // circle pills
    const code = myCircle || '—';
    document.getElementById('codePill').childNodes[0].nodeValue = code+' ';
    document.getElementById('codePill2').childNodes[0].nodeValue = code+' ';
    document.getElementById('circleDesc').textContent = myCircle ? ('In circle '+myCircle+' — share this code with your people.') : 'Not in a circle yet.';
  }
  paintIdentity(); applyThemeUI();

  // ---------- tabs ----------
  const pages={map:document.getElementById('page-map'),friends:document.getElementById('page-friends'),trips:document.getElementById('page-trips'),profile:document.getElementById('page-profile'),summary:document.getElementById('page-summary')};
  function showTab(name){
    for(const k in pages) pages[k].classList.toggle('active', k===name);
    document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));
    if(name==='map' && map) setTimeout(()=>map.invalidateSize(),50);
  }
  document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>showTab(t.dataset.tab));
  // profile & messages open from corners
  ['profBtn','profBtn2'].forEach(id=>{const e=document.getElementById(id);if(e)e.onclick=()=>showTab('profile');});
  ['msgBtn','msgBtn2','msgBtn3'].forEach(id=>{const e=document.getElementById(id);if(e)e.onclick=()=>alert('Messages — coming in a later phase.');});

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

  const circleQS = myCircle ? ('?circles='+encodeURIComponent(myCircle)) : '';

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
      else{ const jump=metres(p.tLat,p.tLon,f.lat,f.lon); if(jump>12||(f.speed||0)>4){p.tLat=f.lat;p.tLon=f.lon;} p.data=f; }
      if(f.heading!=null){const a=p.marker.getElement()?.querySelector('.aa-arrow'); if(a)a.style.transform=`translateX(-50%) rotate(${f.heading}deg)`;}
    }
    for(const[id,p]of people){ if(!seen.has(id)){ map.removeLayer(p.marker); people.delete(id); } }
    if(!centred && people.has(myId)){ const me=people.get(myId); map.setView([me.lat,me.lon],16,{animate:true}); centred=true; }
    renderFriends();
    if(openCardId) renderFriendCard(openCardId);
  }

  // ---------- glide + footsteps ----------
  function animate(){
    for(const[id,p]of people){
      p.lat+=(p.tLat-p.lat)*0.14; p.lon+=(p.tLon-p.lon)*0.14;
      p.marker.setLatLng([p.lat,p.lon]);
      const moved=metres(p.lat,p.lon,p._plat??p.lat,p._plon??p.lon);
      const driving=(p.data.speed||0)>12;
      p.stepAcc+=moved;
      if(p.stepAcc>(driving?32:9)){ p.stepAcc=0; p.side*=-1; dropStep(p.lat,p.lon,p.data.heading||0,p.side,driving); }
      p._plat=p.lat; p._plon=p.lon;
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
    if(!all.length){ friendList.innerHTML=`<div class="empty">No one is sharing yet.<br>Share your circle code so friends can join.</div>`; return; }
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
    document.getElementById('fsheetMsg').onclick=()=>alert('Messaging — coming in a later phase.');
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

  // ---------- circles ----------
  function makeCode(){const A='ABCDEFGHJKMNPQRSTUVWXYZ23456789';let s='WAND-';for(let i=0;i<4;i++)s+=A[Math.floor(Math.random()*A.length)];return s;}
  function setCircle(c){ myCircle=(c||'').toUpperCase().replace(/[^A-Z0-9-]/g,'').slice(0,12); localStorage.setItem('wm_circle',myCircle); paintIdentity(); setTimeout(()=>location.reload(),300); }
  function createCircle(){ const c=makeCode(); const msg=`Join my Wanderers' Map circle — open ${location.origin} and enter code ${c}`; if(navigator.share)navigator.share({text:msg}).catch(()=>{}); else if(navigator.clipboard)navigator.clipboard.writeText(c); setCircle(c); }
  function joinCircle(){ const c=prompt('Enter your circle code:'); if(c&&c.trim()) setCircle(c.trim()); }
  function leaveCircle(){ if(confirm('Leave this circle?')) setCircle(''); }
  function copyCode(){ if(myCircle&&navigator.clipboard){navigator.clipboard.writeText(myCircle); toast('Code copied');} }
  ['createCircle','createCircle2'].forEach(id=>{const e=document.getElementById(id);if(e)e.onclick=createCircle;});
  ['joinCircle','joinCircle2'].forEach(id=>{const e=document.getElementById(id);if(e)e.onclick=joinCircle;});
  document.getElementById('leaveCircle').onclick=leaveCircle;
  ['codePill','codePill2'].forEach(id=>{const e=document.getElementById(id);if(e)e.onclick=copyCode;});
  document.getElementById('addFriend').onclick=()=>{ if(myCircle) copyCode(); else createCircle(); };

  function toast(t){ /* minimal */ const d=document.createElement('div'); d.textContent=t; d.style.cssText='position:fixed;bottom:120px;left:50%;transform:translateX(-50%);background:#141210;color:#fff;padding:10px 18px;border-radius:20px;font:14px Inter;z-index:5000'; document.body.appendChild(d); setTimeout(()=>d.remove(),1600); }

  // ---------- profile editing ----------
  const statusInput=document.getElementById('statusInput');
  statusInput.onchange=()=>{ myStatus=statusInput.value.trim(); localStorage.setItem('wm_status',myStatus); saveProfile(); };
  document.getElementById('profName').onclick=()=>{ const n=prompt('Your name on the map:',myName); if(n&&n.trim()){ myName=n.trim().slice(0,20); localStorage.setItem('wm_name',myName); paintIdentity(); saveProfile(); } };
  // photo picker
  const fileInput=document.createElement('input'); fileInput.type='file'; fileInput.accept='image/*'; fileInput.style.display='none'; document.body.appendChild(fileInput);
  document.getElementById('profAv').onclick=()=>fileInput.click();
  fileInput.onchange=e=>{const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{const img=new Image();img.onload=()=>{const S=96,cv=document.createElement('canvas');cv.width=S;cv.height=S;const x=cv.getContext('2d');const side=Math.min(img.width,img.height);x.drawImage(img,(img.width-side)/2,(img.height-side)/2,side,side,0,0,S,S);myPhoto=cv.toDataURL('image/jpeg',0.7);localStorage.setItem('wm_photo',myPhoto);photoCache.set(myId,myPhoto);paintIdentity();saveProfile();};img.src=rd.result;};rd.readAsDataURL(f);};
  async function saveProfile(){ try{ await fetch('/profile/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:myId,name:myName,photo:myPhoto||null,status:myStatus})}); }catch(_){} }

  // ---------- sharing ----------
  let sharing=false, watch=null, lastSent=0;
  const shareFab=document.getElementById('shareFab'), shareLabel=document.getElementById('shareLabel'), fabPulse=shareFab.querySelector('.pulse');
  const shareSwitch=document.getElementById('shareSwitch'), stState=document.getElementById('stState'), stSub=document.getElementById('stSub');
  function setSharingUI(on){
    shareFab.classList.toggle('on',on); shareLabel.textContent=on?'Sharing':'Share location'; fabPulse.style.display=on?'block':'none';
    shareSwitch.classList.toggle('on',on);
    stState.innerHTML=on?'<span class="d"></span>Sharing':'<span class="d" style="background:#B9B0A2"></span>Hidden';
    stSub.textContent=on?'Your location is visible to your circle.':'You are not sharing your location.';
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
      if(c.accuracy>60&&sentOnce) return;
      if(now-lastSent<800) return; lastSent=now; sentOnce=true;
      fetch('/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        id:myId,name:myName,lat:c.latitude,lon:c.longitude,circles:myCircle?[myCircle]:[],
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
    fetch('/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:myId})}).catch(()=>{});
  }
  shareFab.onclick=()=>sharing?stopShare():startShare();
  shareSwitch.onclick=()=>sharing?stopShare():startShare();
  setSharingUI(false);

  // ---------- trips ----------
  let tripActive=false, tripTimer=null, summaryMap=null, summaryLine=null;
  const fmtDur=s=>{const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=Math.round(s%60);return (h>0?h+':'+String(m).padStart(2,'0'):m)+':'+String(ss).padStart(2,'0');};
  const fmtDurHMS=s=>{const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=Math.round(s%60);return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(ss).padStart(2,'0');};

  document.getElementById('tripStartBtn').onclick=startTrip;
  document.getElementById('tripEndBtn').onclick=endTrip;
  ['profBtn3'].forEach(id=>{const e=document.getElementById(id);if(e)e.onclick=()=>showTab('profile');});
  ['msgBtn4'].forEach(id=>{const e=document.getElementById(id);if(e)e.onclick=()=>alert('Messages — coming in a later phase.');});
  document.getElementById('summaryBack').onclick=()=>showTab('trips');

  async function startTrip(){
    if(!sharing){ startShare(); }  // a trip records on top of sharing
    try{
      await fetch('/trip/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:myId,name:myName})});
      tripActive=true;
      document.getElementById('tripsIdle').style.display='none';
      document.getElementById('tripsLive').style.display='block';
      document.getElementById('tripsTitle').textContent='Recording trip';
      tripTimer=setInterval(pollTrip,1500); pollTrip();
    }catch(_){ toast('Could not start trip'); }
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
  function poll(){ fetch('/positions'+circleQS,{cache:'no-store'}).then(r=>r.json()).then(handle).catch(()=>{}); }
  function connect(){
    poll();
    try{ const es=new EventSource('/stream'+circleQS); es.onmessage=e=>{try{handle(JSON.parse(e.data));}catch(_){}}; es.onerror=()=>{es.close();setInterval(poll,4000);}; }
    catch(_){ setInterval(poll,4000); }
  }
  connect();
  requestAnimationFrame(animate);
})();
