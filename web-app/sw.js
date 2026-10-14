const PREFIX='mlc-shell-'+new URL(self.registration.scope).pathname+'-';
const CACHE=PREFIX+'v1.3.1';
const FILES=['./','./index.html','./style.css?v=1.3.1','./app.js?v=1.3.1','./js/media.js','./js/media.js?v=1.3.1','./js/protocol.js','./js/protocol.js?v=1.3.1','./js/storage.js','./js/experience-ui.js?v=1.3.1','./js/experience-format.js?v=1.3.1','./js/smart-sync.js?v=1.3.1','./js/storage-info.js?v=1.3.1','./js/faces.js','./js/ble.js?v=1.3.1','./js/battery.js?v=1.3.1','./js/power.js?v=1.3.1','./js/subtitle.js?v=1.3.1','./js/subtitle-format.js?v=1.3.1','./js/converter.js','./js/pairing.js?v=1.3.1','./js/administration.js','./vendor/gifuct.js','./vendor/qrcode.js','./assets/companion.svg','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
  const allowed=FILES.some(file=>new URL(file,self.registration.scope).pathname===url.pathname);if(!allowed)return;
  event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(()=>caches.match(event.request).then(cached=>cached||Response.error())));
});
