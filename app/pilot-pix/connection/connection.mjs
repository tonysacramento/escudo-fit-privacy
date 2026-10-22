export const CONNECTION_API='https://h3bobserve---escudo-fit-pilot-h3b-gateway-olb3tmj35q-uc.a.run.app/api/v38/pilot-pix/gateway';
export const CONNECTION_CLIENT_ID='835029473980-22hokuuman3rpbiefs54gg1ntnqu6lc7.apps.googleusercontent.com';
const INTENT='escudo-fit-first-live-pilot-v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const keys=['state','purpose','challengeId','buyerNonce','operatorNonce','expiresAtMs',
 'financialGo','orderCreated','paymentConfirmed','premiumGranted'];
export function validateConnectionChallenge(value,now=Date.now()){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||
  !keys.every(k=>Object.hasOwn(value,k))||value.state!=='CHALLENGE'||
  value.purpose!=='ESCUDO_FIT_FIRST_LIVE_ISSUE_OPERATOR_V1'||
  !/^[A-Za-z0-9_-]{43}$/.test(value.challengeId||'')||
  !/^ef-issue-buyer-v1-[A-Za-z0-9_-]{43}$/.test(value.buyerNonce||'')||
  !/^ef-issue-operator-v1-[A-Za-z0-9_-]{43}$/.test(value.operatorNonce||'')||
  !Number.isSafeInteger(value.expiresAtMs)||value.expiresAtMs<=now||value.expiresAtMs>now+120000||
  !['financialGo','orderCreated','paymentConfirmed','premiumGranted'].every(k=>value[k]===false))
  throw Error('CONNECTION_RESPONSE_REJECTED');
 return true;
}
const entryNonce=()=>{
 const b=new Uint8Array(32);crypto.getRandomValues(b);
 return 'ef-issue-entry-v1-'+btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
export function createConnectionCheck({fetchImpl=fetch,renderGoogle,onState=()=>{},now=Date.now,
 newId=()=>crypto.randomUUID(),nonce=entryNonce,schedule=setTimeout,cancel=clearTimeout}={}){
 let phase='READY',epoch=0,used=false,flight=null,expiry=0,timer=null;
 const emit=(next,code='')=>{phase=next;onState(Object.freeze({phase,code}));};
 const erase=()=>{cancel(timer);timer=null;flight?.abort();flight=null;expiry=0;};
 const fresh=e=>{if(e!==epoch||now()>=expiry)throw Error('CONNECTION_SESSION_EXPIRED');};
 return Object.freeze({
  start(){
   if(phase!=='READY')return false;
   const approvalId=newId();
   if(!UUID.test(approvalId))return false;
   const e=++epoch;expiry=now()+120000;
   timer=schedule(()=>{if(e===epoch){epoch++;erase();emit('FAILED','CONNECTION_SESSION_EXPIRED');}},120000);
   emit('LOGIN');
   try{renderGoogle({nonce:nonce(),callback:async response=>{
    let credential=response?.credential;
    try{if(response&&typeof response==='object')response.credential=undefined;}catch{}
    if(e!==epoch||phase!=='LOGIN'||used){credential=null;return false;}
    used=true;let limit=null;
    try{
     fresh(e);
     if(typeof credential!=='string'||credential.length>16384||!JWT.test(credential))
      throw Error('CONNECTION_CREDENTIAL_REJECTED');
     emit('CHECKING');const abort=new AbortController();flight=abort;
     limit=schedule(()=>abort.abort(),22000);
     // CHALLENGE is the only action in this module. The random UUID is a
     // diagnostic correlation scope, not an approval or issuance authority.
     const response=await fetchImpl(CONNECTION_API,{
      method:'POST',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',
      referrerPolicy:'no-referrer',signal:abort.signal,
      headers:{authorization:'Bearer '+credential,'content-type':'application/json',
       'x-escudo-pilot-intent':INTENT},
      body:JSON.stringify({action:'CHALLENGE',approvalId})
     });
     credential=null;fresh(e);
     if(!response.ok)throw Error('HTTP_'+([400,401,403,409,413,415,429,500,502,503,504].includes(response.status)?response.status:'REJECTED'));
     if(!response.body||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))
      throw Error('CONNECTION_RESPONSE_REJECTED');
     const reader=response.body.getReader(),chunks=[];let size=0;
     try{
      for(;;){const r=await reader.read();fresh(e);if(r.done)break;
       size+=r.value.byteLength;if(size>4096)throw Error('CONNECTION_RESPONSE_REJECTED');
       chunks.push(r.value);
      }
     }finally{reader.cancel().catch(()=>{});}
     const bytes=new Uint8Array(size);let offset=0;
     for(const b of chunks){bytes.set(b,offset);offset+=b.byteLength;}
     const value=JSON.parse(new TextDecoder().decode(bytes));
     validateConnectionChallenge(value,now());fresh(e);
     erase();emit('PASSED','CONNECTION_CONFIRMED_NO_ISSUANCE');return true;
    }catch(error){
     if(e===epoch){
      const code=/^(?:HTTP_(?:400|401|403|409|413|415|429|500|502|503|504|REJECTED)|CONNECTION_(?:SESSION_EXPIRED|CREDENTIAL_REJECTED|RESPONSE_REJECTED))$/.test(error?.message||'')?
       error.message:'CONNECTION_UNAVAILABLE';
      erase();emit('FAILED',code);
     }return false;
    }finally{credential=null;cancel(limit);if(e===epoch)erase();}
   }});}catch{erase();emit('FAILED','CONNECTION_UNAVAILABLE');}
   return true;
  },
  cancel(){epoch++;erase();emit('CANCELLED','CONNECTION_CANCELLED');},
  snapshot(){return Object.freeze({phase,used});}
 });
}
function boot(){
 const get=id=>document.getElementById(id),slot=get('google-slot');
 let ready=false;
 const descriptions={
  LOGIN:'Selecione escudofit.revisao@gmail.com no botão Google.',
  CHECKING:'Conferindo a conexão. Nenhum Pix será emitido.',
  PASSED:'Conexão confirmada. Nenhuma ordem criada. Aguarde a continuação pelo Work.',
  FAILED:'A conexão não foi confirmada. Informe ao Work o código mostrado abaixo.',
  CANCELLED:'Verificação encerrada. Nenhuma emissão foi solicitada.'
 };
 const controller=createConnectionCheck({
  onState:s=>{
   slot.replaceChildren();get('status').textContent=descriptions[s.phase]||'Pronto para conferir.';
   get('result-code').textContent=s.code;get('start').hidden=s.phase!=='READY';
   get('cancel').hidden=!['LOGIN','CHECKING'].includes(s.phase);
  },
  renderGoogle:({nonce,callback})=>{
   if(!ready)throw Error('GOOGLE_UNAVAILABLE');
   const api=window.google.accounts.id;api.disableAutoSelect();
   api.initialize({client_id:CONNECTION_CLIENT_ID,nonce,callback,auto_select:false,
    button_auto_select:false,use_fedcm_for_button:true,ux_mode:'popup',
    login_hint:'escudofit.revisao@gmail.com'});
   api.renderButton(slot,{theme:'outline',size:'large',shape:'pill',text:'continue_with',
    width:Math.min(320,Math.max(200,slot.clientWidth))});
  }
 });
 get('start').addEventListener('click',()=>controller.start());
 get('cancel').addEventListener('click',()=>controller.cancel());
 window.addEventListener('pagehide',()=>controller.cancel());
 window.addEventListener('escudofit:accountChanged',()=>controller.cancel());
 const started=Date.now();
 const load=()=>{
  if(window.google?.accounts?.id){ready=true;get('start').disabled=false;return;}
  if(Date.now()-started<10000)setTimeout(load,200);
  else get('status').textContent='O login Google não carregou. Reabra a página.';
 };load();
}
if(typeof window!=='undefined'&&typeof document!=='undefined')boot();
