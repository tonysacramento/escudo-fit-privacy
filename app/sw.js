const CACHE='escudo-fit-web-v30-campaign-local-v1';
const ASSETS=[
  './',
  './index.html',
  './styles.css?v=web-v43-sync-recovery-20',
  './history-sync-contract.js?v=web-v43-sync-recovery-20',
  './history-backup-bridge.js?v=web-v43-sync-recovery-20',
  './web-reminders.js?v=web-v43-sync-recovery-20',
  './app.js?v=web-v43-sync-recovery-20',
  './body-map.js?v=web-v43-sync-recovery-20',
  './android-icon.svg',
  './icon-approved-v43.png',
  './splash-approved-v43.png',
  './campaign/escudo-fit-01.png',
  './campaign/escudo-fit-02.png',
  './campaign/escudo-fit-03.png',
  './campaign/escudo-fit-04.png',
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
  // Audit credentials/results use POST and memory only. Its page also needs a
  // fresh network response; never replace it with a cached product/login page.
  if(url.pathname.startsWith(new URL('./pilot-audit/',self.location.href).pathname))return;
  if(url.pathname.startsWith(new URL('./pilot-pix/',self.location.href).pathname))return;

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



/*
 * Web Push receiver only. Real background delivery REQUIRES a separately
 * deployed authenticated subscription API, VAPID keys, scheduler and user opt-in.
 * Do not include a drug name, dose, treatment status or user identity on lock screens.
 */
self.addEventListener('push',event=>{
  let payload=null;
  try{payload=event.data?.json()}catch{return}
  const kind=String(payload?.kind||'').toUpperCase();
  if(kind!=='HYDRATION'&&kind!=='APPLICATION')return;
  const message=kind==='HYDRATION'
    ?'Confira sua hidratação no Escudo Fit.'
    :'Confira um lembrete da sua rotina no Escudo Fit.';
  event.waitUntil(self.registration.showNotification('Escudo Fit — lembrete',{
    body:message,
    icon:'./icon-approved-v43.png',
    badge:'./icon-approved-v43.png',
    tag:kind==='HYDRATION'?'escudofit-web-hydration':'escudofit-web-application',
    data:{url:new URL('./',self.registration.scope).href,kind},
  }));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL('./',self.registration.scope);
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=windows.find(client=>new URL(client.url).origin===target.origin&&
      new URL(client.url).pathname.startsWith(target.pathname));
    if(existing)return existing.focus();
    return self.clients.openWindow(target.href);
  })());
});
