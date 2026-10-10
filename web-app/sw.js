const PREFIX='mlc-shell-'+new URL(self.registration.scope).pathname+'-';
const CACHE=PREFIX+'v1.0.10';
const FILES=['./','./index.html','./style.css','./app.js','./js/media.js','./js/protocol.js','./js/storage.js','./js/faces.js','./js/ble.js','./js/converter.js','./js/pairing.js','./js/administration.js','./vendor/gifuct.js','./vendor/qrcode.js','./assets/companion.svg','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
  const allowed=FILES.some(file=>new URL(file,self.registration.scope).pathname===url.pathname);if(!allowed)return;
  event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(()=>caches.match(event.request).then(cached=>cached||Response.error())));
});
