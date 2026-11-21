'use strict';
const CATS=['All','Starters','Mains','Breads & Rice','Drinks','Desserts'];
const REQ={help:['Call waiter','Someone will come to your table'],bill:['Request bill','We bring it to the table'],water:['Water','Refill for the table'],clean:['Clean table','Clear plates and wipe']};
const S={mode:'guest',table:null,cat:'All',cart:{},note:'',cartOpen:false,menu:[],settings:{hotel:'',tables:12,soldOut:[]},
  orders:[],requests:[],wifi:null,link:'connecting',
  authed:null,loginErr:'',mgr:{orders:[],requests:[],settings:{},stats:{ordersToday:0,salesToday:0}},filter:0,alerts:false,dirty:false};
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rs=n=>'₹'+Number(n).toLocaleString('en-IN');
const ago=t=>{const m=Math.max(0,Math.round((Date.now()-t)/60000));return m<1?'just now':m<60?m+' min ago':Math.floor(m/60)+' h '+(m%60)+' min ago'};
const byId=id=>S.menu.find(m=>m.id===id);

async function api(url,opt={}){
  const r=await fetch(url,{credentials:'same-origin',method:opt.method||'GET',headers:{'Content-Type':'application/json'},body:opt.body?JSON.stringify(opt.body):undefined});
  let j=null;try{j=await r.json()}catch(e){}
  if(!r.ok){const e=new Error((j&&j.error)||'Request failed');e.status=r.status;throw e}
  return j;
}

/* ---------- alerts ---------- */
let ac;
function beep(){if(!S.alerts)return;try{ac=ac||new(window.AudioContext||window.webkitAudioContext)();const o=ac.createOscillator(),g=ac.createGain();o.connect(g);g.connect(ac.destination);o.frequency.value=880;g.gain.setValueAtTime(.15,ac.currentTime);g.gain.exponentialRampToValueAtTime(.001,ac.currentTime+.4);o.start();o.stop(ac.currentTime+.4)}catch(e){}}
function alertStaff(msg){beep();toast(msg);try{if(document.hidden&&'Notification' in window&&Notification.permission==='granted')new Notification(S.settings.hotel||'Tableside',{body:msg})}catch(e){}}
let tt;function toast(m){let t=$('#toast');if(!t){t=document.createElement('div');t.id='toast';t.className='toast';t.setAttribute('role','status');document.body.appendChild(t)}t.textContent=m;t.hidden=false;clearTimeout(tt);tt=setTimeout(()=>t.hidden=true,3200)}

/* ---------- derived ---------- */
const cartItems=()=>Object.entries(S.cart).filter(([,q])=>q>0).map(([id,q])=>({...byId(id),qty:q})).filter(i=>i.id);
const cartTotal=()=>cartItems().reduce((a,i)=>a+i.price*i.qty,0);
const cartCount=()=>cartItems().reduce((a,i)=>a+i.qty,0);
const openReq=(t,type)=>S.requests.find(r=>r.table===t&&r.type===type);
const mgrTableOrders=t=>S.mgr.orders.filter(o=>o.table===t);

/* ---------- views ---------- */
function head(){
  const pill=S.link==='live'?'<span class="pill live">Live</span>':S.link==='error'?'<span class="pill">Connection problem, retrying</span>':'<span class="pill">Connecting</span>';
  const out=S.mode==='manager'&&S.authed?'<button class="btn sm" data-a="logout">Log out</button>':'';
  return `<div class="brand"><b>${esc(S.settings.hotel||'Tableside')}</b><span>${S.mode==='manager'?'Manager dashboard':'Order from your table'}</span></div><div class="row">${pill}${out}</div>`;
}
function tablePicker(){
  let b='';for(let i=1;i<=S.settings.tables;i++)b+=`<button data-a="table" data-t="${i}">${i}</button>`;
  return `<section class="card"><h2>Which table are you at?</h2><p class="muted">Pick your table number so the waiter knows where to bring your order. The number is printed on the table.</p><div class="tables">${b}</div></section>`;
}
function guestView(){
  if(!S.table)return tablePicker();
  const t=S.table,mine=S.orders,unlocked=!!S.wifi;
  const helpBtns=Object.entries(REQ).map(([k,[n,sub]])=>{const o=openReq(t,k);
    return `<button class="btn ${k==='help'?'help':''}" data-a="req" data-k="${k}" ${o?'disabled':''}><b>${n}</b><small>${o?'Sent '+ago(o.createdAt):sub}</small></button>`}).join('');
  const wifi=unlocked?`<section class="card wifi"><div><h3>Free Wi-Fi unlocked</h3><div class="small muted">Thanks for ordering. Connect with these details.</div></div>
      <div class="small">Network <code>${esc(S.wifi.name)}</code><br>Password <code>${esc(S.wifi.pass)}</code></div></section>`
    :`<section class="card wifi locked"><div><h3>Free Wi-Fi</h3><div class="small muted">Place any order and the Wi-Fi details appear here.</div></div></section>`;
  const orders=mine.length?`<section class="card"><h2>Your orders</h2><div style="display:grid;gap:12px;margin-top:10px">${mine.map(o=>
    `<div><div class="line"><span class="status s-${o.status}">${{new:'Sent to kitchen',preparing:'Being prepared',served:'Served'}[o.status]}</span><span class="muted small">${ago(o.createdAt)}</span></div>
     ${o.items.map(i=>`<div class="line small"><span>${i.qty} × ${esc(i.name)}</span><span>${rs(i.price*i.qty)}</span></div>`).join('')}
     <div class="line"><b>Total</b><b class="price">${rs(o.total)}</b></div></div>`).join('<hr style="border:0;border-top:1px solid var(--line);width:100%">')}</div>
     <div class="line" style="margin-top:12px"><span>Bill so far</span><b class="price">${rs(mine.reduce((a,o)=>a+o.total,0))}</b></div></section>`:'';
  const list=S.menu.filter(m=>S.cat==='All'||m.cat===S.cat).map(m=>{
    const out=S.settings.soldOut.includes(m.id),q=S.cart[m.id]||0;
    return `<div class="card item ${out?'out':''}"><div><div class="t"><span class="vm ${m.veg?'':'nv'}" title="${m.veg?'Vegetarian':'Non-vegetarian'}"></span>${esc(m.name)}</div><p>${esc(m.d)}</p><p>${m.time} min</p></div>
      <div style="text-align:right;display:grid;gap:8px;justify-items:end"><span class="price">${rs(m.price)}</span>
      ${out?'<span class="small muted">Sold out</span>':q?`<div class="qty"><button data-a="dec" data-id="${m.id}" aria-label="Remove one">−</button><span>${q}</span><button data-a="inc" data-id="${m.id}" aria-label="Add one">+</button></div>`:`<button class="add" data-a="inc" data-id="${m.id}">Add</button>`}</div></div>`}).join('');
  return `<section class="card"><div class="row between"><div><span class="muted small">You are at</span><h2>Table ${t}</h2></div><button class="btn sm" data-a="change">Change table</button></div>
    <div class="helpbar" style="margin-top:12px">${helpBtns}</div></section>
    ${wifi}${orders}
    <section style="display:grid;gap:12px"><div class="chips" role="group" aria-label="Menu category">${CATS.map(c=>`<button data-a="cat" data-c="${esc(c)}" aria-pressed="${S.cat===c}">${esc(c)}</button>`).join('')}</div>
    <div class="menu">${list}</div></section>`;
}
function cartSheet(){
  const it=cartItems();
  return `<div class="shade" data-a="closecart"><div class="sheet" role="dialog" aria-label="Your order" data-stop="1">
    <div class="row between"><h2>Your order · Table ${S.table}</h2><button class="btn sm" data-a="closecart">Close</button></div>
    ${it.map(i=>`<div class="line" style="align-items:center"><span>${esc(i.name)}<br><span class="muted small">${rs(i.price)} each</span></span>
      <div class="qty"><button data-a="dec" data-id="${i.id}" aria-label="Remove one">−</button><span>${i.qty}</span><button data-a="inc" data-id="${i.id}" aria-label="Add one">+</button></div></div>`).join('')}
    <label for="note">Note for the kitchen<textarea id="note" rows="2" maxlength="200" placeholder="Less spicy, no onion, allergies">${esc(S.note)}</textarea></label>
    <div class="line"><b>Total</b><b class="price">${rs(cartTotal())}</b></div>
    <button class="btn primary" data-a="place" style="padding:13px">Send order to kitchen</button>
    <div class="small muted">Pay at the table when you are done. Free Wi-Fi unlocks after you order.</div></div></div>`;
}
function loginView(){
  return `<section class="card" style="max-width:380px;margin:40px auto;width:100%"><form id="login" style="display:grid;gap:12px"><h2>Manager login</h2>
    <label for="pin">PIN<input type="password" id="pin" inputmode="numeric" autocomplete="current-password" autofocus></label>
    ${S.loginErr?`<div class="note" role="alert">${esc(S.loginErr)}</div>`:''}
    <button class="btn primary" type="submit" style="padding:12px">Log in</button></form></section>`;
}
function managerView(){
  if(S.authed===null)return '<div class="empty">Loading</div>';
  if(!S.authed)return loginView();
  const M=S.mgr,open=M.orders,reqs=M.requests,sold=M.settings.soldOut||[];
  let map='';
  for(let i=1;i<=(M.settings.tables||12);i++){
    const os=mgrTableOrders(i),amt=os.reduce((a,o)=>a+o.total,0),call=reqs.some(r=>r.table===i);
    map+=`<button class="${call?'call':os.length?'busy':''}" data-a="filter" data-t="${i}" aria-pressed="${S.filter===i}"><b>${i}</b><span class="small">${call?'Needs help':os.length?rs(amt):'Free'}</span></button>`}
  const shown=open.filter(o=>!S.filter||o.table===S.filter);
  const card=o=>{const next={new:['Start preparing','preparing'],preparing:['Mark served','served'],served:['Mark paid','paid']}[o.status];
    return `<div class="card order ${o.status}"><div class="line"><h3>Table ${o.table}</h3><span><span class="status s-${o.status}">${o.status}</span> · <span class="muted small">${ago(o.createdAt)}</span></span></div>
      <ul>${o.items.map(i=>`<li><b>${i.qty}×</b> ${esc(i.name)}</li>`).join('')}</ul>${o.note?`<div class="note">${esc(o.note)}</div>`:''}
      <div class="row between" style="margin-top:10px"><b class="price">${rs(o.total)}</b><span class="row">${o.status==='new'?`<button class="btn sm" data-a="cancel" data-id="${o.id}">Cancel</button>`:''}<button class="btn sm primary" data-a="status" data-id="${o.id}" data-s="${next[1]}">${next[0]}</button></span></div></div>`};
  return `<div class="stats">
    <div class="card stat"><span class="muted small">Open orders</span><b>${open.length}</b></div>
    <div class="card stat ${reqs.length?'alert':''}"><span class="muted small">Waiting for staff</span><b>${reqs.length}</b></div>
    <div class="card stat"><span class="muted small">Orders today</span><b>${M.stats.ordersToday}</b></div>
    <div class="card stat"><span class="muted small">Sales today</span><b>${rs(M.stats.salesToday)}</b></div></div>
  <section class="card"><div class="row between"><h2>Tables</h2><span class="row"><button class="btn sm" data-a="alerts">${S.alerts?'Alerts on':'Turn on sound and notifications'}</button>${S.filter?'<button class="btn sm" data-a="filter" data-t="0">Show all tables</button>':''}</span></div>
    <div class="tmap" style="margin-top:12px">${map}</div></section>
  <div class="cols"><section class="board"><h2>Orders${S.filter?' · Table '+S.filter:''}</h2>${shown.length?shown.map(card).join(''):'<div class="card empty">No open orders. New ones appear here the moment a guest sends them.</div>'}</section>
  <aside style="display:grid;gap:18px">
    <section class="card"><h2>Requests</h2><div style="margin-top:6px">${reqs.length?reqs.map(r=>`<div class="req"><div><b>Table ${r.table}</b> · ${REQ[r.type][0]}<br><span class="muted small">${ago(r.createdAt)}</span></div><button class="btn sm primary" data-a="done" data-id="${r.id}">Done</button></div>`).join(''):'<div class="empty">No one is waiting.</div>'}</div></section>
    <section class="card"><h2>Menu availability</h2><div style="margin-top:6px">${S.menu.map(m=>`<label class="toggle" style="font-weight:500;color:var(--ink)"><span>${esc(m.name)}</span><input type="checkbox" data-a="avail" data-id="${m.id}" ${sold.includes(m.id)?'':'checked'} aria-label="${esc(m.name)} available"></label>`).join('')}</div></section>
    <section class="card" style="display:grid;gap:10px"><h2>Settings</h2>
      <label for="s-hotel">Hotel name<input type="text" id="s-hotel" data-set="hotel" value="${esc(M.settings.hotel)}"></label>
      <label for="s-wn">Wi-Fi network<input type="text" id="s-wn" data-set="wifiName" value="${esc(M.settings.wifiName)}"></label>
      <label for="s-wp">Wi-Fi password<input type="text" id="s-wp" data-set="wifiPass" value="${esc(M.settings.wifiPass)}"></label>
      <label for="s-t">Number of tables<input type="number" id="s-t" min="1" max="60" data-set="tables" value="${M.settings.tables}"></label>
      <a class="btn sm" href="/qr.html" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">Print table QR codes</a></section>
  </aside></div>`;
}
function render(force){
  const a=document.activeElement;
  if(!force&&a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.type!=='checkbox'){S.dirty=true;return}
  S.dirty=false;
  $('#head').innerHTML=head();
  $('#app').innerHTML=S.mode==='manager'?managerView():guestView();
  const n=cartCount();
  $('#layer').innerHTML=S.mode==='guest'&&S.table?(S.cartOpen&&n?cartSheet():(n?`<div class="cartbar"><button class="btn primary" data-a="opencart"><span>View order · ${n} item${n>1?'s':''}</span><span class="price">${rs(cartTotal())}</span></button></div>`:'')):'';
}
document.addEventListener('focusout',()=>{if(S.dirty)setTimeout(()=>render(),0)});

/* ---------- guest: poll the server ---------- */
async function pullTable(){
  if(S.mode!=='guest'||!S.table||document.hidden)return;
  try{const r=await api('/api/table/'+S.table);S.orders=r.orders;S.requests=r.requests;S.wifi=r.wifi;S.settings={...S.settings,...r.settings};S.link='live'}
  catch(e){if(e.status===404){S.table=null;S.link='live'}else S.link='error'}
  render();
}
setInterval(pullTable,5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)pullTable()});

/* ---------- manager: live stream ---------- */
let es;
function applyState(st,first){
  if(!first){
    st.orders.filter(o=>o.status==='new'&&!S.mgr.orders.some(x=>x.id===o.id)).forEach(o=>alertStaff('New order from table '+o.table));
    st.requests.filter(r=>!S.mgr.requests.some(x=>x.id===r.id)).forEach(r=>alertStaff('Table '+r.table+': '+REQ[r.type][0]));
  }
  S.mgr=st;S.settings={...S.settings,hotel:st.settings.hotel,tables:st.settings.tables,soldOut:st.settings.soldOut};S.link='live';render();
}
function openStream(){
  if(es)es.close();
  let first=true;
  es=new EventSource('/api/manager/stream');
  es.onmessage=e=>{applyState(JSON.parse(e.data),first);first=false};
  es.onerror=async()=>{S.link='error';render();try{await api('/api/manager/state')}catch(e){if(e.status===401){es.close();S.authed=false;render(true)}}};
}
async function managerInit(){
  try{const st=await api('/api/manager/state');S.authed=true;applyState(st,true);openStream()}
  catch(e){S.authed=false;S.link='live';render(true)}
}
setInterval(()=>{if(S.mode==='manager'&&S.authed)render()},30000);

/* ---------- actions ---------- */
const run=async(fn,ok)=>{try{await fn();if(ok)toast(ok)}catch(e){toast(e.message||'Could not send. Check your connection and try again.')}};
const A={
  table:d=>{S.table=+d.t;try{sessionStorage.setItem('tb_table',d.t)}catch(e){}history.replaceState(null,'','/t/'+d.t);S.orders=[];S.requests=[];S.wifi=null;render(true);pullTable()},
  change:()=>{S.table=null;S.cart={};S.cartOpen=false;try{sessionStorage.removeItem('tb_table')}catch(e){}history.replaceState(null,'','/');render(true)},
  cat:d=>{S.cat=d.c;render(true)},
  inc:d=>{S.cart[d.id]=(S.cart[d.id]||0)+1;render(true)},
  dec:d=>{S.cart[d.id]=Math.max(0,(S.cart[d.id]||0)-1);if(!cartCount())S.cartOpen=false;render(true)},
  opencart:()=>{S.cartOpen=true;render(true)},
  closecart:()=>{S.cartOpen=false;render(true)},
  place:()=>run(async()=>{
    const items=cartItems().map(i=>({id:i.id,qty:i.qty}));if(!items.length)return;
    await api('/api/orders',{method:'POST',body:{table:S.table,items,note:S.note.trim()}});
    S.cart={};S.note='';S.cartOpen=false;render(true);toast('Order sent to the kitchen');pullTable();
  }),
  req:d=>{if(openReq(S.table,d.k))return;run(async()=>{await api('/api/requests',{method:'POST',body:{table:S.table,type:d.k}});await pullTable()},d.k==='help'?'The manager has been called':'Request sent')},
  status:d=>run(()=>api('/api/manager/orders/'+d.id,{method:'PATCH',body:{status:d.s}})),
  cancel:d=>run(()=>api('/api/manager/orders/'+d.id,{method:'PATCH',body:{status:'cancelled'}})),
  done:d=>run(()=>api('/api/manager/requests/'+d.id,{method:'PATCH',body:{status:'done'}})),
  filter:d=>{S.filter=S.filter===+d.t?0:+d.t;render(true)},
  alerts:async()=>{S.alerts=!S.alerts;if(S.alerts){beep();try{if('Notification' in window&&Notification.permission==='default')await Notification.requestPermission()}catch(e){}toast('Alerts on')}render(true)},
  avail:(d,el)=>{const s=new Set(S.mgr.settings.soldOut||[]);el.checked?s.delete(d.id):s.add(d.id);run(()=>api('/api/manager/settings',{method:'PUT',body:{soldOut:[...s]}}))},
  logout:async()=>{try{await api('/api/logout',{method:'POST'})}catch(e){}if(es)es.close();S.authed=false;S.mgr={orders:[],requests:[],settings:{},stats:{ordersToday:0,salesToday:0}};render(true)}
};
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-a]');if(!t||t.tagName==='INPUT')return;
  if(t.dataset.a==='closecart'&&e.target.closest('[data-stop]')&&!e.target.closest('button[data-a="closecart"]'))return;
  if(A[t.dataset.a])A[t.dataset.a](t.dataset,t);
});
document.addEventListener('input',e=>{if(e.target.id==='note')S.note=e.target.value});
document.addEventListener('change',e=>{
  const el=e.target;
  if(el.dataset.a==='avail')A.avail(el.dataset,el);
  else if(el.dataset.set){const k=el.dataset.set;let v=el.value;if(k==='tables')v=Math.min(60,Math.max(1,parseInt(v)||12));run(()=>api('/api/manager/settings',{method:'PUT',body:{[k]:v}}),'Saved')}
});
document.addEventListener('submit',async e=>{
  if(e.target.id!=='login')return;e.preventDefault();
  try{await api('/api/login',{method:'POST',body:{pin:$('#pin').value}});S.loginErr='';await managerInit()}
  catch(err){S.loginErr=err.message;render(true)}
});

/* ---------- start ---------- */
(async function(){
  const p=location.pathname;
  S.mode=p.startsWith('/manager')?'manager':'guest';
  try{const r=await api('/api/menu');S.menu=r.menu;S.settings=r.settings;S.link='live'}catch(e){S.link='error'}
  if(S.mode==='guest'){
    const m=p.match(/^\/t\/(\d+)$/)||location.search.match(/[?&]t=(\d+)/);
    if(m)S.table=+m[1];else try{const t=sessionStorage.getItem('tb_table');if(t)S.table=+t}catch(e){}
    render(true);pullTable();
  }else{render(true);managerInit()}
})();
