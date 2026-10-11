const CACHE='escudo-fit-web-v21-brand-install';
const ASSETS=[
  './',
  './index.html',
  './styles.css?v=web-v43-brand-install-12',
  './history-sync-contract.js?v=web-v43-brand-install-12',
  './history-backup-bridge.js?v=web-v43-brand-install-12',
  './app.js?v=web-v43-brand-install-12',
  './body-map.js?v=web-v43-brand-install-12',
  './android-icon.svg',
  './icon-approved-v43.png',
  './splash-approved-v43.png',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(cache=>cache.addAll(ASSETS))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const request=event.request;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;

  const networkFirst=
    request.mode==='navigate' ||
    request.destination==='document' ||
    request.destination==='script' ||
    request.destination==='style';

  if(networkFirst){
    event.respondWith(
      fetch(request,{cache:'no-store'})
        .then(response=>{
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put(request,copy));
          return response;
        })
        .catch(()=>caches.match(request).then(cached=>cached||caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request)
      .then(cached=>cached||fetch(request).then(response=>{
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(request,copy));
        return response;
      }))
  );
});

