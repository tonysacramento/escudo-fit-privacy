const CACHE='escudo-fit-web-v18-weight-silent-sync';
const ASSETS=[
  './',
  './index.html',
  './styles.css?v=web-v44-weight-silent-sync-9',
  './history-sync-contract.js?v=web-v44-weight-silent-sync-9',
  './history-backup-bridge.js?v=web-v44-weight-silent-sync-9',
  './app.js?v=web-v44-weight-silent-sync-9',
  './body-map.js?v=web-v44-weight-silent-sync-9',
  './weight-chart.js?v=web-v44-weight-silent-sync-9',
  './session-idle-policy.js?v=web-v44-weight-silent-sync-9',
  './android-icon.svg',
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
