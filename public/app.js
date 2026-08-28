(function(){
  "use strict";

  // ---------- theme ----------
  const root=document.documentElement;
  const savedTheme=localStorage.getItem('wm_theme'); if(savedTheme) root.setAttribute('data-theme',savedTheme);
  function applyThemeUI(){
    const t=root.getAttribute('data-theme');
    const tv=document.getElementById('themeVal'); if(tv) tv.textContent = t==='dark'?'Dark':'Light';
    if(typeof applyTiles==='function') applyTiles();
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
    ['profImg','profImg2'].forEach(id=>{const e=document.getElementById(id); if(!e)return; if(myPhoto){e.src=myPhoto;e.style.display='block';}else e.style.display='none';});
    ['profIni','profIni2'].forEach(id=>{const e=document.getElementById(id); if(!e)return; e.style.display=myPhoto?'none':'block'; e.textContent=initials(myName);});
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
  const pages={map:document.getElementById('page-map'),friends:document.getElementById('page-friends'),trips:document.getElementById('page-trips'),profile:document.getElementById('page-profile')};
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
    light:{url:'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',attribution:'&copy; OpenStreetMap &copy; CARTO',sub:'abcd'},
    dark:{url:'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',attribution:'&copy; OpenStreetMap &copy; CARTO',sub:'abcd'}
  };
  let tileLayer=null;
  function applyTiles(){
    const theme=root.getAttribute('data-theme')==='dark'?'dark':'light';
    if(tileLayer) map.removeLayer(tileLayer);
    const t=TILES[theme];
    tileLayer=L.tileLayer(t.url,{maxZoom:20,attribution:t.attribution,subdomains:t.sub}).addTo(map);
  }
  applyTiles();

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

  // ---------- friend card (tap on map) — minimal for phase 1 ----------
  let openCardId=null;
  function openFriendCard(id){ openCardId=id; renderFriendCard(id); }
  function renderFriendCard(id){
    const p=people.get(id); if(!p) return; const f=p.data;
    const mp=myPos(); const dist=mp?metres(mp[0],mp[1],f.lat,f.lon):null;
    // phase-1: simple popup; full sheet comes with the design build
    const eta=(dist!=null)?Math.max(1,Math.round(dist/((Math.max(f.speed,4.5))*1000/60))):null;
    L.popup({closeButton:true,autoPan:true})
      .setLatLng([p.lat,p.lon])
      .setContent(`<div style="font-family:Inter,sans-serif;min-width:150px">
        <b style="font-size:15px">${esc(f.name)}</b>${f.status?`<div style="color:#E8562A;font-size:12px;font-weight:600">${esc(f.status)}</div>`:''}
        <div style="display:flex;gap:12px;margin-top:8px;font-size:12px">
          <div><b style="font-size:15px">${Math.round(f.speed||0)}</b><br>km/h</div>
          <div><b style="font-size:15px">${dist!=null?fmtDist(dist):'—'}</b><br>away</div>
          <div><b style="font-size:15px">${eta!=null?eta+'m':'—'}</b><br>ETA</div>
          <div><b style="font-size:15px">${f.battery!=null?f.battery+'%':'—'}</b><br>batt</div>
        </div></div>`)
      .openOn(map);
    openCardId=null; // popup is one-shot
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
    if(!('geolocation'in navigator)){ toast('Location not available'); return; }
    sharing=true; setSharingUI(true);
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
      toast(err.code===1?'Allow location, then tap Share again':'Can’t get your location');
      sharing=false; setSharingUI(false);
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

  // ---------- live connection ----------
  function poll(){ fetch('/positions'+circleQS,{cache:'no-store'}).then(r=>r.json()).then(handle).catch(()=>{}); }
  function connect(){
    poll();
    try{ const es=new EventSource('/stream'+circleQS); es.onmessage=e=>{try{handle(JSON.parse(e.data));}catch(_){}}; es.onerror=()=>{es.close();setInterval(poll,4000);}; }
    catch(_){ setInterval(poll,4000); }
  }
  connect();
  requestAnimationFrame(animate);
})();
