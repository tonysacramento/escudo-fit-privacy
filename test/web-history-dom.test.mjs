import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { JSDOM }=require('jsdom');

const html=readFileSync('app/index.html','utf8');
const js=readFileSync('app/app.js','utf8');
const contract=readFileSync('app/history-sync-contract.js','utf8');
const bridge=readFileSync('app/history-backup-bridge.js','utf8');
const pause=()=>new Promise(resolve=>setTimeout(resolve,55));

test('synthetic authenticated Web session renders all categories and posts two-way compatible records',async()=>{
  const dom=new JSDOM(html,{
    url:'https://escudofit.example/app/',runScripts:'outside-only',pretendToBeVisual:true,
  });
  const {window}=dom;
  try {
  window.scrollTo=()=>{};
  window.HTMLElement.prototype.scrollIntoView=()=>{};
  window.localStorage.setItem('escudofit_web_auth_v1',JSON.stringify({
    user:{id:'qa-user',email:'qa@example.invalid',name:'QA'},
    access_token:'test-access',refresh_token:'test-refresh',
    entitlement:{mode:'PREMIUM'}
  }));
  const now=Date.now()-10000;
  const date=new Date().toLocaleDateString('en-CA'); // current local synthetic day in CI
  const apiDate=/^\d{4}-\d{2}-\d{2}$/.test(date)?date:new Date().toISOString().slice(0,10);
  const payload={
    weights:[{id:'w1',weightKg:87.2,timestampMs:now,origin:'PROFILE'}],
    measurements:[{date:apiDate,waist:90,hips:95}],
    applications:[{id:'a1',appliedAtMs:now,applicationSite:'ABDOMEN_LEFT',scheduledDateIso:apiDate}],
    movement:[{date:apiDate,updatedAtMs:now,records:[{id:'mv1',activityType:'WALKING',timestampMs:now}]}],
    nutrition:[{date:apiDate,updatedAtMs:now,meals:[{id:'ml1',mealType:'LUNCH',proteinG:22,timestampMs:now}]}],
    treatment:{medication:'MOUNJARO',updatedAtMs:now,treatmentStartDateIso:apiDate,history:[]},
    water:[{date:apiDate,consumedMl:500,updatedAtMs:now}],
  };
  const calls=[];
  let offline=false;
  let structuredHistory=payload;
  let backupSnapshot={revision:0,entries:[]};
  window.fetch=async(url,options={})=>{
    const path=String(url);
    calls.push({path,options});
    if(offline&&path.endsWith('/history/sync'))throw new Error('SIMULATED_NETWORK_OFFLINE');
    let data={};
    if(path.endsWith('/entitlement/me'))data={mode:'PREMIUM'};
    else if(path.endsWith('/me'))data={user:{id:'qa-user',email:'qa@example.invalid',name:'QA'}};
    else if(path.endsWith('/history'))data=structuredHistory;
    else if(path.endsWith('/history/backup'))data=backupSnapshot;
    else if(path.endsWith('/history/sync')){
      const patch=JSON.parse(options.body||'{}');
      if(Array.isArray(patch.nutrition)){
        const map=new Map((Array.isArray(structuredHistory.nutrition)?structuredHistory.nutrition:[]).map(day=>[day.date,day]));
        for(const day of patch.nutrition)map.set(day.date,day);
        structuredHistory={...structuredHistory,nutrition:[...map.values()]};
      }
      data={synced:true};
    }
    else throw new Error('Unexpected API path '+path);
    return {ok:true,status:200,json:async()=>data};
  };
  window.eval(contract);
  window.eval(bridge);
  window.eval(js);
  await pause();
  const get=id=>window.document.getElementById(id);
  assert.ok(get('appExperience')&&!get('appExperience').classList.contains('hidden'),JSON.stringify({
    calls:calls.map(call=>call.path),
    auth:window.localStorage.getItem('escudofit_web_auth_v1'),
    marketing:get('marketingExperience')?.className,
    app:get('appExperience')?.className,
    login:get('loginStatus')?.textContent,
  }));
  assert.match(get('historySyncStatus').textContent,/1 pesos|1 peso/);
  assert.match(get('historySyncStatus').textContent,/1 aplicações/);
  assert.match(get('historySyncStatus').textContent,/1 refeições/);
  assert.match(get('historySyncStatus').textContent,/Nutrição recebida: API 1, backup 0/);
  assert.match(get('historySyncStatus').textContent,/1 tratamento/);
  assert.match(get('measurementHistoryList').textContent,/95/);
  assert.match(get('movementHistoryList').textContent,/Caminhada/);
  assert.match(get('nutritionHistoryList').textContent,/22/);
  assert.match(get('treatmentHistoryList').textContent,/Mounjaro/);
  // The authenticated Web must use Android's DAILY shield semantics.
  assert.equal(get('movementCount').textContent,'1');
  assert.equal(get('stepsPct').textContent,'100%', 'manual steps are not the movement shield');
  assert.equal(get('nutritionCount').textContent,'1 de 5');
  assert.equal(get('proteinPct').textContent,'20%', 'the meal goal, not grams, controls this shield');
  assert.equal(window.document.querySelectorAll('.nav-track .nav-item').length,4);
  assert.equal(window.document.querySelectorAll('.shield-list > .shield-card').length,4);
  assert.equal(window.document.querySelectorAll('.app-view[data-view="nutrition"]').length,1);
  assert.equal(window.document.querySelectorAll('.app-view[data-view="weight"]').length,1);


  // Real regression: a single Web meal is already displayed, then Android
  // uploads its two older meals on that same calendar day.
  structuredHistory={
    ...payload,
    nutrition:[{
      date:apiDate,updatedAtMs:now,
      meals:[
        {id:'ml1',mealType:'LUNCH',proteinG:22,timestampMs:now},
        {id:'android-a',mealType:'BREAKFAST',proteinG:16,timestampMs:now-1000},
        {id:'android-b',mealType:'DINNER',proteinG:28,timestampMs:now-500},
      ],
    }],
  };
  get('refreshHistoryButton').click();
  await pause();
  assert.match(get('historySyncStatus').textContent,/3 refeições/);
  assert.match(get('nutritionHistoryList').textContent,/16/);
  assert.match(get('nutritionHistoryList').textContent,/28/);
  assert.match(get('nutritionHistoryList').textContent,/22/);

  structuredHistory={...structuredHistory,nutrition:[{
    ...structuredHistory.nutrition[0],updatedAtMs:now+500,
    meals:[...structuredHistory.nutrition[0].meals,
      {id:'android-late',mealType:'SNACK',proteinG:11,timestampMs:now-250}],
  }]};
  get('nutritionMealType').value='DINNER';
  get('nutritionMealProtein').value='25';
  get('nutritionMealDescription').value='Jantar QA';
  get('nutritionAddMeal').click();
  await pause();
  const meals=calls.filter(c=>c.path.endsWith('/history/sync'))
    .map(c=>JSON.parse(c.options.body||'{}')).filter(x=>x.nutrition);
  assert.ok(meals.length>=1,'Web should POST nutrition');
  assert.equal(meals.at(-1).nutrition[0].meals.at(-1).proteinG,25);
  assert.ok(meals.at(-1).nutrition[0].meals.some(meal=>meal.id==='android-late'));
  assert.equal(meals.at(-1).nutrition[0].meals.length,5);

  get('treatmentMedication').value='WEGOVY';
  get('treatmentDose').value='registro do usuário';
  get('treatmentStart').value=apiDate;
  get('saveTreatment').click();
  await pause();
  const treatments=calls.filter(c=>c.path.endsWith('/history/sync'))
    .map(c=>JSON.parse(c.options.body||'{}')).filter(x=>x.treatment);
  assert.ok(treatments.length>=1,'Web should POST treatment');
  assert.equal(treatments.at(-1).treatment.medication,'WEGOVY');
  assert.equal(window.localStorage.getItem('escudofit_history_outbox_v1_qa-user'),'[]');

  // Old Android versions may have uploaded a backup but no structured history.
  structuredHistory={};
  const backupDate=new Date(Date.parse(apiDate+'T12:00:00.000Z')-86400000).toISOString().slice(0,10);
  backupSnapshot={
    revision:4,
    entries:[
      {key:'weight_history',value:JSON.stringify([{id:'only-in-backup',weightKg:72.3,timestampMs:now,origin:'PROFILE'}])},
      {key:'body_measurements_v1',value:JSON.stringify([{date:backupDate,waist:78,hips:97}])},
      {key:'dose_records_history',value:JSON.stringify([{id:'only-backup-dose',appliedAtMs:now,applicationSite:'ARM_RIGHT'}])},
      {key:'movement:'+backupDate,value:JSON.stringify({updatedAtMs:now,records:[{id:'bk-move',activityType:'WALKING',timestampMs:now}]})},
      {key:'nutrition:'+backupDate,value:JSON.stringify({updatedAtMs:now,meals:[{id:'bk-meal-1',mealType:'LUNCH',proteinG:33,timestampMs:now},{id:'bk-meal-2',mealType:'DINNER',proteinG:19,timestampMs:now}]})},
      {key:'water:'+backupDate,value:JSON.stringify({updatedAtMs:now,consumedMl:910})},
    ]
  };
  get('refreshHistoryButton').click();
  await pause();
  assert.ok(get('historySyncStatus').textContent.includes('Backup 200 (revisão 4, 6 conjuntos armazenados; 6 de histórico interpretados pela Web'));
  assert.match(get('weightHistory').textContent,/72,3/);
  assert.match(get('waterHistoryList').textContent,/910/);
  assert.match(get('applicationHistory').textContent,/Braço direito/);
  assert.match(get('nutritionHistoryList').textContent,/33/);
  assert.match(get('nutritionHistoryList').textContent,/19/);
  assert.match(get('historySyncStatus').textContent,/Nutrição recebida: API 0, backup 2/);

  backupSnapshot={revision:0,entries:[]};
  get('refreshHistoryButton').click();
  await pause();
  assert.match(get('historySyncStatus').textContent,/Nutrição recebida: API 0, backup 0|Nutrição ausente na conta: API 0, backup 0/);
  // Local browser data remains preserved; zero remote sources cannot erase it.
  assert.match(get('nutritionHistoryList').textContent,/33/);

  offline=true;
  get('waterReset').click();
  await pause();
  assert.equal(JSON.parse(window.localStorage.getItem('escudofit_history_outbox_v1_qa-user')||'[]').length,1,
    'offline update is queued per account');
  offline=false;
  get('refreshHistoryButton').click();
  await pause();
  assert.equal(window.localStorage.getItem('escudofit_history_outbox_v1_qa-user'),'[]',
    'pending Web write is retried before reading account history');
  } finally {
    dom.window.close();
  }
});


async function liveSession({mode='PREMIUM',failure='',savedStorage,validationGate,onBoot}={}){
  const dom=new JSDOM(html,{url:'https://escudofit.example/app/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
  const session={user:{id:'live-user',email:'live@example.invalid'},access_token:'access',refresh_token:'refresh',entitlement:{mode}};
  w.localStorage.setItem('escudofit_web_auth_v1',savedStorage||JSON.stringify(session));
  const timers=new Map();let next=0;
  w.setInterval=(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id};
  w.clearInterval=id=>timers.delete(id);
  let remote={};let reads=0;let refreshed=0;let block=null;
  const response=(status,data={})=>({status,ok:status>=200&&status<300,json:async()=>data});
  w.fetch=async(url)=>{
    const path=String(url);
    if(failure==='offline')throw Error('offline');
    if(path.endsWith('/auth/refresh')){refreshed++;return failure==='revoked'?response(401):response(200,{access_token:'new-access',refresh_token:'new-refresh'})}
    if(path.endsWith('/entitlement/me'))return response(200,{mode});
    if(path.endsWith('/me')){
      if(validationGate)await validationGate;
      if(failure==='outage')return response(503);
      if((failure==='expired'&&!refreshed)||failure==='revoked')return response(401);
      return response(200,{user:session.user});
    }
    if(path.endsWith('/history')){reads++;if(block)await block;return response(200,remote)}
    if(path.endsWith('/history/backup'))return response(200,{revision:0,entries:[]});
    return response(200);
  };
  w.eval(contract);w.eval(bridge);w.eval(js);onBoot?.(w);await pause();
  return {dom,w,timers,session,reads:()=>reads,refreshed:()=>refreshed,setRemote:value=>remote=value,block:value=>block=value,
    tick:async()=>{for(const t of timers.values())if(t.ms===30000)t.fn();await pause()}};
}

test('visible Web imports delayed Android movement, nutrition and water without navigation; preserves drafts and avoids overlap',async()=>{
  const h=await liveSession();const {w}=h;
  try{
    const now=Date.now(),date=w.eval('localDayKey()');
    h.setRemote({movement:[{date,updatedAtMs:now,records:[{id:'delayed-move',activityType:'FUNCTIONAL',durationMinutes:7,timestampMs:now}]}],nutrition:[{date,updatedAtMs:now,meals:[{id:'delayed-meal',mealType:'BREAKFAST',proteinG:21,timestampMs:now}]}],water:[{date,consumedMl:700,updatedAtMs:now}]});
    w.document.getElementById('profileName').value='Texto ainda não salvo';
    w.document.getElementById('profileName').dispatchEvent(new w.Event('input',{bubbles:true}));
    let release;h.block(new Promise(resolve=>release=resolve));const before=h.reads();
    for(const t of h.timers.values())t.fn();w.dispatchEvent(new w.Event('focus'));w.dispatchEvent(new w.Event('online'));
    await pause();assert.equal(h.reads(),before+1);release();h.block(null);await pause();
    assert.match(w.document.getElementById('movementHistoryList').textContent,/Funcional/);
    assert.match(w.document.getElementById('nutritionHistoryList').textContent,/21/);
    assert.equal(w.document.getElementById('waterMl').textContent,'700 ml');
    assert.equal(w.document.getElementById('profileName').value,'Texto ainda não salvo');
    const count=h.reads();Object.defineProperty(w.document,'visibilityState',{configurable:true,value:'hidden'});await h.tick();assert.equal(h.reads(),count);
    Object.defineProperty(w.document,'visibilityState',{configurable:true,value:'visible'});
    Object.defineProperty(w.navigator,'onLine',{configurable:true,value:false});await h.tick();assert.equal(h.reads(),count);
    for(let i=0;i<3;i++){w.dispatchEvent(new w.Event('pagehide'));assert.equal(h.timers.size,0);w.dispatchEvent(new w.Event('pageshow'));assert.equal(h.timers.size,1)}
  }finally{h.dom.window.close()}
});

for(const mode of ['VIP_LIFETIME','PREMIUM','FREE'])test('installation follows '+mode+' account and requires signed-in session',async()=>{
  const h=await liveSession({mode});const {w}=h;
  try{
    let prompted=0;const event=new w.Event('beforeinstallprompt',{cancelable:true});
    event.prompt=async()=>{prompted++};event.userChoice=Promise.resolve({outcome:'accepted'});w.dispatchEvent(event);
    const button=w.document.getElementById('installButtonFloating');assert.equal(button.classList.contains('hidden'),false);assert.equal(event.defaultPrevented,true);
    if(mode==='FREE'){assert.match(button.textContent,/Google Play/);assert.equal(w.eval('canInstallFullPwa()'),false)}
    else{assert.match(button.textContent,/^Instalar Escudo Fit Web$/);button.click();await pause();assert.equal(prompted,1);assert.equal(w.document.getElementById('profilePlan').textContent,'WEB FULL • '+(mode==='PREMIUM'?'PREMIUM':'VIP VITALÍCIO'))}
    w.document.getElementById('logoutButton').click();await pause();assert.equal(w.localStorage.getItem('escudofit_web_auth_v1'),null);assert.equal(button.classList.contains('hidden'),true);
  }finally{w.close()}
});

for(const failure of ['offline','outage','expired','revoked'])test('PWA reopen session: '+failure,async()=>{
  const h=await liveSession({failure});
  try{
    const retained=failure!=='revoked';
    assert.equal(!!h.w.localStorage.getItem('escudofit_web_auth_v1'),retained);
    assert.equal(h.w.document.getElementById('appExperience').classList.contains('hidden'),!retained);
    if(failure==='expired'){assert.equal(h.refreshed(),1);assert.equal(JSON.parse(h.w.localStorage.getItem('escudofit_web_auth_v1')).access_token,'new-access')}
  }finally{h.w.close()}
});


test('opening a saved session never flashes marketing while validation is pending',async()=>{
  let release;const validationGate=new Promise(resolve=>release=resolve);
  const h=await liveSession({validationGate,onBoot:w=>{
    assert.equal(w.document.getElementById('marketingExperience').classList.contains('hidden'),true);
    assert.equal(w.document.getElementById('sessionLoading').classList.contains('hidden'),false);
    release();
  }});
  try{
    assert.equal(h.w.document.getElementById('sessionLoading').classList.contains('hidden'),true);
    assert.equal(h.w.document.getElementById('appExperience').classList.contains('hidden'),false);
  }finally{h.w.close()}
});

test('installation guidance persists and installed PWA explains its state',async()=>{
  const h=await liveSession();const {w}=h;
  try{
    const button=w.document.getElementById('installButtonFloating');
    button.click();await h.tick();
    assert.match(w.document.getElementById('installDescription').textContent,/Instalar e criar atalho/);
    w.matchMedia=()=>({matches:true});w.eval('renderInstallAction()');
    assert.equal(button.classList.contains('hidden'),true);
    assert.equal(w.document.getElementById('installDescription').classList.contains('hidden'),false);
    assert.match(w.document.getElementById('installDescription').textContent,/já está instalado/);
  }finally{w.close()}
});

for(const mode of ['VIP_LIFETIME','PREMIUM','FREE'])test('plan '+mode+' selects Application navigation and Android distribution without treatment',async()=>{
  const h=await liveSession({mode});const {w}=h;
  try{
    const full=mode!=='FREE';
    assert.equal(w.document.getElementById('navMedication').classList.contains('hidden'),!full);
    assert.equal(w.document.getElementById('medicationDashboardCard').classList.contains('hidden'),!full);
    assert.equal(w.document.getElementById('downloadAndroidFull').classList.contains('hidden'),!full);
    if(full){
      w.document.getElementById('navMedication').click();
      assert.equal(w.document.querySelector('[data-view="applications"]').classList.contains('active'),true);
      assert.equal(w.document.getElementById('downloadAndroidFull').href,'https://github.com/tonysacramento/escudo-fit-privacy/releases/download/v43-full-approved/escudo-fit-v43-full.apk');
      w.matchMedia=()=>({matches:true});w.eval('renderInstallAction()');
      assert.equal(w.document.getElementById('installButtonFloating').classList.contains('hidden'),true);
      assert.equal(w.document.getElementById('downloadAndroidFull').classList.contains('hidden'),false,'native download remains available inside installed PWA');
    }
    w.document.getElementById('logoutButton').click();await pause();
    assert.equal(w.document.getElementById('downloadAndroidFull').classList.contains('hidden'),true);
  }finally{w.close()}
});

test('PWA name and startup use approved unmodified V43 artwork',()=>{
  const manifest=JSON.parse(readFileSync('app/manifest.webmanifest','utf8'));
  assert.equal(manifest.name,'Escudo Fit Web');assert.equal(manifest.short_name,'Escudo Fit Web');
  assert.equal(manifest.id,'./');assert.equal(manifest.start_url,'./');
  assert.equal(manifest.icons[0].src,'./icon-approved-v43.png');
  assert.match(html,/splash-approved-v43\.png/);
  assert.match(html,/Instalar Escudo Fit Web/);
});
