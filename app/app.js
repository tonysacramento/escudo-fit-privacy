const API='https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38';
const GOOGLE_CLIENT_ID='835029473980-22hokuuman3rpbiefs54gg1ntnqu6lc7.apps.googleusercontent.com';
const AUTH_KEY='escudofit_web_auth_v1';
const DATA_PREFIX='escudofit_web_user_v2_';
const $=id=>document.getElementById(id);
const defaults={water:0,waterGoal:2000,steps:0,stepsGoal:8000,protein:0,proteinGoal:100,weights:[],measurements:{},profile:{name:''},updatedAt:null};
let auth=loadAuth();
let state={...defaults,weights:[],measurements:{},profile:{name:''}};
let installPrompt=null;
let googleReady=false;

function loadAuth(){try{return JSON.parse(localStorage.getItem(AUTH_KEY)||'null')}catch{return null}}
function saveAuth(value){auth=value;if(value)localStorage.setItem(AUTH_KEY,JSON.stringify(value));else localStorage.removeItem(AUTH_KEY)}
function dataKey(){return DATA_PREFIX+(auth?.user?.id||'guest')}
function loadState(){try{return {...defaults,...JSON.parse(localStorage.getItem(dataKey())||'{}')}}catch{return {...defaults,weights:[],measurements:{},profile:{name:''}}}}
function saveState(){state.updatedAt=new Date().toISOString();localStorage.setItem(dataKey(),JSON.stringify(state))}
function clamp(n,min,max){return Math.min(max,Math.max(min,n))}
function pct(v,g){return g>0?clamp(Math.round((v/g)*100),0,100):0}
function num(v){const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?n:0}
function fmtDate(iso){return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(iso))}
function toast(msg){const t=$('toast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('show'),2400)}
function escapeText(value){return String(value??'')}

function planLabel(mode){
  return ({FREE:'FREE',TRIAL_14D:'TRIAL',TRIAL_60D:'TRIAL 60D',VIP_TEMPORARY:'VIP',VIP_LIFETIME:'VIP VITALÍCIO',PREMIUM:'PREMIUM'})[mode]||'FULL';
}

function setLoginStatus(message,isError=false){
  const el=$('loginStatus');if(!el)return;el.textContent=message;el.classList.toggle('error',isError);
}

function showMarketing(){
  $('marketingExperience').classList.remove('hidden');
  $('appExperience').classList.add('hidden');
  document.body.classList.remove('is-app');
  setTimeout(initGoogle,50);
}

function showApp(){
  $('marketingExperience').classList.add('hidden');
  $('appExperience').classList.remove('hidden');
  document.body.classList.add('is-app');
  state=loadState();
  renderApp();
  activateView('home');
  window.scrollTo({top:0,behavior:'instant'});
}

function setShieldFill(id,value){
  const el=$(id);if(!el)return;
  el.style.setProperty('--fill',clamp(value,0,100)+'%');
}

function setText(id,value){
  const el=$(id);if(el)el.textContent=value;
}

function activateView(target){
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.target===target));
  document.querySelectorAll('.app-view').forEach(v=>v.classList.toggle('active',v.dataset.view===target));
  window.scrollTo({top:0,behavior:'smooth'});
}

function renderApp(){
  if(!auth?.user)return;
  const wp=pct(state.water,state.waterGoal);
  const sp=pct(state.steps,state.stepsGoal);
  const pp=pct(state.protein,state.proteinGoal);
  const score=Math.round((wp+sp+pp)/3);
  const protectedCount=[wp,sp,pp].filter(value=>value>=100).length;

  setText('waterPct',wp+'%');
  setText('waterDetailPct',wp+'%');
  setText('waterMl',state.water+' ml');
  setText('waterDetailMl',state.water+' ml');
  setText('waterGoalLabel',state.waterGoal+' ml');
  setText('waterDetailGoal',state.waterGoal+' ml');
  if($('waterBar'))$('waterBar').style.width=wp+'%';
  if($('waterDetailBar'))$('waterDetailBar').style.width=wp+'%';
  setShieldFill('waterShieldBadge',wp);
  setShieldFill('waterDetailBadge',wp);

  const waterRemaining=Math.max(0,state.waterGoal-state.water);
  setText('waterRemaining',wp>=100?'Meta de hoje concluída.':waterRemaining+' ml restantes para a meta de hoje.');
  setText('waterDetailRemaining',wp>=100?'Meta de hoje concluída.':waterRemaining+' ml restantes para a meta de hoje.');
  setText('waterStatusPill',wp>=100?'ESCUDO PROTEGIDO':'PENDENTE');
  setText('waterDetailStatus',wp>=100?'ESCUDO PROTEGIDO':'META SUGERIDA DO DIA');

  setText('stepsPct',sp+'%');
  if($('stepsBar'))$('stepsBar').style.width=sp+'%';
  if($('stepsInput'))$('stepsInput').value=state.steps||'';
  setShieldFill('movementShieldBadge',sp);
  setText('movementStatusPill',sp>=100?'ESCUDO PROTEGIDO':'PENDENTE');
  setText('movementHint',sp>=100?'Meta de passos de hoje alcançada.':'Meta atual: '+state.stepsGoal.toLocaleString('pt-BR')+' passos.');

  setText('proteinPct',pp+'%');
  if($('proteinBar'))$('proteinBar').style.width=pp+'%';
  if($('proteinInput'))$('proteinInput').value=state.protein||'';
  if($('proteinGoalInput'))$('proteinGoalInput').value=state.proteinGoal||100;
  setShieldFill('nutritionShieldBadge',pp);
  setText('nutritionStatusPill',pp>=100?'ESCUDO PROTEGIDO':'PENDENTE');
  setText('nutritionHint',pp>=100?'Meta de proteína de hoje alcançada.':'Faltam '+Math.max(0,state.proteinGoal-state.protein)+' g para a meta.');

  setText('dailyScore',score+'%');
  setShieldFill('dailyShieldBadge',score);
  if($('dailyBar'))$('dailyBar').style.width=score+'%';
  setText('protectedCount',String(protectedCount));
  setText('evaluableCount','3');
  setText('dailyStatus',
    protectedCount>=2
      ? 'Dia de Cuidado Ativo atingido!'
      : protectedCount===1
        ? 'Continue: falta ativar mais uma categoria.'
        : 'Comece com uma ação simples de cuidado.'
  );

  setText('lastWeight',state.weights.length?state.weights[0].value.toFixed(1).replace('.',',')+' kg':'—');
  if($('weightHistory'))$('weightHistory').innerHTML=state.weights.slice(0,5).map(w=>'<div class="history-row"><span>'+fmtDate(w.at)+'</span><strong>'+w.value.toFixed(1).replace('.',',')+' kg</strong></div>').join('')||'<small class="muted">Nenhum peso registrado ainda.</small>';
  const m=state.measurements||{};
  [['mWaist','waist'],['mAbdomen','abdomen'],['mHip','hip'],['mArm','arm'],['mThigh','thigh'],['mChest','chest']].forEach(([id,k])=>{if($(id))$(id).value=m[k]??''});
  if($('profileName'))$('profileName').value=state.profile?.name||'';

  const displayName=state.profile?.name||auth.user.name||auth.user.email.split('@')[0];
  setText('welcomeName',displayName);
  setText('appGreeting','Olá, '+displayName.split(' ')[0]);
  setText('profileUserName',auth.user.name||displayName);
  setText('profileEmail',auth.user.email);
  if($('profilePicture'))$('profilePicture').src=auth.user.picture||'./icon.svg';
  if($('topProfilePicture'))$('topProfilePicture').src=auth.user.picture||'./icon.svg';

  const p=planLabel(auth.entitlement?.mode);
  setText('planBadge',p);
  setText('profilePlan',p);
}

async function apiFetch(path,options={}){
  const headers={...(options.headers||{})};
  if(auth?.access_token)headers.Authorization='Bearer '+auth.access_token;
  return fetch(API+path,{...options,headers});
}

async function refreshSession(){
  if(!auth?.refresh_token)return false;
  try{
    const res=await fetch(API+'/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:auth.refresh_token})});
    if(!res.ok)return false;
    const data=await res.json();
    auth={...auth,access_token:data.access_token,refresh_token:data.refresh_token};
    saveAuth(auth);
    return true;
  }catch{return false}
}

async function validateStoredSession(){
  if(!auth?.user||!auth?.refresh_token)return false;
  try{
    let res=await apiFetch('/me');
    if(res.status===401&&await refreshSession())res=await apiFetch('/me');
    if(!res.ok)return false;
    const me=await res.json();
    if(!me?.user?.id||!me?.user?.email)return false;
    const entRes=await apiFetch('/entitlement/me');
    if(!entRes.ok)return false;
    const entitlement=await entRes.json();
    if(!entitlement?.mode)return false;
    auth={...auth,user:me.user,entitlement};
    saveAuth(auth);
    return true;
  }catch{
    return false;
  }
}

async function handleGoogleCredential(response){
  const credential=response?.credential;
  if(!credential)return setLoginStatus('Não foi possível obter a credencial Google.',true);
  setLoginStatus('Validando sua conta e seu acesso…');
  try{
    const res=await fetch(API+'/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id_token:credential})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.code||('HTTP_'+res.status));
    saveAuth(data);
    state=loadState();
    setLoginStatus('Acesso confirmado.');
    showApp();
    toast('Bem-vindo ao Escudo Fit');
  }catch(error){
    const code=String(error?.message||'LOGIN_FAILED');
    const cors=/Failed to fetch|NetworkError|Load failed/i.test(code);
    setLoginStatus(cors?'O login web ainda está sendo ativado no servidor. Tente novamente em instantes.':'Não foi possível concluir o login ('+code+').',true);
  }
}

function initGoogle(){
  if(auth||googleReady)return;
  if(!window.google?.accounts?.id){
    setLoginStatus('Carregando login seguro…');
    setTimeout(initGoogle,500);
    return;
  }
  try{
    try{window.google.accounts.id.disableAutoSelect()}catch{}
    window.google.accounts.id.initialize({
      client_id:GOOGLE_CLIENT_ID,
      callback:handleGoogleCredential,
      auto_select:false,
      button_auto_select:false,
      use_fedcm_for_button:true,
      cancel_on_tap_outside:true
    });
    const slot=$('googleLoginSlot');
    slot.innerHTML='';
    window.google.accounts.id.renderButton(slot,{theme:'outline',size:'large',shape:'pill',text:'continue_with',width:320,logo_alignment:'left'});
    googleReady=true;
    setLoginStatus('Use sua Conta Google cadastrada no Escudo Fit.');
    $('retryGoogleButton').classList.add('hidden');
  }catch{
    setLoginStatus('Não foi possível carregar o login Google.',true);
    $('retryGoogleButton').classList.remove('hidden');
  }
}

async function resetGoogleSession(message){
  try{if(auth?.access_token)await apiFetch('/auth/logout',{method:'POST'})}catch{}
  saveAuth(null);auth=null;state={...defaults,weights:[],measurements:{},profile:{name:''}};
  googleReady=false;
  try{window.google?.accounts?.id?.disableAutoSelect()}catch{}
  showMarketing();
  setLoginStatus(message);
  setTimeout(()=>document.getElementById('loginSection')?.scrollIntoView({behavior:'smooth'}),100);
}

async function logout(){
  await resetGoogleSession('Sessão encerrada. Use sua Conta Google cadastrada para entrar novamente.');
  toast('Você saiu do Escudo Fit');
}

async function switchGoogleAccount(){
  await resetGoogleSession('Escolha a Conta Google que deseja usar no Escudo Fit.');
  toast('Escolha outra Conta Google');
}

document.querySelectorAll('[data-scroll-login]').forEach(el=>el.addEventListener('click',()=>document.getElementById('loginSection').scrollIntoView({behavior:'smooth'})));
$('retryGoogleButton').addEventListener('click',()=>{googleReady=false;initGoogle()});

document.querySelectorAll('[data-water]').forEach(b=>b.addEventListener('click',()=>{state.water=clamp(state.water+Number(b.dataset.water),0,10000);saveState();renderApp();toast('Hidratação atualizada')}));
$('waterReset').addEventListener('click',()=>{state.water=0;saveState();renderApp();toast('Hidratação reiniciada')});
$('stepsInput').addEventListener('change',e=>{state.steps=clamp(num(e.target.value),0,100000);saveState();renderApp();toast('Movimento salvo')});
$('proteinInput').addEventListener('change',e=>{state.protein=clamp(num(e.target.value),0,1000);saveState();renderApp()});
$('proteinGoalInput').addEventListener('change',e=>{state.proteinGoal=clamp(num(e.target.value)||100,1,1000);saveState();renderApp()});
$('addWeight').addEventListener('click',()=>{const v=num($('weightInput').value);if(v<20||v>400)return toast('Informe um peso válido');state.weights=[{value:v,at:new Date().toISOString()},...state.weights].slice(0,50);$('weightInput').value='';saveState();renderApp();toast('Peso registrado')});
$('saveMeasurements').addEventListener('click',()=>{state.measurements={waist:num($('mWaist').value)||null,abdomen:num($('mAbdomen').value)||null,hip:num($('mHip').value)||null,arm:num($('mArm').value)||null,thigh:num($('mThigh').value)||null,chest:num($('mChest').value)||null,savedAt:new Date().toISOString()};saveState();$('measureSaved').textContent='Medidas salvas neste aparelho em '+new Date().toLocaleString('pt-BR')+'.';toast('Medidas salvas')});
$('saveProfile').addEventListener('click',()=>{state.profile={name:$('profileName').value.trim()};saveState();renderApp();toast('Nome atualizado')});

document.querySelectorAll('[data-view-link]').forEach(btn=>btn.addEventListener('click',()=>activateView(btn.dataset.viewLink)));

document.querySelectorAll('[data-focus-target]').forEach(btn=>btn.addEventListener('click',()=>{
  activateView('home');
  setTimeout(()=>{
    const target=$(btn.dataset.focusTarget);
    if(target){target.scrollIntoView({behavior:'smooth',block:'center'});target.focus();}
  },120);
}));

document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>activateView(btn.dataset.target)));

$('exportData').addEventListener('click',()=>{const safe={...state,exportedAt:new Date().toISOString(),account:auth?.user?.email||null};const blob=new Blob([JSON.stringify(safe,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='escudo-fit-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);toast('Backup exportado')});
$('clearData').addEventListener('click',()=>{if(!confirm('Apagar todos os registros locais desta versão web?'))return;localStorage.removeItem(dataKey());state={...defaults,weights:[],measurements:{},profile:{name:''}};renderApp();toast('Dados locais apagados')});
$('logoutButton').addEventListener('click',logout);
$('logoutButtonBottom').addEventListener('click',logout);
$('switchAccountButton')?.addEventListener('click',switchGoogleAccount);

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('installButtonFloating').classList.remove('hidden')});
$('installButtonFloating').addEventListener('click',async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('installButtonFloating').classList.add('hidden')});
window.addEventListener('appinstalled',()=>toast('Escudo Fit instalado'));

if('serviceWorker'in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}))}

(async function boot(){
  if(auth&&await validateStoredSession())showApp();
  else{if(auth)saveAuth(null);auth=null;showMarketing()}
})();
