const OPERATOR='6b3b55088d7a4f1ccd0323121f5c01029d6e1be9a566850e5e6bb2c0838c4bbb';
const TERMS='prepaid-v1-2026-10-16';
const fields=['schemaVersion','approvalId','scope','state','approvedBySubjectHash','subjectHash','bindingDigest',
  'requestKeyHash','receiverAccountId','maxAmountBRL','currency','maxOrders','planKey','channel','termsVersion','issuedAtMs','expiresAtMs'];
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const noFinance=v=>['financialGo','approvalCreated','orderCreated','premiumGranted'].every(k=>v[k]===false);
const noFinanceFields=['financialGo','approvalCreated','orderCreated','premiumGranted'];
const token=v=>typeof v==='string'&&v.length<=16384&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,'0')).join('');

/** Scope/encoding precheck only. The private server verifies the Ed25519 signature
 * using its pinned public key before issuing a challenge and before storing. */
export async function validateIssueApproval(text,now=Date.now()){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>8192)throw Error('INVALID');
  const r=JSON.parse(text);
  if(!exact(r,[...fields,'operatorSignature'])||typeof r.operatorSignature!=='string'||! /^[A-Za-z0-9_-]{86}$/.test(r.operatorSignature)||r.schemaVersion!==1||
    !uuid.test(r.approvalId)||r.scope!=='FIRST_LIVE_PIX_SINGLE_ORDER'||r.state!=='APPROVED_SINGLE_PILOT'||
    r.approvedBySubjectHash!==OPERATOR||r.subjectHash===OPERATOR||
    !['subjectHash','bindingDigest','requestKeyHash'].every(k=>/^[a-f0-9]{64}$/.test(r[k]))||
    r.receiverAccountId!=='13926970'||r.maxAmountBRL!=='4.99'||r.currency!=='BRL'||r.maxOrders!==1||
    r.planKey!=='monthly'||r.channel!=='WEB_OFFICIAL_DIRECT'||r.termsVersion!==TERMS||
    !Number.isSafeInteger(r.issuedAtMs)||r.issuedAtMs<=0||r.issuedAtMs>now+60000||
    !Number.isSafeInteger(r.expiresAtMs)||r.expiresAtMs<=now||r.expiresAtMs<=r.issuedAtMs||r.expiresAtMs>r.issuedAtMs+1800000)throw Error('INVALID');
  const h=(await sha('ESCUDO_FIT_PILOT_REQUEST_KEY_V1|'+r.approvalId)).slice(0,32).split('');
  h[12]='4';h[16]=((parseInt(h[16],16)&3)|8).toString(16);const key=h.join('');
  const requestKey=`${key.slice(0,8)}-${key.slice(8,12)}-${key.slice(12,16)}-${key.slice(16,20)}-${key.slice(20)}`;
  const payload=JSON.stringify(['ESCUDO_FIT_FIRST_LIVE_APPROVAL_V1','escudo-fitclima','escudo-fit-payments-commercial',
    r.schemaVersion,r.approvalId,r.scope,r.approvedBySubjectHash,r.subjectHash,r.bindingDigest,r.requestKeyHash,
    r.receiverAccountId,r.maxAmountBRL,r.currency,r.maxOrders,r.planKey,r.channel,r.termsVersion,r.issuedAtMs,r.expiresAtMs]);
  if(r.requestKeyHash!==await sha(requestKey))throw Error('INVALID');
  return Object.freeze({record:Object.freeze({...r}),scopeDigest:await sha(payload)});
}
export const ISSUE_API='https://escudo-fit-pilot-h3b-gateway-olb3tmj35q-uc.a.run.app/api/v38/pilot-pix/gateway';
export const GOOGLE_CLIENT_ID='835029473980-22hokuuman3rpbiefs54gg1ntnqu6lc7.apps.googleusercontent.com';
export const ISSUE_PURPOSE='ESCUDO_FIT_FIRST_LIVE_ISSUE_OPERATOR_V1';
const INTENT='escudo-fit-first-live-pilot-v1';
const id=/^[A-Za-z0-9_-]{43}$/;
const deadline=(v,now)=>Number.isSafeInteger(v)&&v>now&&v<=now+120000;
const noOrder=['financialGo','orderCreated','paymentConfirmed','premiumGranted'];
const freshChallenge=(v,now)=>exact(v,['state','purpose','challengeId','buyerNonce','operatorNonce','expiresAtMs',...noOrder])&&
 v.state==='CHALLENGE'&&v.purpose===ISSUE_PURPOSE&&id.test(v.challengeId||'')&&
 /^ef-issue-buyer-v1-[A-Za-z0-9_-]{43}$/.test(v.buyerNonce||'')&&
 /^ef-issue-operator-v1-[A-Za-z0-9_-]{43}$/.test(v.operatorNonce||'')&&deadline(v.expiresAtMs,now)&&noOrder.every(k=>v[k]===false);
export function readIssueBuyerLink(hash,now=Date.now()){
 const p=new URLSearchParams(String(hash).replace(/^#/,''));
 if([...p.keys()].length!==4||!['a','c','n','e'].every(k=>p.has(k)))return null;
 const v={approvalId:p.get('a'),challengeId:p.get('c'),buyerNonce:p.get('n'),expiresAtMs:Number(p.get('e'))};
 return uuid.test(v.approvalId||'')&&id.test(v.challengeId||'')&&/^ef-issue-buyer-v1-[A-Za-z0-9_-]{43}$/.test(v.buyerNonce||'')&&deadline(v.expiresAtMs,now)?Object.freeze(v):null;
}
export function validateIssueResult(v){
 const created=['ORDER_CREATED_FINANCIAL_CONTRACT_PENDING','ORDER_CREATED_CHECKOUT_REVIEW_REQUIRED'];
 const states=[...created,'EXISTING_ORDER_RECONCILIATION_REQUIRED','PROVIDER_POST_OUTCOME_UNCERTAIN',
  'PROVIDER_GET_REVIEW_REQUIRED','PROVIDER_PAYMENT_OBSERVED_REVIEW_REQUIRED','PROVIDER_ORDER_FOUND_AWAITING_PAYMENT'];
 const required=['state','orderId','orderCreated','paymentConfirmed','premiumGranted'],optional=['outcomeRecorded','mode','reason'];
 if(!v||Object.getPrototypeOf(v)!==Object.prototype||!required.every(k=>Object.hasOwn(v,k))||
  Object.keys(v).some(k=>![...required,...optional].includes(k))||!states.includes(v.state)||
  v.orderCreated!==created.includes(v.state)||v.paymentConfirmed!==false||v.premiumGranted!==false||
  v.orderId!==null&&!/^EF-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v.orderId||'')||
  Object.hasOwn(v,'outcomeRecorded')&&typeof v.outcomeRecorded!=='boolean'||
  Object.hasOwn(v,'mode')&&v.mode!=='READ_ONLY'||
  Object.hasOwn(v,'reason')&&!/^[A-Z0-9_]{1,96}$/.test(v.reason||''))throw Error('INVALID_ISSUE_RESULT');
 return Object.freeze({...v});
}
const randomEntry=()=>{const b=new Uint8Array(32);crypto.getRandomValues(b);return 'ef-issue-entry-v1-'+btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
async function requestKey(approvalId){
 const h=(await sha('ESCUDO_FIT_PILOT_REQUEST_KEY_V1|'+approvalId)).slice(0,32).split('');
 h[12]='4';h[16]=((parseInt(h[16],16)&3)|8).toString(16);
 const v=h.join('');return [v.slice(0,8),v.slice(8,12),v.slice(12,16),v.slice(16,20),v.slice(20)].join('-');
}
export function createPilotIssueController({role='operator',buyerLink=null,fetchImpl=fetch,now=Date.now,renderGoogle,
 onState=()=>{},schedule=setTimeout,cancel=clearTimeout,entryNonce=randomEntry}={}){
 let phase='READY',epoch=0,record=null,scope=null,bootstrap=null,expiry=0,timer=null,flight=null,result=null,attempted=false;
 const emit=(p,message='')=>{phase=p;onState(Object.freeze({phase:p,message,role,attempted,hasFile:Boolean(record),
  hasShare:p==='WAITING_BUYER'&&Boolean(scope),hasResult:Boolean(result)}));};
 const erase=()=>{record=null;scope=null;bootstrap=null;expiry=0;cancel(timer);timer=null;flight?.abort();flight=null;};
 const stop=message=>{epoch++;erase();emit(attempted?'OUTCOME_UNCERTAIN':'FAILED',attempted?
  'A emissão pode ter sido processada. Não repita. A conferência deve consultar a reserva e o provedor.':message);};
 const reset=message=>{epoch++;erase();if(attempted){emit('OUTCOME_UNCERTAIN','A tentativa já foi enviada. Consulte a conciliação antes de qualquer nova ação.');return false;}
  result=null;emit('READY',message||'Sessão limpa.');return true;};
 const check=e=>{if(e!==epoch||!expiry||now()>=expiry)throw Error('ISSUE_SESSION_EXPIRED');};
 const arm=e=>{cancel(timer);timer=schedule(()=>{if(e===epoch)stop('O prazo terminou. Inicie novamente com uma aprovação válida.');},Math.max(0,expiry-now()));};
 const request=async(path,body,credential,e)=>{
  check(e);const abort=new AbortController();flight=abort;const limit=schedule(()=>abort.abort(),22000);
  try{
   const response=await fetchImpl(path,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:abort.signal,
    headers:{authorization:'Bearer '+credential,'content-type':'application/json','x-escudo-pilot-intent':INTENT},body:JSON.stringify(body)});
   check(e);if(!response.ok||!response.body||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))throw Error('ISSUE_HTTP_FAILED');
   const reader=response.body.getReader(),chunks=[];let size=0;
   try{for(;;){const r=await reader.read();check(e);if(r.done)break;size+=r.value.byteLength;if(size>4096)throw Error('ISSUE_RESPONSE_BOUND');chunks.push(r.value);}}
   finally{reader.cancel().catch(()=>{});}
   const bytes=new Uint8Array(size);let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.byteLength;}
   const value=JSON.parse(new TextDecoder().decode(bytes));check(e);return value;
  }finally{credential=null;cancel(limit);abort.abort();if(flight===abort)flight=null;}
 };
 const prompt=(p,nonce,e)=>renderGoogle({role:p==='BUYER_LOGIN'?'buyer':'operator',nonce,callback:async response=>{
  let credential=response?.credential;try{if(response&&typeof response==='object')response.credential=undefined;}catch{}
  if(e!==epoch||phase!==p){credential=null;return false;}
  try{
   check(e);if(!token(credential))throw Error('INVALID_GOOGLE_CREDENTIAL');
   emit('CHECKING','Conferindo a conta Google…');
   if(p==='ENTRY'){
    bootstrap=credential;credential=null;
    const challenge=await request(ISSUE_API,{action:'CHALLENGE',approvalId:record.approvalId},bootstrap,e);
    if(!freshChallenge(challenge,now()))throw Error('INVALID_ISSUE_CHALLENGE');
    scope=challenge;expiry=Math.min(expiry,challenge.expiresAtMs);arm(e);
    emit('WAITING_BUYER','Abra o link em outro dispositivo ou perfil. O comprador deve confirmar tonysacramento@gmail.com.');
   }else if(p==='BUYER_LOGIN'){
    const v=await request(ISSUE_API+'/buyer',{approvalId:scope.approvalId,challengeId:scope.challengeId,buyerNonce:scope.buyerNonce},credential,e);
    credential=null;
    if(!exact(v,['state','challengeId','expiresAtMs'])||v.state!=='BUYER_CONFIRMED'||v.challengeId!==scope.challengeId||
     !deadline(v.expiresAtMs,now())||v.expiresAtMs>expiry)throw Error('INVALID_BUYER_CONFIRMATION');
    erase();emit('BUYER_CONFIRMED','Comprador confirmado. Volte à auditoria para a confirmação final. O pagamento será manual.');
   }else{
    const key=await requestKey(record.approvalId);check(e);
    const body={action:'ISSUE',mode:'ISSUE',approvalId:record.approvalId,challengeId:scope.challengeId,
     operatorIdToken:credential,requestKey:key,confirmedTermsVersion:TERMS};credential=null;
    // Latch before the only financial POST. Errors, cancellation and ambiguous
    // responses never make start() or confirmOperator() available again.
    attempted=true;emit('ISSUING','Enviando a única tentativa autorizada. Aguarde a resposta.');
    let value;try{value=await request(ISSUE_API,body,bootstrap,e);}finally{body.operatorIdToken=null;}
    const checked=validateIssueResult(value);check(e);erase();result=checked;
    emit(checked.orderCreated?'ORDER_CREATED':'REVIEW_REQUIRED',checked.orderCreated?
     'Ordem Pix registrada. Pagamento e conciliação ainda pendentes. Premium não liberado.':
     'O servidor exige conferência da ordem existente ou do resultado do provedor. Não faça outra tentativa.');
   }
   return true;
  }catch{credential=null;if(e===epoch)stop('Não foi possível concluir. Confira o serviço, o prazo da aprovação e as contas.');return false;}
 }});
 return Object.freeze({
  async loadFile(text){
   if(attempted||role!=='operator'||!['READY','FAILED'].includes(phase))return false;
   epoch++;erase();const e=epoch;emit('LOADING','Conferindo o escopo do arquivo…');
   try{const v=await validateIssueApproval(text,now());if(e!==epoch)return false;record=v.record;
    emit('READY','Aprovação com escopo correto. O servidor ainda verificará assinatura, registro e reserva única.');return true;
   }catch{if(e===epoch)stop('Arquivo inválido, vencido ou fora do escopo autorizado.');return false;}
  },
  start(termsConfirmed=false){
   if(attempted||!['READY','FAILED'].includes(phase)||termsConfirmed!==true)return false;
   if(role==='operator'&&(!record||record.expiresAtMs<=now()))return false;
   if(role!=='operator'&&role!=='buyer')return false;
   epoch++;const e=epoch;expiry=now()+120000;
   if(role==='buyer'){
    if(!buyerLink||!deadline(buyerLink.expiresAtMs,now())){stop('Link ausente ou expirado.');return false;}
    scope={...buyerLink};expiry=scope.expiresAtMs;arm(e);emit('BUYER_LOGIN','Confirme tonysacramento@gmail.com nesta página do comprador.');
    try{prompt('BUYER_LOGIN',scope.buyerNonce,e);}catch{stop('Login Google indisponível.');}
   }else{
    expiry=Math.min(expiry,record.expiresAtMs);arm(e);emit('ENTRY','Entre com escudofit.revisao@gmail.com para iniciar a emissão.');
    try{prompt('ENTRY',entryNonce(),e);}catch{stop('Login Google indisponível.');}
   }
   return true;
  },
  confirmOperator(){
   if(attempted||role!=='operator'||phase!=='WAITING_BUYER'||!scope)return false;
   const e=epoch;try{check(e);emit('OPERATOR_LOGIN','Após a confirmação do comprador, entre novamente com a auditoria para enviar uma única tentativa de emissão.');
    prompt('OPERATOR_LOGIN',scope.operatorNonce,e);return true;
   }catch{stop('O prazo terminou.');return false;}
  },
  reset,
  checkExpiry(){if(expiry&&expiry<=now())stop('O prazo terminou.');},
  getShare(){return role==='operator'&&phase==='WAITING_BUYER'&&scope&&expiry>now()?Object.freeze({
   approvalId:record.approvalId,challengeId:scope.challengeId,buyerNonce:scope.buyerNonce,expiresAtMs:expiry}):null;},
  getResult(){return result?Object.freeze({...result}):null;},
  snapshot(){return Object.freeze({phase,attempted,hasFile:Boolean(record),hasCredentials:Boolean(bootstrap),hasChallenge:Boolean(scope),hasResult:Boolean(result)});}
 });
}

function boot(){
 const get=id=>document.getElementById(id),slot=get('google-slot');
 const role=new URL(location.href).searchParams.get('role')==='buyer'?'buyer':'operator';
 const link=role==='buyer'?readIssueBuyerLink(location.hash):null;
 if(location.hash)history.replaceState(null,'',location.pathname+(role==='buyer'?'?role=buyer':''));
 let ready=false,fileEpoch=0;
 const labels={READY:'Preparar a emissão',LOADING:'Conferindo o arquivo',ENTRY:'Identificar a auditoria',
  WAITING_BUYER:'Confirmar no dispositivo do comprador',BUYER_LOGIN:'Identificar o comprador',
  OPERATOR_LOGIN:'Confirmar a auditoria e emitir',CHECKING:'Conferindo a conta',ISSUING:'Enviando a única tentativa',
  BUYER_CONFIRMED:'Comprador confirmado',ORDER_CREATED:'Ordem criada · pagamento pendente',
  REVIEW_REQUIRED:'Conferência necessária',OUTCOME_UNCERTAIN:'Resultado a conferir · não repetir',FAILED:'Etapa não concluída'};
 const controller=createPilotIssueController({role,buyerLink:link,onState:s=>{
  get('step-title').textContent=labels[s.phase]||'Piloto restrito';get('status').textContent=s.message;slot.replaceChildren();
  get('file-area').hidden=role==='buyer'||!['READY','FAILED'].includes(s.phase);
  get('start').hidden=!['READY','FAILED'].includes(s.phase)||s.attempted;
  get('start').disabled=!ready||!get('terms').checked||(role==='operator'&&!s.hasFile)||(role==='buyer'&&!link);
  get('terms').disabled=!['READY','FAILED'].includes(s.phase);
  get('continue').hidden=s.phase!=='WAITING_BUYER';
  get('cancel').hidden=['ORDER_CREATED','REVIEW_REQUIRED','OUTCOME_UNCERTAIN','BUYER_CONFIRMED'].includes(s.phase)||s.attempted;
  get('share-box').hidden=!s.hasShare;get('result-box').hidden=!s.hasResult;
  const share=controller.getShare();
  if(share){const u=new URL('/app/pilot-pix/issue/',location.origin);u.searchParams.set('role','buyer');
   u.hash=new URLSearchParams({a:share.approvalId,c:share.challengeId,n:share.buyerNonce,e:String(share.expiresAtMs)}).toString();get('buyer-link').value=u.href;
  }else get('buyer-link').value='';
  get('order-id').textContent=controller.getResult()?.orderId||'Sem referência confirmada';
 },renderGoogle:({role,nonce,callback})=>{
  if(!ready)throw Error('GOOGLE_UNAVAILABLE');const api=window.google.accounts.id;api.disableAutoSelect();
  api.initialize({client_id:GOOGLE_CLIENT_ID,nonce,callback,auto_select:false,button_auto_select:false,
   use_fedcm_for_button:true,ux_mode:'popup',login_hint:role==='buyer'?'tonysacramento@gmail.com':'escudofit.revisao@gmail.com'});
  api.renderButton(slot,{theme:'outline',size:'large',shape:'pill',text:'continue_with',width:Math.min(320,Math.max(200,slot.clientWidth))});
 }});
 get('role-label').textContent=role==='buyer'?'PÁGINA DO COMPRADOR':'PÁGINA DA AUDITORIA';
 get('file-area').hidden=role==='buyer';
 const syncStart=()=>{const s=controller.snapshot();get('start').disabled=!ready||!get('terms').checked||s.attempted||(role==='operator'&&!s.hasFile)||(role==='buyer'&&!link);};
 get('signed-file').addEventListener('change',async()=>{
  const file=get('signed-file').files?.[0],e=++fileEpoch;
  if(!controller.reset('')||!file||file.size>8192){get('signed-file').value='';return;}
  try{const text=await file.text();if(e!==fileEpoch)return;await controller.loadFile(text);}catch{controller.reset('Não foi possível ler o arquivo.');}
  finally{if(e===fileEpoch)get('signed-file').value='';}
 });
 get('terms').addEventListener('change',syncStart);
 get('start').addEventListener('click',()=>controller.start(get('terms').checked));
 get('continue').addEventListener('click',()=>controller.confirmOperator());
 get('cancel').addEventListener('click',()=>{fileEpoch++;get('signed-file').value='';controller.reset();});
 get('copy-link').addEventListener('click',async()=>{if(!controller.getShare())return;
  try{await navigator.clipboard.writeText(get('buyer-link').value);get('status').textContent='Link copiado. Abra na conta do comprador antes do prazo terminar.';}
  catch{get('buyer-link').focus();get('buyer-link').select();}
 });
 get('download').addEventListener('click',()=>{const value=controller.getResult();if(!value)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download='escudo-fit-resultado-piloto.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
 window.addEventListener('pagehide',()=>{fileEpoch++;controller.reset('');});
 window.addEventListener('pageshow',e=>{if(e.persisted)controller.reset('Inicie uma nova sessão.');});
 document.addEventListener('visibilitychange',()=>controller.checkExpiry());
 window.addEventListener('escudofit:accountChanged',()=>controller.reset('A conta mudou.'));
 window.addEventListener('storage',e=>{if(e.key==='escudofit_web_auth_v1')controller.reset('A conta mudou.');});
 const started=Date.now();const load=()=>{if(window.google?.accounts?.id){ready=true;syncStart();return;}
  if(Date.now()-started<10000)setTimeout(load,200);else get('status').textContent='O login Google não carregou. Reabra a página.';};load();
}
if(typeof window!=='undefined'&&typeof document!=='undefined')boot();
