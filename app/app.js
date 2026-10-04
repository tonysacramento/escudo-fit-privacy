const KEY='escudofit_web_beta_v1';
const $=id=>document.getElementById(id);
const defaults={water:0,waterGoal:2000,steps:0,stepsGoal:8000,protein:0,proteinGoal:100,weights:[],measurements:{},profile:{name:''},updatedAt:null};
let state=load();
let installPrompt=null;

function load(){try{return {...defaults,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{return {...defaults}}}
function save(){state.updatedAt=new Date().toISOString();localStorage.setItem(KEY,JSON.stringify(state))}
function clamp(n,min,max){return Math.min(max,Math.max(min,n))}
function pct(v,g){return g>0?clamp(Math.round((v/g)*100),0,100):0}
function num(v){const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?n:0}
function fmtDate(iso){return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(iso))}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('show'),2200)}

function render(){
  const wp=pct(state.water,state.waterGoal);$('waterPct').textContent=wp+'%';$('waterBar').style.width=wp+'%';$('waterMl').textContent=state.water+' ml';$('waterGoalLabel').textContent=state.waterGoal+' ml';
  const sp=pct(state.steps,state.stepsGoal);$('stepsPct').textContent=sp+'%';$('stepsBar').style.width=sp+'%';$('stepsInput').value=state.steps||'';
  const pp=pct(state.protein,state.proteinGoal);$('proteinPct').textContent=pp+'%';$('proteinBar').style.width=pp+'%';$('proteinInput').value=state.protein||'';$('proteinGoalInput').value=state.proteinGoal||100;
  $('lastWeight').textContent=state.weights.length?state.weights[0].value.toFixed(1).replace('.',',')+' kg':'—';
  $('weightHistory').innerHTML=state.weights.slice(0,5).map(w=>'<div class="history-row"><span>'+fmtDate(w.at)+'</span><strong>'+w.value.toFixed(1).replace('.',',')+' kg</strong></div>').join('')||'<small>Nenhum peso registrado ainda.</small>';
  const m=state.measurements||{};[['mWaist','waist'],['mAbdomen','abdomen'],['mHip','hip'],['mArm','arm'],['mThigh','thigh'],['mChest','chest']].forEach(([id,k])=>$(id).value=m[k]??'');
  $('profileName').value=state.profile?.name||'';
}

document.querySelectorAll('[data-water]').forEach(b=>b.addEventListener('click',()=>{state.water=clamp(state.water+Number(b.dataset.water),0,10000);save();render();toast('Hidratação atualizada')}));
$('waterReset').addEventListener('click',()=>{state.water=0;save();render()});
$('stepsInput').addEventListener('change',e=>{state.steps=clamp(num(e.target.value),0,100000);save();render();toast('Movimento salvo')});
$('proteinInput').addEventListener('change',e=>{state.protein=clamp(num(e.target.value),0,1000);save();render()});
$('proteinGoalInput').addEventListener('change',e=>{state.proteinGoal=clamp(num(e.target.value)||100,1,1000);save();render()});
$('addWeight').addEventListener('click',()=>{const v=num($('weightInput').value);if(v<20||v>400)return toast('Informe um peso válido');state.weights=[{value:v,at:new Date().toISOString()},...state.weights].slice(0,50);$('weightInput').value='';save();render();toast('Peso registrado')});
$('saveMeasurements').addEventListener('click',()=>{state.measurements={waist:num($('mWaist').value)||null,abdomen:num($('mAbdomen').value)||null,hip:num($('mHip').value)||null,arm:num($('mArm').value)||null,thigh:num($('mThigh').value)||null,chest:num($('mChest').value)||null,savedAt:new Date().toISOString()};save();$('measureSaved').textContent='Medidas salvas neste aparelho em '+new Date().toLocaleString('pt-BR')+'.';toast('Medidas salvas')});
$('saveProfile').addEventListener('click',()=>{state.profile={name:$('profileName').value.trim()};save();toast('Perfil salvo neste aparelho')});

document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x===btn));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===btn.dataset.target));window.scrollTo({top:0,behavior:'smooth'})}));

$('exportData').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='escudo-fit-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);toast('Backup exportado')});
$('clearData').addEventListener('click',()=>{if(!confirm('Apagar todos os registros locais desta versão web?'))return;localStorage.removeItem(KEY);state={...defaults,weights:[],measurements:{},profile:{name:''}};render();toast('Dados locais apagados')});

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('installBtn').classList.remove('hidden')});
$('installBtn').addEventListener('click',async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('installBtn').classList.add('hidden')});
window.addEventListener('appinstalled',()=>toast('Escudo Fit instalado'));

if('serviceWorker'in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}))}
render();