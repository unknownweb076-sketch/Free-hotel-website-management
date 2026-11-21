'use strict';
const grid=document.getElementById('grid'),n=document.getElementById('n');
function build(){
  grid.innerHTML='';
  const count=Math.min(60,Math.max(1,parseInt(n.value)||12));
  for(let i=1;i<=count;i++){
    const c=document.createElement('div');c.className='card';
    c.innerHTML='<h2>Table '+i+'</h2><p>Scan to order, call the waiter and get free Wi-Fi</p><div class="qr"></div>';
    grid.appendChild(c);
    if(window.QRCode)new QRCode(c.querySelector('.qr'),{text:location.origin+'/t/'+i,width:170,height:170});
  }
}
fetch('/api/menu').then(r=>r.json()).then(j=>{n.value=j.settings.tables;build()}).catch(build);
document.getElementById('go').onclick=build;
document.getElementById('pr').onclick=()=>window.print();
