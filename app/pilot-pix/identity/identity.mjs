export const IDENTITY_API='https://escudo-fit-pilot-h3b-identity-qa-olb3tmj35q-uc.a.run.app/api/v38/pilot-pix/identity';
export const GOOGLE_CLIENT_ID='835029473980-22hokuuman3rpbiefs54gg1ntnqu6lc7.apps.googleusercontent.com';
export const PURPOSE='ESCUDO_FIT_H3B_IDENTITY_QA_ONLY_V1';
const INTENT='escudo-fit-h3b-identity-qa-v1';
const flags=['financialGo','orderCreated','paymentConfirmed','premiumGranted'];
const id=/^[A-Za-z0-9_-]{43}$/;
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const noFinance=v=>flags.every(k=>v[k]===false);
const token=v=>typeof v==='string'&&v.length<=16384&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v);
const base=v=>v?.purpose===PURPOSE&&id.test(v.challengeId||'')&&noFinance(v);
const deadline=(v,now)=>Number.isSafeInteger(v)&&v>now&&v<=now+120000;
const challenge=(v,now)=>exact(v,['state','purpose','challengeId','buyerNonce','operatorNonce','expiresAtMs',...flags])&&base(v)&&v.state==='CHALLENGE'&&
 /^ef-h3b-qa-buyer-v1-[A-Za-z0-9_-]{43}$/.test(v.buyerNonce)&&/^ef-h3b-qa-operator-v1-[A-Za-z0-9_-]{43}$/.test(v.operatorNonce)&&deadline(v.expiresAtMs,now);
export function validateIdentityReceipt(v,now=Date.now()){
 const proof=['googleSignaturesVerified','noncesVerified','identitiesDistinct','operatorVerified','buyerVerified'];
 if(!exact(v,['state','purpose','challengeId','completedAtMs','receiptDigest',...proof,...flags])||!base(v)||v.state!=='IDENTITIES_VERIFIED_NO_ORDER'||
  !proof.every(k=>v[k]===true)||!/^[a-f0-9]{64}$/.test(v.receiptDigest||'')||!Number.isSafeInteger(v.completedAtMs)||v.completedAtMs>now+30000||v.completedAtMs<now-180000)throw Error('INVALID_QA_RECEIPT');
 return Object.freeze({...v});
}
export function readBuyerLink(hash,now=Date.now()){
 const p=new URLSearchParams(String(hash).replace(/^#/,''));
 if([...p.keys()].length!==3||!['c','n','e'].every(k=>p.has(k)))return null;
 const data={challengeId:p.get('c'),buyerNonce:p.get('n'),expiresAtMs:Number(p.get('e'))};
 if(!id.test(data.challengeId||'')||!/^ef-h3b-qa-buyer-v1-[A-Za-z0-9_-]{43}$/.test(data.buyerNonce||'')||!deadline(data.expiresAtMs,now))return null;
 return Object.freeze(data);
}
const randomEntry=()=>{const b=new Uint8Array(32);crypto.getRandomValues(b);return 'ef-h3b-qa-entry-v1-'+btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};

export function createIdentityQaController({role='operator',buyerLink=null,fetchImpl=fetch,now=Date.now,renderGoogle,onState=()=>{},
 schedule=setTimeout,cancel=clearTimeout,entryNonce=randomEntry}={}){
 let phase='READY',epoch=0,bootstrap=null,scope=null,receipt=null,timer=null,flight=null,expiry=0;
 const emit=(p,message='')=>{phase=p;onState(Object.freeze({phase:p,message,role,hasShare:Boolean(scope&&role==='operator'&&p==='WAITING_BUYER'),hasReceipt:Boolean(receipt)}));};
 const erase=()=>{bootstrap=null;scope=null;receipt=null;expiry=0;cancel(timer);timer=null;flight?.abort();flight=null;};
 const reset=(message='Verificação cancelada. Os dados transitórios foram descartados.')=>{epoch++;erase();emit('READY',message);};
 const fail=()=>{epoch++;erase();emit('FAILED','A verificação não foi concluída. Confira as contas e inicie uma nova sessão.');};
 const check=e=>{if(e!==epoch||now()>=expiry)throw Error('QA_SESSION_EXPIRED');};
 const arm=e=>{cancel(timer);timer=schedule(()=>{if(e===epoch){epoch++;erase();emit('EXPIRED','O prazo de dois minutos terminou. Inicie novamente pela conta de auditoria.');}},Math.max(0,expiry-now()));};
 const request=async(body,credential,e)=>{
  check(e);const abort=new AbortController();flight=abort;const limit=schedule(()=>abort.abort(),14000);
  try{
   const response=await fetchImpl(IDENTITY_API,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:abort.signal,
    headers:{authorization:'Bearer '+credential,'content-type':'application/json','x-escudo-pilot-intent':INTENT},body:JSON.stringify(body)});
   check(e);if(!response.ok||!response.body||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))throw Error('QA_HTTP_FAILED');
   const reader=response.body.getReader(),chunks=[];let size=0;
   try{for(;;){const {done,value}=await reader.read();check(e);if(done)break;size+=value.byteLength;if(size>8192)throw Error('QA_RESPONSE_BOUND');chunks.push(value);}}
   finally{reader.cancel().catch(()=>{});}
   const all=new Uint8Array(size);let offset=0;for(const b of chunks){all.set(b,offset);offset+=b.byteLength;}
   const output=JSON.parse(new TextDecoder().decode(all));check(e);return output;
  }finally{credential=null;cancel(limit);abort.abort();if(flight===abort)flight=null;}
 };
 const prompt=(p,nonce,e)=>renderGoogle({role:p==='BUYER_LOGIN'?'buyer':'operator',nonce,callback:async response=>{
  let credential=response?.credential;if(response&&typeof response==='object')try{response.credential=undefined;}catch{}
  if(e!==epoch||phase!==p){credential=null;return false;}
  try{
   check(e);if(!token(credential))throw Error('QA_CREDENTIAL_INVALID');emit('CHECKING','Conferindo a identidade Google…');
   if(p==='ENTRY'){
    bootstrap=credential;credential=null;
    const result=await request({action:'CHALLENGE',entryNonce:nonce},bootstrap,e);
    if(!challenge(result,now()))throw Error('QA_CHALLENGE_INVALID');scope=result;expiry=result.expiresAtMs;arm(e);
    emit('WAITING_BUYER','Abra o link do comprador em outro dispositivo ou perfil e confirme a conta indicada.');
   }else if(p==='BUYER_LOGIN'){
    const result=await request({action:'BUYER_CONFIRM',challengeId:scope.challengeId,buyerNonce:scope.buyerNonce},credential,e);credential=null;
    if(!exact(result,['state','purpose','challengeId','expiresAtMs',...flags])||!base(result)||result.state!=='BUYER_CONFIRMED'||result.challengeId!==scope.challengeId||!deadline(result.expiresAtMs,now()))throw Error('QA_BUYER_INVALID');
    erase();emit('BUYER_PASSED','Conta do comprador confirmada. Volte à página da auditoria para concluir.');
   }else{
    const body={action:'OPERATOR_CONFIRM',challengeId:scope.challengeId,operatorIdToken:credential};credential=null;let result;
    try{result=await request(body,bootstrap,e);}finally{body.operatorIdToken=null;}
    const checked=validateIdentityReceipt(result,now());check(e);if(checked.challengeId!==scope.challengeId)throw Error('QA_WRONG_SESSION');
    erase();receipt=checked;emit('PASSED','Duas contas Google verificadas com nonces distintos. Nenhuma cobrança, assinatura financeira ou concessão Premium foi feita.');
   }
   return true;
  }catch{credential=null;if(e===epoch)fail();return false;}
 }});
 return Object.freeze({
  start(){if(!['READY','FAILED','EXPIRED','PASSED'].includes(phase))return false;epoch++;erase();const e=epoch;expiry=now()+120000;
   if(role==='buyer'){
    if(!buyerLink||!deadline(buyerLink.expiresAtMs,now())){fail();return false;}
    scope={...buyerLink};expiry=scope.expiresAtMs;arm(e);emit('BUYER_LOGIN','Entre com tonysacramento@gmail.com nesta página do comprador.');
    try{prompt('BUYER_LOGIN',scope.buyerNonce,e);}catch{fail();}
   }else{arm(e);emit('ENTRY','Entre com escudofit.revisao@gmail.com para iniciar.');try{prompt('ENTRY',entryNonce(),e);}catch{fail();}}
   return true;
  },
  async status(){if(role!=='operator'||phase!=='WAITING_BUYER'||!scope||!bootstrap)return false;const e=epoch;emit('CHECKING','Conferindo a confirmação do comprador…');
   try{const v=await request({action:'STATUS',challengeId:scope.challengeId},bootstrap,e);
    if(!exact(v,['state','purpose','challengeId','expiresAtMs',...flags])||!base(v)||v.challengeId!==scope.challengeId||!deadline(v.expiresAtMs,now())||!['WAITING_BUYER','VERIFYING_BUYER','WAITING_OPERATOR'].includes(v.state))throw Error('QA_STATUS_INVALID');
    expiry=Math.min(expiry,v.expiresAtMs);arm(e);
    if(v.state==='WAITING_OPERATOR'){emit('OPERATOR_LOGIN','Confirme novamente escudofit.revisao@gmail.com para concluir.');prompt('OPERATOR_LOGIN',scope.operatorNonce,e);}
    else emit('WAITING_BUYER','O comprador ainda precisa confirmar a conta.');return true;
   }catch{if(e===epoch)fail();return false;}
  },
  reset,
  checkExpiry(){if(expiry&&expiry<=now()){epoch++;erase();emit('EXPIRED','O prazo terminou. Inicie uma nova sessão pela auditoria.');}},
  getShare(){return phase==='WAITING_BUYER'&&scope&&expiry>now()?Object.freeze({challengeId:scope.challengeId,buyerNonce:scope.buyerNonce,expiresAtMs:expiry}):null;},
  getReceipt(){return phase==='PASSED'&&receipt?Object.freeze({...receipt}):null;},
  snapshot:()=>Object.freeze({phase,hasCredentials:Boolean(bootstrap),hasChallenge:Boolean(scope),hasReceipt:Boolean(receipt)})
 });
}

function boot(){
 const get=id=>document.getElementById(id),slot=get('google-slot'),role=new URL(location.href).searchParams.get('role')==='buyer'?'buyer':'operator';
 const link=role==='buyer'?readBuyerLink(location.hash):null;
 if(location.hash)history.replaceState(null,'',location.pathname+(role==='buyer'?'?role=buyer':''));
 let ready=false;const labels={READY:'Iniciar verificação',ENTRY:'Conta de auditoria',WAITING_BUYER:'Confirmação do comprador',CHECKING:'Verificando',BUYER_LOGIN:'Conta do comprador',OPERATOR_LOGIN:'Confirmação final da auditoria',PASSED:'Duas contas verificadas',BUYER_PASSED:'Comprador confirmado',FAILED:'Verificação não concluída',EXPIRED:'Prazo encerrado'};
 get('role-label').textContent=role==='buyer'?'PÁGINA DO COMPRADOR':'PÁGINA DA AUDITORIA';
 const controller=createIdentityQaController({role,buyerLink:link,onState:s=>{
  get('step-title').textContent=labels[s.phase];get('status').textContent=s.message;slot.replaceChildren();
  get('start').hidden=!['READY','FAILED','EXPIRED','PASSED'].includes(s.phase);get('start').disabled=!ready;
  get('refresh').hidden=s.phase!=='WAITING_BUYER';get('cancel').hidden=['READY','FAILED','EXPIRED','PASSED','BUYER_PASSED'].includes(s.phase);
  get('share-box').hidden=!s.hasShare;get('receipt-box').hidden=!s.hasReceipt;
  const share=controller.getShare();if(share){const u=new URL('/app/pilot-pix/identity/',location.origin);u.searchParams.set('role','buyer');u.hash=new URLSearchParams({c:share.challengeId,n:share.buyerNonce,e:String(share.expiresAtMs)}).toString();get('buyer-link').value=u.href;}else get('buyer-link').value='';
  get('receipt-digest').textContent=controller.getReceipt()?.receiptDigest||'';
 },renderGoogle:({role,nonce,callback})=>{
  if(!ready)throw Error('GOOGLE_UNAVAILABLE');const api=window.google.accounts.id;api.disableAutoSelect();
  api.initialize({client_id:GOOGLE_CLIENT_ID,nonce,callback,auto_select:false,button_auto_select:false,use_fedcm_for_button:true,ux_mode:'popup',login_hint:role==='buyer'?'tonysacramento@gmail.com':'escudofit.revisao@gmail.com'});
  api.renderButton(slot,{theme:'outline',size:'large',shape:'pill',text:'continue_with',width:Math.min(320,Math.max(200,slot.clientWidth))});
 }});
 get('start').addEventListener('click',()=>controller.start());get('refresh').addEventListener('click',()=>controller.status());get('cancel').addEventListener('click',()=>controller.reset());
 get('copy-link').addEventListener('click',async()=>{if(!controller.getShare())return;try{await navigator.clipboard.writeText(get('buyer-link').value);get('status').textContent='Link do comprador copiado. Ele expira em até dois minutos.';}catch{get('buyer-link').focus();get('buyer-link').select();get('status').textContent='Selecione e copie o link do comprador.';}});
 get('download').addEventListener('click',()=>{const receipt=controller.getReceipt();if(!receipt)return;const url=URL.createObjectURL(new Blob([JSON.stringify(receipt,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='escudo-fit-verificacao-identidades-'+receipt.receiptDigest.slice(0,12)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 window.addEventListener('pagehide',()=>controller.reset(''));window.addEventListener('pageshow',e=>{if(e.persisted)controller.reset('Inicie uma nova sessão.');});document.addEventListener('visibilitychange',()=>controller.checkExpiry());window.addEventListener('escudofit:accountChanged',()=>controller.reset('A conta mudou.'));window.addEventListener('storage',e=>{if(e.key==='escudofit_web_auth_v1')controller.reset('A conta mudou.');});
 const started=Date.now();const load=()=>{if(window.google?.accounts?.id){ready=true;get('start').disabled=false;get('start').textContent='Iniciar verificação';get('status').textContent=role==='buyer'&&!link?'Link ausente ou expirado. Solicite um novo link à auditoria.':'';return;}if(Date.now()-started<10000)setTimeout(load,200);else get('status').textContent='O login Google não carregou. Reabra a página.';};load();
}
if(typeof window!=='undefined'&&typeof document!=='undefined')boot();
