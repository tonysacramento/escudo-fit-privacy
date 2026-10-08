const API='https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38';
const historyContract=window.EscudoHistoryContract;
if(!historyContract)throw new Error('HISTORY_CONTRACT_NOT_LOADED');
const GOOGLE_CLIENT_ID='835029473980-22hokuuman3rpbiefs54gg1ntnqu6lc7.apps.googleusercontent.com';
const AUTH_KEY='escudofit_web_auth_v1';
const DATA_PREFIX='escudofit_web_user_v2_';
const $=id=>document.getElementById(id);
const defaults={water:0,waterUpdatedAtMs:0,waterGoal:2000,steps:0,stepsGoal:8000,protein:0,proteinGoal:100,nutritionUpdatedAtMs:0,activities:[],applications:[],weights:[],measurements:{},measurementHistory:[],nutritionHistory:[],treatment:null,profile:{name:''},updatedAt:null};
let auth=loadAuth();
let state={...defaults,activities:[],applications:[],weights:[],measurements:{},measurementHistory:[],nutritionHistory:[],treatment:null,profile:{name:''}};
let installPrompt=null;
let googleReady=false;
const PROMO_CODE=new URLSearchParams(window.location.search).get('promo')||'';
const ACTIVE_PROMO=/^monise30$/i.test(PROMO_CODE)
  ? {code:'Monise30',trialDays:30,requiresManualApproval:true}
  : null;

function loadAuth(){try{return JSON.parse(localStorage.getItem(AUTH_KEY)||'null')}catch{return null}}
function saveAuth(value){auth=value;if(value)localStorage.setItem(AUTH_KEY,JSON.stringify(value));else localStorage.removeItem(AUTH_KEY)}
function dataKey(){return DATA_PREFIX+(auth?.user?.id||'guest')}
function loadState(){try{return {...defaults,...JSON.parse(localStorage.getItem(dataKey())||'{}')}}catch{return {...defaults,activities:[],applications:[],weights:[],measurements:{},measurementHistory:[],nutritionHistory:[],treatment:null,profile:{name:''}}}}
function saveState(){state.updatedAt=new Date().toISOString();localStorage.setItem(dataKey(),JSON.stringify(state))}
function clamp(n,min,max){return Math.min(max,Math.max(min,n))}
function pct(v,g){return g>0?clamp(Math.round((v/g)*100),0,100):0}
function num(v){const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?n:0}
function waterGoalFromWeight(weightKg){const n=Number(weightKg);return Number.isFinite(n)&&n>0?Math.round((n*35)/50)*50:2000}
function fmtDate(iso){return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(iso))}
function localDayKey(value=new Date()){const d=value instanceof Date?value:new Date(value);const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');const day=String(d.getDate()).padStart(2,'0');return y+'-'+m+'-'+day}
const activityLabels={WALKING:'Caminhada',STRENGTH:'Musculação',RUNNING:'Corrida',FUNCTIONAL:'Funcional',CYCLING:'Bicicleta',OTHER:'Outro'};
const mealLabels={BREAKFAST:'Café da manhã',LUNCH:'Almoço',DINNER:'Jantar',SNACK:'Lanche'};
const medicationLabels={OZEMPIC:'Ozempic',WEGOVY:'Wegovy',MOUNJARO:'Mounjaro',SAXENDA:'Saxenda',OTHER:'Outro',NONE:'Nenhum'};
const applicationSiteLabels={
  ABDOMEN:'Abdômen',ABDOMEN_LEFT:'Abdômen esquerdo',ABDOMEN_RIGHT:'Abdômen direito',
  THIGH_LEFT:'Coxa esquerda',THIGH_RIGHT:'Coxa direita',ARM_LEFT:'Braço esquerdo',
  ARM_RIGHT:'Braço direito',OTHER:'Outro',UNSPECIFIED:'Local não informado'
};
function toast(msg){const t=$('toast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('show'),2400)}
function escapeText(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}

function planLabel(mode){
  return ({FREE:'FREE',TRIAL_14D:'TRIAL',TRIAL_60D:'TRIAL 60D',VIP_TEMPORARY:'VIP',VIP_LIFETIME:'VIP VITALÍCIO',PREMIUM:'PREMIUM'})[mode]||'FULL';
}

function experienceForEntitlement(_mode){
  // The Web surface is the Escudo Fit FULL experience. Android distribution
  // (for example, a physically installed Wellness build) must not downgrade
  // what is rendered in the browser for the same Google account.
  return 'FULL';
}

function applyExperience(){
  const mode=auth?.entitlement?.mode||'FREE';
  const experience=experienceForEntitlement(mode);
  document.body.dataset.experience='full';
  document.querySelectorAll('[data-full-only]').forEach(el=>{
    el.classList.remove('entitlement-hidden');
  });
  setText('experienceLabel','FULL');
  // Keep the real entitlement visible without using it to choose the Web edition.
  setText('planBadge',planLabel(mode));
  setText('profilePlan','WEB FULL • '+planLabel(mode));
  return experience;
}

function setLoginStatus(message,isError=false){
  const el=$('loginStatus');if(!el)return;
  el.textContent=message||'';
  el.classList.toggle('error',isError);
  el.classList.toggle('hidden',!message);
}

function setTrialStatus(message,isError=false){
  const el=$('trialStatus');if(!el)return;
  el.textContent=message||'';
  el.classList.toggle('error',isError);
  el.classList.toggle('hidden',!message);
}

function applyPromoLanding(){
  if(!ACTIVE_PROMO)return;
  setText('trialEyebrow','BENEFÍCIO EXCLUSIVO');
  setText('trialTitle','30 dias grátis de Escudo Fit');
  setText('trialIntro','Cadastre-se com nome e e-mail. Sua solicitação será analisada e o acesso será liberado em até 24 horas.');
  const button=$('trialSubmit');
  if(button)button.textContent='Solicitar 30 dias grátis';
}
applyPromoLanding();

async function registerQuickTrial(event){
  event?.preventDefault?.();
  const name=$('trialName')?.value.trim()||'';
  const email=$('trialEmail')?.value.trim().toLowerCase()||'';
  const company=$('trialCompany')?.value||'';
  const consentAccepted=$('trialLgpd')?.checked===true;
  const consentVersion='LGPD-2026-10-07-v1';
  if(name.length<2){
    $('trialName')?.focus();
    return setTrialStatus('Informe seu nome.',true);
  }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    $('trialEmail')?.focus();
    return setTrialStatus('Informe um e-mail válido.',true);
  }
  if(!consentAccepted){
    $('trialLgpd')?.focus();
    return setTrialStatus('Para criar seu acesso, leia e aceite a Política de Privacidade e os Termos de Uso.',true);
  }

  const button=$('trialSubmit');
  if(button){button.disabled=true;button.textContent='Reservando seu acesso…'}
  setTrialStatus('');
  try{
    const res=await fetch(API+'/trial/register',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        name,email,company,consentAccepted,consentVersion,
        ...(ACTIVE_PROMO?{promoCode:ACTIVE_PROMO.code}:{})
      })
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.code||('HTTP_'+res.status));
    sessionStorage.setItem('escudofit_trial_email',email);
    const accessChannel=data.accessChannel||(/@(gmail|googlemail)\.com$/i.test(email)?'GOOGLE_PLAY':'WEB_ONLY');
    const promoPending=data.pendingApproval===true||ACTIVE_PROMO?.requiresManualApproval===true;
    if(promoPending){
      setTrialStatus('Solicitação recebida. Seu benefício de 30 dias grátis está em análise e será liberado em até 24 horas. Você receberá a confirmação após a aprovação.');
      $('trialLoginButton')?.classList.add('hidden');
      $('trialAndroidButton')?.classList.add('hidden');
    }else if(accessChannel==='GOOGLE_PLAY'){
      setTrialStatus('Cadastro concluído. Entre com esta mesma Conta Google para ativar seus 14 dias grátis e acessar o Android.');
      $('trialLoginButton')?.classList.remove('hidden');
      $('trialAndroidButton')?.classList.remove('hidden');
    }else{
      setTrialStatus('Cadastro concluído. Este e-mail foi registrado para acesso pela Web. A validação do e-mail será feita no fluxo Web; não é necessário usar a Play Store.');
      $('trialLoginButton')?.classList.add('hidden');
      $('trialAndroidButton')?.classList.add('hidden');
    }
    if(button)button.classList.add('hidden');
  }catch(error){
    const code=String(error?.message||'TRIAL_REGISTER_FAILED');
    setTrialStatus(
      /Failed to fetch|NetworkError|Load failed/i.test(code)
        ? 'Não foi possível concluir o cadastro agora. Tente novamente em instantes.'
        : 'Não foi possível concluir o cadastro. Revise os dados e tente novamente.',
      true
    );
    if(button){button.disabled=false;button.textContent=ACTIVE_PROMO?'Solicitar 30 dias grátis':'Começar 14 dias grátis'}
  }
}


function showMarketing(){
  $('marketingExperience').classList.remove('hidden');
  $('appExperience').classList.add('hidden');
  document.body.classList.remove('is-app');
  delete document.body.dataset.experience;
  setTimeout(initGoogle,50);
}

function showApp(){
  $('marketingExperience').classList.add('hidden');
  $('appExperience').classList.remove('hidden');
  document.body.classList.add('is-app');
  state=loadState();
  renderApp();
  activateView('home');
  // One authoritative hydration path prevents a slower duplicate request from
  // overwriting local records that have not synchronized yet.
  void hydrateAccountHistory();
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
  const experience=experienceForEntitlement(auth?.entitlement?.mode||'FREE');
  const requested=document.querySelector('.app-view[data-view="'+target+'"]');
  if(experience==='WELLNESS'&&requested?.hasAttribute('data-full-only'))target='home';
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.target===target));
  document.querySelectorAll('.app-view').forEach(v=>v.classList.toggle('active',v.dataset.view===target));
  window.scrollTo({top:0,behavior:'smooth'});
}

function renderApp(){
  if(!auth?.user)return;
  const experience=applyExperience();
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

  if($('activityStepsInput'))$('activityStepsInput').value=state.steps||'';
  if($('activityStepsBar'))$('activityStepsBar').style.width=sp+'%';
  setText('activityStepsHint',sp>=100?'Meta de passos de hoje alcançada.':'Meta atual: '+state.stepsGoal.toLocaleString('pt-BR')+' passos.');

  const today=localDayKey();
  const todayActivities=(Array.isArray(state.activities)?state.activities:[]).filter(item=>localDayKey(item.at)===today);
  const activityProtected=todayActivities.length>0;
  setText('activityPct',activityProtected?'100%':'0%');
  setShieldFill('activityShieldBadge',activityProtected?100:0);
  setText('activityStatus',activityProtected?'ESCUDO PROTEGIDO':'ESCUDO PENDENTE');
  setText('activityCount',String(todayActivities.length));
  setText('activityHint',activityProtected?'Ótimo trabalho! Seu movimento de hoje está registrado.':'Registre uma atividade para proteger este escudo.');
  if($('activityHistory'))$('activityHistory').innerHTML=todayActivities
    .sort((a,b)=>new Date(b.at)-new Date(a.at))
    .map(item=>'<div class="history-row"><span>'+escapeText(activityLabels[item.type]||item.type)+(item.duration?' • '+Number(item.duration)+' min':'')+'</span><strong>'+fmtDate(item.at)+'</strong></div>')
    .join('')||'<small class="muted">Nenhuma atividade registrada hoje.</small>';
  if($('activityHistoryPrevious'))$('activityHistoryPrevious').innerHTML=(Array.isArray(state.activities)?state.activities:[])
    .filter(item=>localDayKey(item.at)!==today)
    .slice().sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,20)
    .map(item=>'<div class="history-row"><span>'+escapeText(activityLabels[item.type]||item.type)+(item.duration?' • '+Number(item.duration)+' min':'')+'</span><strong>'+fmtDate(item.at)+'</strong></div>')
    .join('')||'<small class="muted">Nenhuma atividade anterior sincronizada.</small>';

  if($('applicationHistory'))$('applicationHistory').innerHTML=(Array.isArray(state.applications)?state.applications:[])
    .slice().sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,8)
    .map(item=>'<div class="history-row"><span>'+escapeText(item.site)+'</span><strong>'+fmtDate(item.at)+'</strong></div>')
    .join('')||'<small class="muted">Nenhuma aplicação registrada na Web ainda.</small>';

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
  [['mWaist','waist'],['mAbdomen','abdomen'],['mHip','hips'],['mArm','arm'],['mThigh','thigh'],['mChest','chest']].forEach(([id,k])=>{if($(id))$(id).value=m[k]??''});
  if($('measurementHistoryList')){
    const fields=[['waist','Cintura'],['abdomen','Abdômen'],['hips','Quadril'],['arm','Braço'],['thigh','Coxa'],['chest','Peitoral']];
    $('measurementHistoryList').innerHTML=(state.measurementHistory||[]).slice(0,6).map(entry=>{
      const values=fields.filter(([key])=>entry[key]!=null).map(([key,label])=>label+': '+Number(entry[key]).toLocaleString('pt-BR')+' cm').join(' • ');
      const date=new Date(entry.date+'T12:00:00').toLocaleDateString('pt-BR');
      return '<div class="history-row measurement-history-row"><span>'+date+'</span><strong>'+values+'</strong></div>';
    }).join('')||'<small class="muted">Nenhuma medida sincronizada ainda.</small>';
  }
  if($('movementHistoryList'))$('movementHistoryList').innerHTML=(Array.isArray(state.activities)?state.activities:[])
    .slice().sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,12)
    .map(item=>'<div class="history-row"><span>'+escapeText(activityLabels[item.type]||item.type)+(item.duration?' • '+Number(item.duration)+' min':'')+'</span><strong>'+fmtDate(item.at)+'</strong></div>')
    .join('')||'<small class="muted">Nenhum movimento sincronizado ainda.</small>';

  if($('nutritionHistoryList')){
    const nutritionRows=(Array.isArray(state.nutritionHistory)?state.nutritionHistory:[])
      .flatMap(day=>(Array.isArray(day.meals)?day.meals:[]).map(meal=>({...meal,date:day.date})))
      .sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,12);
    $('nutritionHistoryList').innerHTML=nutritionRows
      .map(meal=>'<div class="history-row"><span>'+escapeText(mealLabels[meal.mealType]||meal.mealType)+' • '+Number(meal.proteinG).toLocaleString('pt-BR')+' g'+(meal.description?' • '+escapeText(meal.description):'')+'</span><strong>'+fmtDate(meal.at)+'</strong></div>')
      .join('')||'<small class="muted">Nenhuma refeição sincronizada ainda.</small>';
  }

  if($('treatmentHistoryList')){
    const treatment=state.treatment;
    if(!treatment){
      $('treatmentHistoryList').innerHTML='<small class="muted">Nenhum histórico de tratamento sincronizado ainda.</small>';
    }else{
      const rows=[];
      if(treatment.medication&&treatment.medication!=='NONE'){
        const started=treatment.treatmentStartDateIso
          ?new Date(treatment.treatmentStartDateIso+'T12:00:00').toLocaleDateString('pt-BR')
          :'data não informada';
        rows.push('<div class="history-row"><span>Atual: '+escapeText(medicationLabels[treatment.medication]||treatment.medication)+(treatment.medicationDoseLabel?' • '+escapeText(treatment.medicationDoseLabel):'')+'</span><strong>desde '+started+'</strong></div>');
      }
      for(const item of (Array.isArray(treatment.history)?treatment.history:[]).slice().sort((a,b)=>Number(b.changedAtMs||0)-Number(a.changedAtMs||0)).slice(0,12)){
        const start=item.startDateIso?new Date(item.startDateIso+'T12:00:00').toLocaleDateString('pt-BR'):'—';
        const end=item.endDateIso?new Date(item.endDateIso+'T12:00:00').toLocaleDateString('pt-BR'):'—';
        rows.push('<div class="history-row"><span>'+escapeText(medicationLabels[item.medication]||item.medication)+(item.doseLabel?' • '+escapeText(item.doseLabel):'')+'</span><strong>'+start+' → '+end+'</strong></div>');
      }
      $('treatmentHistoryList').innerHTML=rows.join('')||'<small class="muted">Nenhum período anterior sincronizado.</small>';
    }
  }

  if($('profileName'))$('profileName').value=state.profile?.name||'';
  if($('treatmentMedication'))$('treatmentMedication').value=state.treatment?.medication||'NONE';
  if($('treatmentDose'))$('treatmentDose').value=state.treatment?.medicationDoseLabel||'';
  if($('treatmentStart'))$('treatmentStart').value=state.treatment?.treatmentStartDateIso||'';

  const displayName=state.profile?.name||auth.user.name||auth.user.email.split('@')[0];
  setText('welcomeName',displayName);
  setText('appGreeting','Olá, '+displayName.split(' ')[0]);
  setText('profileUserName',auth.user.name||displayName);
  setText('profileEmail',auth.user.email);
  if($('profilePicture'))$('profilePicture').src=auth.user.picture||'./icon.svg';
  if($('topProfilePicture'))$('topProfilePicture').src=auth.user.picture||'./icon.svg';

  const p=planLabel(auth.entitlement?.mode);
  if(experience==='FULL'){
    setText('planBadge',p);
    setText('profilePlan','WEB FULL • '+p);
  }

}

async function apiFetch(path,options={}){
  const headers={...(options.headers||{})};
  if(auth?.access_token)headers.Authorization='Bearer '+auth.access_token;
  return fetch(API+path,{...options,headers});
}

function localWeightKey(weight){
  return weight.id||[weight.value,weight.at].join('|');
}

function remoteWeightToLocal(weight){
  const timestampMs=Number(weight?.timestampMs);
  const weightKg=Number(weight?.weightKg);
  if(!weight?.id||!Number.isFinite(timestampMs)||!Number.isFinite(weightKg))return null;
  return {id:String(weight.id),value:weightKg,at:new Date(timestampMs).toISOString()};
}

function remoteMeasurementToLocal(item){return historyContract.asMeasurement(item)}

function remoteApplicationToLocal(item){
  const appliedAtMs=Number(item?.appliedAtMs);
  const rawSite=String(item?.applicationSite||item?.site||'UNSPECIFIED').trim()||'UNSPECIFIED';
  if(!item?.id||!Number.isFinite(appliedAtMs))return null;
  return {
    id:String(item.id),
    site:applicationSiteLabels[rawSite]||rawSite,
    siteCode:rawSite,
    at:new Date(appliedAtMs).toISOString(),
    ...(item?.scheduledDateIso?{scheduledDateIso:String(item.scheduledDateIso)}:{})
  };
}

function remoteMovementToLocal(days){
  if(!Array.isArray(days))return[];
  return days.flatMap(day=>{
    const date=String(day?.date||'');
    const records=Array.isArray(day?.records)?day.records:[];
    return records.flatMap(record=>{
      const timestampMs=Number(record?.timestampMs);
      const type=String(record?.activityType||'');
      if(!record?.id||!type||!Number.isFinite(timestampMs))return[];
      return [{
        id:String(record.id),
        type,
        duration:record?.durationMinutes==null?null:Number(record.durationMinutes),
        at:new Date(timestampMs).toISOString(),
        date
      }];
    });
  });
}

function remoteNutritionToLocal(days){
  if(!Array.isArray(days))return[];
  return days.flatMap(day=>{
    const date=String(day?.date||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return[];
    const meals=Array.isArray(day?.meals)?day.meals:[];
    return [{
      date,
      updatedAtMs:Number(day?.updatedAtMs||0),
      meals:meals.flatMap(meal=>{
        const timestampMs=Number(meal?.timestampMs);
        const proteinG=Number(meal?.proteinG);
        if(!meal?.id||!Number.isFinite(timestampMs)||!Number.isFinite(proteinG))return[];
        return [{
          id:String(meal.id),
          mealType:String(meal.mealType||'SNACK'),
          proteinG,
          at:new Date(timestampMs).toISOString(),
          description:typeof meal?.description==='string'?meal.description:''
        }];
      })
    }];
  });
}

function normalizeRemoteTreatment(raw){
  if(!raw||typeof raw!=='object')return null;
  const updatedAtMs=Number(raw.updatedAtMs||0);
  if(!Number.isFinite(updatedAtMs)||updatedAtMs<=0)return null;
  return {
    medication:String(raw.medication||'NONE'),
    medicationDoseLabel:String(raw.medicationDoseLabel||''),
    treatmentStartDateIso:String(raw.treatmentStartDateIso||''),
    updatedAtMs,
    history:Array.isArray(raw.history)?raw.history:[]
  };
}

async function authenticatedFetch(path,options={}){
  let res=await apiFetch(path,options);
  if(res.status===401&&await refreshSession())res=await apiFetch(path,options);
  return res;
}

// Account-scoped outbox: Web edits survive offline periods and are retried
// in their original order before remote hydration. Never flush another user.
const HISTORY_OUTBOX_PREFIX='escudofit_history_outbox_v1_';
let historyPatchChain=Promise.resolve();
function historyOutboxKey(){return HISTORY_OUTBOX_PREFIX+String(auth?.user?.id||'guest')}
function loadHistoryOutbox(){
  try{const result=JSON.parse(localStorage.getItem(historyOutboxKey())||'[]');return Array.isArray(result)?result:[]}
  catch{return[]}
}
function storeHistoryOutbox(entries){localStorage.setItem(historyOutboxKey(),JSON.stringify(entries))}
async function flushPendingHistory(){
  if(!auth?.access_token||!auth?.user)return false;
  const entries=loadHistoryOutbox();
  for(const entry of entries){
    try{
      const res=await authenticatedFetch('/history/sync',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(entry.payload)
      });
      if(!res.ok)return false;
      const remaining=loadHistoryOutbox().filter(item=>item.id!==entry.id);
      storeHistoryOutbox(remaining);
    }catch{return false}
  }
  return true;
}
async function syncHistoryPatch(payload){
  if(!auth?.user)return false;
  const pending=historyPatchChain.then(async()=>{
    const entries=loadHistoryOutbox();
    if(entries.length>=200){
      setText('historySyncStatus','Fila de histórico cheia. Não apague os dados locais; conecte-se para sincronizar.');
      return false;
    }
    entries.push({
      id:(crypto.randomUUID?crypto.randomUUID():'history-'+Date.now()+'-'+entries.length),
      payload,
      createdAtMs:Date.now()
    });
    storeHistoryOutbox(entries);
    return flushPendingHistory();
  }).catch(()=>false);
  historyPatchChain=pending.then(()=>undefined);
  return pending;
}

async function hydrateAccountHistory(){
  if(!auth?.user)return false;
  try{
    await historyPatchChain;
    await flushPendingHistory();
    const res=await authenticatedFetch('/history');
    if(!res.ok)return;
    const data=await res.json();
    const counts=historyContract.countHistory(data);

    const remoteWeights=(Array.isArray(data?.weights)?data.weights:[])
      .map(remoteWeightToLocal).filter(Boolean);
    const mergedWeights=[];
    const seenWeights=new Set();
    for(const weight of [...remoteWeights,...(Array.isArray(state.weights)?state.weights:[])]){
      const key=localWeightKey(weight);
      if(!key||seenWeights.has(key))continue;
      seenWeights.add(key);
      mergedWeights.push(weight);
    }
    mergedWeights.sort((a,b)=>new Date(b.at).getTime()-new Date(a.at).getTime());
    state.weights=mergedWeights.slice(0,200);
    if(state.weights.length)state.waterGoal=waterGoalFromWeight(state.weights[0].value);

    const remoteMeasurements=(Array.isArray(data?.measurements)?data.measurements:[])
      .map(remoteMeasurementToLocal).filter(Boolean);
    const localMeasurements=Array.isArray(state.measurementHistory)?state.measurementHistory:[];
    const mergedMeasurements=[];
    const seenMeasurementDates=new Set();
    // Local wins for the same date so an offline edit is never discarded by
    // login hydration before it has a chance to synchronize.
    for(const entry of [...localMeasurements,...remoteMeasurements]){
      const date=String(entry?.date||'');
      if(!date||seenMeasurementDates.has(date))continue;
      seenMeasurementDates.add(date);
      mergedMeasurements.push(entry);
    }
    mergedMeasurements.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    state.measurementHistory=mergedMeasurements.slice(0,200);
    if(state.measurementHistory.length){
      const latest=state.measurementHistory[0];
      state.measurements={
        waist:latest.waist,abdomen:latest.abdomen,hips:latest.hips,chest:latest.chest,
        arm:latest.arm,thigh:latest.thigh,savedAt:latest.date,
      };
    }

    const remoteApplications=(Array.isArray(data?.applications)?data.applications:[])
      .map(remoteApplicationToLocal).filter(Boolean);
    const mergedApplications=[];
    const seenApplicationIds=new Set();
    // Local first: preserve an offline/local correction for the same record id.
    for(const entry of [...(Array.isArray(state.applications)?state.applications:[]),...remoteApplications]){
      const id=String(entry?.id||'');
      if(!id||seenApplicationIds.has(id))continue;
      seenApplicationIds.add(id);
      mergedApplications.push(entry);
    }
    mergedApplications.sort((a,b)=>new Date(b.at).getTime()-new Date(a.at).getTime());
    state.applications=mergedApplications.slice(0,200);

    const remoteActivities=remoteMovementToLocal(data?.movement);
    const mergedActivities=[];
    const seenActivityIds=new Set();
    for(const entry of [...(Array.isArray(state.activities)?state.activities:[]),...remoteActivities]){
      const id=String(entry?.id||'');
      if(!id||seenActivityIds.has(id))continue;
      seenActivityIds.add(id);
      mergedActivities.push(entry);
    }
    mergedActivities.sort((a,b)=>new Date(b.at).getTime()-new Date(a.at).getTime());
    state.activities=mergedActivities.slice(0,500);

    const remoteNutrition=remoteNutritionToLocal(data?.nutrition);
    state.nutritionHistory=historyContract.mergeNutritionDays(state.nutritionHistory,remoteNutrition);

    const today=localDayKey();
    const todayNutrition=state.nutritionHistory.find(day=>day.date===today);
    const todayNutritionUpdatedAtMs=Number(todayNutrition?.updatedAtMs||0);
    if(todayNutrition&&todayNutritionUpdatedAtMs>=Number(state.nutritionUpdatedAtMs||0)){
      state.protein=(todayNutrition.meals||[]).reduce((sum,meal)=>sum+Number(meal.proteinG||0),0);
      state.nutritionUpdatedAtMs=todayNutritionUpdatedAtMs;
    }

    const remoteTreatment=normalizeRemoteTreatment(data?.treatment);
    if(remoteTreatment&&remoteTreatment.updatedAtMs>=Number(state.treatment?.updatedAtMs||0)){
      state.treatment=remoteTreatment;
    }

    const remoteWater=(Array.isArray(data?.water)?data.water:[])
      .find(entry=>entry?.date===today);
    const localWaterUpdatedAtMs=Number(state.waterUpdatedAtMs||0);
    const remoteWaterUpdatedAtMs=Number(remoteWater?.updatedAtMs||0);
    if(remoteWater&&remoteWaterUpdatedAtMs>=localWaterUpdatedAtMs){
      state.water=clamp(Number(remoteWater.consumedMl)||0,0,10000);
      state.waterUpdatedAtMs=remoteWaterUpdatedAtMs;
    }else if(localWaterUpdatedAtMs>remoteWaterUpdatedAtMs){
      void syncHistoryPatch({
        water:[{date:today,consumedMl:state.water,updatedAtMs:localWaterUpdatedAtMs}],
      });
    }

    saveState();
    renderApp();
    setText('historySyncStatus',
      'Conta consultada: '+counts.weights+' pesos, '+counts.measurements+' medidas, '+
      counts.applications+' aplicações, '+counts.movement+' movimentos, '+
      counts.nutrition+' refeições, '+counts.treatment+' tratamento(s), '+
      counts.water+' dias de hidratação. Pendências locais: '+loadHistoryOutbox().length+'.');
    return true;
  }catch{
    setText('historySyncStatus','Não foi possível consultar o histórico agora; os dados locais foram preservados.');
    return false;
  }
}

async function loadAccountHistory(){
  if(!auth?.access_token)return false;
  try{
    let res=await apiFetch('/history');
    if(res.status===401&&await refreshSession())res=await apiFetch('/history');
    if(!res.ok)return false;
    const data=await res.json();
    const weights=Array.isArray(data?.weights)?data.weights:[];
    const measurements=Array.isArray(data?.measurements)?data.measurements:[];
    const applications=Array.isArray(data?.applications)?data.applications:[];

    state.weights=weights
      .filter(item=>Number.isFinite(Number(item?.weightKg))&&Number.isFinite(Number(item?.timestampMs)))
      .map(item=>({
        id:String(item.id||''),
        value:Number(item.weightKg),
        at:new Date(Number(item.timestampMs)).toISOString(),
        origin:item.origin||'PROFILE'
      }))
      .sort((a,b)=>new Date(b.at)-new Date(a.at));
    if(state.weights.length)state.waterGoal=waterGoalFromWeight(state.weights[0].value);

    state.measurementHistory=measurements.map(remoteMeasurementToLocal).filter(Boolean)
      .sort((a,b)=>String(b.date).localeCompare(String(a.date)));

    state.applications=applications
      .map(remoteApplicationToLocal)
      .filter(Boolean)
      .sort((a,b)=>new Date(b.at)-new Date(a.at))
      .slice(0,200);

    state.activities=remoteMovementToLocal(data?.movement)
      .sort((a,b)=>new Date(b.at)-new Date(a.at))
      .slice(0,500);

    state.nutritionHistory=remoteNutritionToLocal(data?.nutrition)
      .sort((a,b)=>String(b.date).localeCompare(String(a.date)))
      .slice(0,365);
    const todayNutrition=state.nutritionHistory.find(day=>day.date===localDayKey());
    if(todayNutrition){
      state.protein=(todayNutrition.meals||[]).reduce((sum,meal)=>sum+Number(meal.proteinG||0),0);
      state.nutritionUpdatedAtMs=Number(todayNutrition.updatedAtMs||0);
    }

    state.treatment=normalizeRemoteTreatment(data?.treatment);

    const latest=state.measurementHistory[0];
    if(latest){
      state.measurements={
        waist:latest.waist??null,
        abdomen:latest.abdomen??null,
        hips:latest.hips??null,
        arm:latest.arm??null,
        thigh:latest.thigh??null,
        chest:latest.chest??null,
        savedAt:latest.date+'T12:00:00'
      };
    }
    saveState();
    return true;
  }catch{return false}
}

async function syncAccountHistory(payload){
  if(!auth?.access_token)return false;
  try{
    let res=await apiFetch('/history/sync',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    if(res.status===401&&await refreshSession()){
      res=await apiFetch('/history/sync',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
    }
    return res.ok;
  }catch{return false}
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
  setLoginStatus('Entrando…');
  try{
    const res=await fetch(API+'/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id_token:credential})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.code||('HTTP_'+res.status));
    saveAuth(data);
    state=loadState();
    setLoginStatus('');
    showApp();
    const reservedTrialEmail=sessionStorage.getItem('escudofit_trial_email');
    const trialActivated=data?.entitlement?.mode==='TRIAL_14D' &&
      reservedTrialEmail &&
      reservedTrialEmail===String(data?.user?.email||'').toLowerCase();
    if(trialActivated)sessionStorage.removeItem('escudofit_trial_email');
    toast(trialActivated?'Trial de 14 dias ativado':'Bem-vindo ao Escudo Fit');
  }catch(error){
    const code=String(error?.message||'LOGIN_FAILED');
    const cors=/Failed to fetch|NetworkError|Load failed/i.test(code);
    const accessDelay=/ACCESS_BACKEND_TIMEOUT|ACCESS_BACKEND_UNAVAILABLE|ACCESS_BACKEND_HTTP_ERROR/i.test(code);
    setLoginStatus(
      cors||accessDelay
        ? 'Estamos validando seu acesso. Tente novamente em alguns segundos.'
        : 'Não foi possível concluir o login. Tente novamente.',
      true
    );
  }
}

function initGoogle(){
  if(auth||googleReady)return;
  if(!window.google?.accounts?.id){
    setLoginStatus('');
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
    setLoginStatus('');
    $('retryGoogleButton').classList.add('hidden');
  }catch{
    setLoginStatus('Não foi possível carregar o login Google.',true);
    $('retryGoogleButton').classList.remove('hidden');
  }
}

async function resetGoogleSession(message){
  try{if(auth?.access_token)await apiFetch('/auth/logout',{method:'POST'})}catch{}
  saveAuth(null);auth=null;state={...defaults,activities:[],applications:[],weights:[],measurements:{},measurementHistory:[],nutritionHistory:[],treatment:null,profile:{name:''}};
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
document.querySelectorAll('[data-scroll-trial]').forEach(el=>el.addEventListener('click',()=>document.getElementById('trialSection')?.scrollIntoView({behavior:'smooth'})));
$('trialForm')?.addEventListener('submit',registerQuickTrial);
$('retryGoogleButton').addEventListener('click',()=>{googleReady=false;initGoogle()});

async function updateWater(nextWater){
  const updatedAtMs=Date.now();
  state.water=clamp(nextWater,0,10000);
  state.waterUpdatedAtMs=updatedAtMs;
  saveState();
  renderApp();
  const synced=await syncHistoryPatch({
    water:[{date:localDayKey(),consumedMl:state.water,updatedAtMs}],
  });
  toast(synced?'Hidratação salva na sua conta':'Hidratação salva; sincronização pendente');
}

document.querySelectorAll('[data-water]').forEach(b=>b.addEventListener('click',()=>{void updateWater(state.water+Number(b.dataset.water))}));
$('waterReset').addEventListener('click',()=>{void updateWater(0)});
$('stepsInput').addEventListener('change',e=>{state.steps=clamp(num(e.target.value),0,100000);saveState();renderApp();toast('Movimento salvo')});
$('activityStepsInput')?.addEventListener('change',e=>{state.steps=clamp(num(e.target.value),0,100000);saveState();renderApp();toast('Passos atualizados')});
// Protein consumed is a derived total of dated meals, never an unsynchronized counter.
$('proteinGoalInput').addEventListener('change',e=>{state.proteinGoal=clamp(num(e.target.value)||100,1,1000);saveState();renderApp()});

$('nutritionAddMeal')?.addEventListener('click',async()=>{
  const mealType=String($('nutritionMealType')?.value||'LUNCH');
  const grams=Number(String($('nutritionMealProtein')?.value||'').replace(',','.'));
  if(!Number.isFinite(grams)||grams<=0||grams>1000){
    setText('nutritionSaved','Informe uma quantidade válida de proteína.');
    return;
  }
  const now=Date.now();
  const date=localDayKey();
  const current=state.nutritionHistory.find(day=>day.date===date)||{date,updatedAtMs:0,meals:[]};
  const meal={
    id:crypto.randomUUID?crypto.randomUUID():'meal-'+now,
    mealType,proteinG:Math.round(grams*10)/10,
    at:new Date(now).toISOString(),
    description:String($('nutritionMealDescription')?.value||'').trim().slice(0,240)
  };
  const changed={
    date,
    updatedAtMs:Math.max(now,Number(current.updatedAtMs||0)+1),
    meals:[...(Array.isArray(current.meals)?current.meals:[]),meal]
  };
  let patch;
  try{patch=historyContract.nutritionPatch(changed)}
  catch{setText('nutritionSaved','Não foi possível validar a refeição.');return}
  state.nutritionHistory=historyContract.mergeNutritionDays(state.nutritionHistory,[changed]);
  state.protein=changed.meals.reduce((sum,item)=>sum+Number(item.proteinG||0),0);
  state.nutritionUpdatedAtMs=changed.updatedAtMs;
  if($('nutritionMealProtein'))$('nutritionMealProtein').value='';
  if($('nutritionMealDescription'))$('nutritionMealDescription').value='';
  saveState();renderApp();
  const synced=await syncHistoryPatch({nutrition:[patch]});
  setText('nutritionSaved',synced?'Refeição sincronizada com a Conta Google.':'Refeição salva localmente; sincronização pendente.');
  toast(synced?'Refeição sincronizada':'Refeição salva');
});

$('saveTreatment')?.addEventListener('click',async()=>{
  const medication=String($('treatmentMedication')?.value||'NONE');
  const medicationDoseLabel=String($('treatmentDose')?.value||'').trim().slice(0,80);
  const treatmentStartDateIso=String($('treatmentStart')?.value||'');
  if(!historyContract.validDate(treatmentStartDateIso)){
    setText('treatmentSaved','Informe uma data de início válida.');return;
  }
  const previous=state.treatment||null;
  const same=previous?.medication===medication&&
    String(previous?.medicationDoseLabel||'')===medicationDoseLabel&&
    previous?.treatmentStartDateIso===treatmentStartDateIso;
  if(same){setText('treatmentSaved','O tratamento informado já está atualizado.');return}
  const now=Date.now();
  const earlierHistory=Array.isArray(previous?.history)?previous.history:[];
  const archived=(previous&&previous.medication&&previous.medication!=='NONE')
    ? [{
      id:crypto.randomUUID?crypto.randomUUID():'treatment-'+now,
      medication:previous.medication,
      ...(previous.medicationDoseLabel?{doseLabel:previous.medicationDoseLabel}:{}),
      ...(historyContract.validDate(previous.treatmentStartDateIso)?{startDateIso:previous.treatmentStartDateIso}:{}),
      endDateIso:treatmentStartDateIso,
      changedAtMs:now
    }]
    : [];
  const next={
    medication,medicationDoseLabel,treatmentStartDateIso,
    updatedAtMs:Math.max(now,Number(previous?.updatedAtMs||0)+1),
    history:[...earlierHistory,...archived].slice(-200)
  };
  let patch;
  try{patch=historyContract.treatmentPatch(next)}
  catch{setText('treatmentSaved','Não foi possível validar o tratamento.');return}
  state.treatment=next;saveState();renderApp();
  const synced=await syncHistoryPatch({treatment:patch});
  setText('treatmentSaved',synced?'Tratamento sincronizado com a Conta Google.':'Tratamento salvo localmente; sincronização pendente.');
  toast(synced?'Tratamento sincronizado':'Tratamento salvo');
});

$('refreshHistoryButton')?.addEventListener('click',async()=>{
  setText('historySyncStatus','Consultando o histórico da sua conta…');
  const synced=await hydrateAccountHistory();
  toast(synced?'Histórico da conta atualizado':'Histórico local preservado; consulta pendente');
});
$('addWeight').addEventListener('click',async()=>{
  const v=num($('weightInput').value);
  if(v<20||v>400)return toast('Informe um peso válido');
  const timestampMs=Date.now();
  const id=crypto.randomUUID?crypto.randomUUID():'web-'+timestampMs;
  const local={id,value:v,at:new Date(timestampMs).toISOString()};
  state.weights=[local,...state.weights].slice(0,200);
  state.waterGoal=waterGoalFromWeight(v);
  $('weightInput').value='';
  saveState();
  renderApp();
  const synced=await syncHistoryPatch({weights:[{id,weightKg:v,timestampMs,origin:'PROFILE'}],measurements:[]});
  toast(synced?'Peso salvo na sua conta':'Peso salvo; sincronização pendente');
});
$('saveMeasurements').addEventListener('click',async()=>{
  const date=localDayKey();
  const local={
    date,
    waist:num($('mWaist').value)||null,
    abdomen:num($('mAbdomen').value)||null,
    hips:num($('mHip').value)||null,
    arm:num($('mArm').value)||null,
    thigh:num($('mThigh').value)||null,
    chest:num($('mChest').value)||null,
  };
  state.measurements={...local,savedAt:new Date().toISOString()};
  const history=(Array.isArray(state.measurementHistory)?state.measurementHistory:[]).filter(item=>item.date!==date);
  state.measurementHistory=[local,...history].slice(0,200);
  saveState();
  renderApp();
  const remote={
    date,
    ...(local.waist?{waist:local.waist}:{}),
    ...(local.abdomen?{abdomen:local.abdomen}:{}),
    ...(local.hips?{hips:local.hips}:{}),
    ...(local.chest?{chest:local.chest}:{}),
    ...(local.arm?{arm:local.arm}:{}),
    ...(local.thigh?{thigh:local.thigh}:{}),
  };
  const synced=await syncHistoryPatch({weights:[],measurements:[remote]});
  $('measureSaved').textContent=synced?'Medidas salvas na sua conta.':'Medidas salvas; sincronização pendente.';
  toast(synced?'Medidas sincronizadas':'Medidas salvas');
});
$('addActivity')?.addEventListener('click',async()=>{
  const type=$('activityType')?.value||'WALKING';
  const raw=String($('activityDuration')?.value||'').trim();
  const duration=raw===''?null:Number(raw);
  if(duration!==null&&(!Number.isInteger(duration)||duration<=0||duration>1440)){
    if($('activitySaved'))$('activitySaved').textContent='Informe uma duração válida ou deixe em branco.';
    return;
  }
  const now=Date.now();
  const entry={id:(crypto.randomUUID?crypto.randomUUID():'activity-'+now),type,duration,at:new Date(now).toISOString()};
  state.activities=[entry,...(Array.isArray(state.activities)?state.activities:[])].slice(0,500);
  if($('activityDuration'))$('activityDuration').value='';
  saveState();renderApp();
  const date=localDayKey(entry.at);
  const records=state.activities
    .filter(item=>localDayKey(item.at)===date)
    .map(item=>({
      id:item.id,
      activityType:item.type,
      timestampMs:new Date(item.at).getTime(),
      ...(item.duration?{durationMinutes:Number(item.duration)}:{})
    }));
  const synced=await syncHistoryPatch({movement:[{date,records,updatedAtMs:now}]});
  if($('activitySaved'))$('activitySaved').textContent=synced?'Atividade salva na sua conta.':'Atividade registrada; sincronização pendente.';
  toast(synced?'Atividade sincronizada':'Atividade registrada');
});

document.querySelectorAll('[data-application-site]').forEach(btn=>btn.addEventListener('click',async()=>{
  const site=String(btn.dataset.applicationSite||'').trim();
  if(!site)return;
  const appliedAtMs=Date.now();
  const entry={id:(crypto.randomUUID?crypto.randomUUID():'application-'+appliedAtMs),site,at:new Date(appliedAtMs).toISOString()};
  state.applications=[entry,...(Array.isArray(state.applications)?state.applications:[])].slice(0,200);
  saveState();renderApp();
  const synced=await syncHistoryPatch({applications:[{id:entry.id,site,appliedAtMs}]});
  if($('applicationSaved'))$('applicationSaved').textContent=synced
    ? 'Aplicação registrada na sua conta em '+site+'.'
    : 'Aplicação registrada neste navegador; sincronização pendente.';
  toast(synced?'Aplicação sincronizada':'Aplicação registrada');
}));

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
$('clearData').addEventListener('click',()=>{if(!confirm('Apagar todos os registros locais desta versão web?'))return;localStorage.removeItem(dataKey());state={...defaults,activities:[],applications:[],weights:[],measurements:{},measurementHistory:[],nutritionHistory:[],treatment:null,profile:{name:''}};renderApp();toast('Dados locais apagados')});
$('logoutButton').addEventListener('click',logout);
$('logoutButtonBottom').addEventListener('click',logout);
$('switchAccountButton')?.addEventListener('click',switchGoogleAccount);

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('installButtonFloating').classList.remove('hidden')});
$('installButtonFloating').addEventListener('click',async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('installButtonFloating').classList.add('hidden')});
window.addEventListener('appinstalled',()=>toast('Escudo Fit instalado'));

window.addEventListener('focus',()=>{
  if(auth?.user)void hydrateAccountHistory();
});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&auth?.user)void hydrateAccountHistory();
});

if('serviceWorker'in navigator){
  let reloadingForWorker=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(reloadingForWorker)return;
    reloadingForWorker=true;
    location.reload();
  });
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'})
      .then(registration=>registration.update())
      .catch(()=>{});
  });
}

(async function boot(){
  if(auth&&await validateStoredSession())showApp();
  else{if(auth)saveAuth(null);auth=null;showMarketing()}
})();
