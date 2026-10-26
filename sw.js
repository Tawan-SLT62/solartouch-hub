// Service worker: cache the app shell so the site opens fast and works offline.
// Team data is cached separately by Firestore's own offline storage.
const CACHE='solartouch-v5';
const SHELL=['./','index.html','styles.css','vendor/leaflet.css','app.js','firebase-config.js','manifest.webmanifest','favicon.png','icon-192.png','logo.png','logo-data.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  // network first, fall back to cache (so updates pushed to GitHub show up right away)
  e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('index.html'))));
});
