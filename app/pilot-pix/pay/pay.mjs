export const BUYER_CHECKOUT_API='https://pilot-pay---escudo-fit-api-v38-olb3tmj35q-uc.a.run.app/api/v38/pilot-pix/buyer-checkout';
export const GOOGLE_CLIENT_ID='835029473980-22hokuuman3rpbiefs54gg1ntnqu6lc7.apps.googleusercontent.com';
const order=/^EF-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function readPaymentOrder(hash){
 const p=new URLSearchParams(String(hash).replace(/^#/,''));
 return [...p.keys()].length===1&&p.has('o')&&order.test(p.get('o')||'')?p.get('o'):null;
}
export function validatePilotPix(v,orderId,now=Date.now()){
 if(v?.paymentConfirmed!==false||v?.premiumGranted!==false)throw Error('INVALID_PIX');
 if(['EXPIRED','REVIEW_REQUIRED'].includes(v.state)&&exact(v,['state','qrCode','qrCodeBase64','ticketUrl','paymentConfirmed','premiumGranted'])&&
  v.qrCode===null&&v.qrCodeBase64===null&&v.ticketUrl===null)return Object.freeze({...v});
 if(!exact(v,['state','orderId','amountBRL','expiresAt','qrCode','qrCodeBase64','ticketUrl','paymentConfirmed','premiumGranted'])||
  v.state!=='AWAITING_PAYMENT'||v.orderId!==orderId||v.amountBRL!=='4.99'||typeof v.qrCode!=='string'||
  v.qrCode.length<20||v.qrCode.length>8192||!/^000201/.test(v.qrCode)||
  typeof v.expiresAt!=='string'||!Number.isFinite(Date.parse(v.expiresAt))||
  Date.parse(v.expiresAt)<=now||Date.parse(v.expiresAt)>now+1800000||
  !(v.qrCodeBase64===null||typeof v.qrCodeBase64==='string'&&v.qrCodeBase64.length<=180000&&/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(v.qrCodeBase64))||
  !(v.ticketUrl===null||typeof v.ticketUrl==='string'&&v.ticketUrl.length<=2048))throw Error('INVALID_PIX');
 // No payment URL is rendered or opened by this client.
 return Object.freeze({...v,ticketUrl:null});
}
const nonce=()=>{const b=new Uint8Array(32);crypto.getRandomValues(b);return 'ef-pilot-checkout-v1-'+btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
export function createPilotPaymentController({orderId,fetchImpl=fetch,now=Date.now,renderGoogle,onState=()=>{},schedule=setTimeout,cancel=clearTimeout,entryNonce=nonce}={}){
 let phase='READY',epoch=0,pix=null,timer=null,flight=null;
 const emit=(p,message)=>{phase=p;onState(Object.freeze({phase:p,message,hasPix:Boolean(pix&&pix.state==='AWAITING_PAYMENT')}));};
 const erase=()=>{pix=null;cancel(timer);timer=null;flight?.abort();flight=null;};
 const reset=message=>{epoch++;erase();emit('READY',message||'Confirme novamente a conta do comprador.');};
 const fail=e=>{if(e===epoch){epoch++;erase();emit('FAILED','Não foi possível consultar um Pix válido. A ordem e o provedor precisam ser conferidos.');}};
 return Object.freeze({
  start(){
   if(!order.test(orderId||'')||!['READY','FAILED'].includes(phase))return false;
   epoch++;erase();const e=epoch;emit('GOOGLE','Confirme tonysacramento@gmail.com para consultar sua ordem.');
   try{renderGoogle({nonce:entryNonce(),callback:async response=>{
    let credential=response?.credential;try{if(response&&typeof response==='object')response.credential=undefined;}catch{}
    if(e!==epoch||phase!=='GOOGLE'){credential=null;return false;}
    let timeout;const abort=new AbortController();
    try{
     if(typeof credential!=='string'||credential.length>16384||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(credential))throw Error();
     emit('CHECKING','Consultando a ordem e o provedor…');flight=abort;timeout=schedule(()=>abort.abort(),14000);
     const r=await fetchImpl(BUYER_CHECKOUT_API,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:abort.signal,
      headers:{authorization:'Bearer '+credential,'content-type':'application/json'},body:JSON.stringify({orderId})});credential=null;
     if(e!==epoch)throw Error();
     if(!r.ok||!r.body||!/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type')||'')||Number(r.headers.get('content-length')||0)>200000)throw Error();
     const reader=r.body.getReader(),chunks=[];let size=0;
     try{for(;;){const q=await reader.read();if(e!==epoch)throw Error();if(q.done)break;size+=q.value.byteLength;if(size>200000)throw Error();chunks.push(q.value);}}
     finally{reader.cancel().catch(()=>{});}
     const bytes=new Uint8Array(size);let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.byteLength;}
     const checked=validatePilotPix(JSON.parse(new TextDecoder().decode(bytes)),orderId,now());if(e!==epoch)throw Error();pix=checked;
     if(checked.state==='AWAITING_PAYMENT'){
      timer=schedule(()=>{if(e===epoch){epoch++;erase();emit('EXPIRED','O Pix expirou. A conferência deve consultar a mesma ordem, sem criar outra cobrança.');}},Date.parse(checked.expiresAt)-now());
      emit('AWAITING_PAYMENT','Pix consultado. Confira o valor e o recebedor no seu banco e faça o pagamento manual.');
     }else{erase();emit(checked.state,checked.state==='EXPIRED'?'O Pix expirou. Consulte a mesma ordem.':'Esta ordem exige conferência antes de pagar.');}
     return true;
    }catch{credential=null;fail(e);return false;}
    finally{credential=null;cancel(timeout);abort.abort();if(flight===abort)flight=null;}
   }});}catch{fail(e);}
   return true;
  },
  reset,
  checkExpiry(){if(pix?.state==='AWAITING_PAYMENT'&&Date.parse(pix.expiresAt)<=now()){epoch++;erase();emit('EXPIRED','O Pix expirou. Consulte a mesma ordem.');}},
  getPix(){return phase==='AWAITING_PAYMENT'&&pix&&Date.parse(pix.expiresAt)>now()?Object.freeze({...pix}):null;},
  snapshot(){return Object.freeze({phase,hasPix:Boolean(pix),hasOrder:order.test(orderId||'')});}
 });
}
function boot(){
 const get=id=>document.getElementById(id),orderId=readPaymentOrder(location.hash),slot=get('google-slot');let ready=false;
 if(location.hash)history.replaceState(null,'',location.pathname);
 const labels={READY:'Consultar seu Pix',GOOGLE:'Conta do comprador',CHECKING:'Consultando o Pix',AWAITING_PAYMENT:'Pix pronto para pagamento manual',EXPIRED:'Pix expirado',REVIEW_REQUIRED:'Conferência necessária',FAILED:'Consulta não concluída'};
 const controller=createPilotPaymentController({orderId,onState:s=>{
  get('step-title').textContent=labels[s.phase];get('status').textContent=s.message;slot.replaceChildren();
  get('start').hidden=!['READY','FAILED'].includes(s.phase);get('start').disabled=!ready||!orderId;
  get('clear').hidden=['READY','FAILED'].includes(s.phase);get('pix-box').hidden=!s.hasPix;
  const pix=controller.getPix();get('pix-code').value=pix?.qrCode||'';
  if(pix?.qrCodeBase64){get('qr').src='data:image/png;base64,'+pix.qrCodeBase64;get('qr').hidden=false;}else{get('qr').removeAttribute('src');get('qr').hidden=true;}
  get('expiry').textContent=pix?'Válido até '+new Date(pix.expiresAt).toLocaleString('pt-BR'):'';
 },renderGoogle:({nonce,callback})=>{
  if(!ready)throw Error();const api=window.google.accounts.id;api.disableAutoSelect();api.initialize({client_id:GOOGLE_CLIENT_ID,nonce,callback,
   login_hint:'tonysacramento@gmail.com',auto_select:false,button_auto_select:false,use_fedcm_for_button:true,ux_mode:'popup'});
  api.renderButton(slot,{theme:'outline',size:'large',shape:'pill',text:'continue_with',width:Math.min(320,Math.max(200,slot.clientWidth))});
 }});
 get('order-id').textContent=orderId||'Link da ordem ausente';get('start').addEventListener('click',()=>controller.start());get('clear').addEventListener('click',()=>controller.reset());
 get('copy').addEventListener('click',async()=>{const v=controller.getPix();if(!v)return;
  try{await navigator.clipboard.writeText(v.qrCode);get('status').textContent='Código Pix copiado. O pagamento é feito manualmente no seu banco.';}
  catch{get('pix-code').focus();get('pix-code').select();}
 });
 window.addEventListener('pagehide',()=>controller.reset(''));window.addEventListener('pageshow',e=>{if(e.persisted)controller.reset();});
 window.addEventListener('escudofit:accountChanged',()=>controller.reset());window.addEventListener('storage',e=>{if(e.key==='escudofit_web_auth_v1')controller.reset();});
 document.addEventListener('visibilitychange',()=>controller.checkExpiry());
 const begun=Date.now();const load=()=>{if(window.google?.accounts?.id){ready=true;get('start').disabled=!orderId;return;}
  if(Date.now()-begun<10000)setTimeout(load,200);else get('status').textContent='O login Google não carregou. Reabra a página.';};load();
}
if(typeof window!=='undefined'&&typeof document!=='undefined')boot();
