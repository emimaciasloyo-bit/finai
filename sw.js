const C='finai-v6';
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
  const url=e.request.url;
  // Only handle same-origin GET requests — never touch API, fonts, or external calls
  if(e.request.method!=='GET') return;
  if(url.includes('anthropic.com')) return;
  if(url.includes('googleapis.com')) return;
  if(url.includes('youtube.com')) return;
  if(url.includes('ytimg.com')) return;
  if(!url.startsWith(self.location.origin)) return;
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request).then(r=>r||new Response('Offline',{status:503}))));
});
self.addEventListener('push',e=>{const d=e.data?e.data.json():{title:'FinAI',body:'Market update ready.'};e.waitUntil(self.registration.showNotification(d.title||'FinAI',{body:d.body||'',icon:'/icons/icon-192.png',badge:'/icons/icon-72.png',tag:d.tag||'finai',renotify:true}));});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window'}).then(l=>l.length?l[0].focus():clients.openWindow('/')));});
self.addEventListener('message',e=>{if(e.data&&e.data.type==='SCHED'){const{delay:d,title:t,body:b,tag:g}=e.data;setTimeout(()=>{self.registration.showNotification(t,{body:b,icon:'/icons/icon-192.png',tag:g||'sched',renotify:true});},d);}});
