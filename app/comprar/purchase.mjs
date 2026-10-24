// Escudo Fit — buyer-initiated commercial Pix checkout.
// The browser NEVER signs a pilot approval, repeats a financial POST, validates
// payment settlement, grants Premium, or modifies Firestore.
export const PURCHASE_API='https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38';
export const PURCHASE_CLIENT_ID='835029473980-22hokuuman3rpbiefs54gg1ntnqu6lc7.apps.googleusercontent.com';
export const TERMS='prepaid-v1-2026-10-16';
const PATH=PURCHASE_API+'/payments/commercial';
const EF=/^EF-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const STATES=new Set(['PREPARING','AWAITING_PAYMENT','RECONCILING','COMMITTED','REVIEW_REQUIRED']);
const PROVIDER=new Set(['PROVIDER_ID_NOT_BOUND_REVIEW_REQUIRED','REVIEW_REQUIRED',
  'EXPIRED_RECONCILIATION_REQUIRED','PAID_PROVIDER_VERIFIED_DELIVERY_PENDING','AWAITING_PAYMENT']);
const noFinancialGrant=v=>v?.premiumActivated===false;
const copy=v=>Object.freeze({...v});

export function inspectPurchaseHealth(value){
  if(!value||typeof value!=='object'||value.automaticRenewal!==false||
    value.termsVersion!==TERMS||
    typeof value.sitePurchaseEnabled!=='boolean'||
    typeof value.buyerReconciliationReadEnabled!=='boolean'||
    value.plans?.monthly?.amount!=='4.99')throw Error('INVALID_HEALTH');
  return Object.freeze({sitePurchaseEnabled:value.sitePurchaseEnabled,
    buyerReconciliationReadEnabled:value.buyerReconciliationReadEnabled});
}
export function inspectPurchaseOrder(value,now=Date.now()){
  if(!value||!EF.test(value.orderId||'')||value.planKey!=='monthly'||
    value.amountBRL!=='4.99'||value.currency!=='BRL'||!STATES.has(value.status)||
    !noFinancialGrant(value)||!/^\d{4}-\d{2}-\d{2}T/.test(value.checkoutExpiresAt||'')||
    !Number.isFinite(Date.parse(value.checkoutExpiresAt)))
    throw Error('INVALID_ORDER');
  const payable=value.status==='AWAITING_PAYMENT'&&Date.parse(value.checkoutExpiresAt)>now;
  const qr=value.qrCode;
  if(qr!=null&&(typeof qr!=='string'||!/^000201/.test(qr)||qr.length>8192))throw Error('INVALID_QR');
  // A QR is a payment instruction, not an entitlement. Never show it once
  // expired; never expose a ticket URL or accept provider-side HTML.
  return Object.freeze({
    orderId:value.orderId,status:value.status,checkoutExpiresAt:value.checkoutExpiresAt,
    qrCode:payable&&typeof qr==='string'?qr:null,
    requestKey:UUID.test(value.requestKey||'')?value.requestKey:null,
  });
}
export function inspectPurchaseReconciliation(value,expectedOrder){
  if(!value||value.orderId!==expectedOrder||
    !PROVIDER.has(value.providerState)||
    !['RESERVED','PENDING','PAID_VERIFIED','COMMITTED','REVIEW_REQUIRED'].includes(value.canonicalStatus)||
    value.method!=='AUTHENTICATED_GET_ONLY'||value.reconciliationWritten!==false||
    value.premiumActivated!==false)throw Error('INVALID_RECONCILIATION');
  return Object.freeze({providerState:value.providerState,
    canonicalStatus:value.canonicalStatus});
}
const messageForOrder=s=>({
  PREPARING:'Ordem reservada ou em verificação. Não repita a compra.',
  AWAITING_PAYMENT:'Pix gerado. Confirme os dados no banco antes de pagar.',
  RECONCILING:'Pagamento sob conciliação. Nenhum acesso é liberado pelo navegador.',
  COMMITTED:'O registro da operação foi concluído. Consulte seu acesso no aplicativo.',
  REVIEW_REQUIRED:'Ordem retida para revisão. Não emita outro Pix.',
})[s]||'Acompanhe o estado da ordem.';
const messageForProvider=s=>({
  PROVIDER_ID_NOT_BOUND_REVIEW_REQUIRED:'Identificador do Mercado Pago ainda não confirmado. Revisão necessária.',
  EXPIRED_RECONCILIATION_REQUIRED:'O Mercado Pago mostra expiração. Ainda é necessária a reconciliação do Firestore.',
  PAID_PROVIDER_VERIFIED_DELIVERY_PENDING:'Pagamento observado na API. A concessão Premium depende da conciliação canônica.',
  AWAITING_PAYMENT:'Mercado Pago informa que aguarda o Pix.',
  REVIEW_REQUIRED:'Os dados do provedor requerem revisão independente.',
})[s]||'Consulta concluída.';

async function requestJson(fetchImpl,url,{method='GET',accessToken=null,body=null}={}){
  const headers={'accept':'application/json'};
  if(accessToken)headers.authorization='Bearer '+accessToken;
  if(body!=null)headers['content-type']='application/json';
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try {
    const res=await fetchImpl(url,{method,mode:'cors',credentials:'omit',cache:'no-store',
      referrerPolicy:'no-referrer',redirect:'error',signal:controller.signal,
      headers,...(body!=null?{body:JSON.stringify(body)}:{})});
    const type=res.headers?.get('content-type')||'';
    if(!/application\/json/i.test(type))throw Error('API_RESPONSE_INVALID');
    // Strict response-size limit, including untrusted upstream bodies.
    const reader=res.body?.getReader?.();
    if(!reader)throw Error('API_RESPONSE_INVALID');
    const parts=[];let len=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;
      len+=value.byteLength;if(len>12288)throw Error('API_RESPONSE_INVALID');
      parts.push(value);
    }}finally{reader.cancel().catch(()=>{});reader.releaseLock();}
    const bytes=new Uint8Array(len);let at=0;
    for(const b of parts){bytes.set(b,at);at+=b.byteLength;}
    const data=JSON.parse(new TextDecoder().decode(bytes));
    if(!res.ok)throw Error('API_HTTP_'+res.status);
    return data;
  }finally{clearTimeout(timeout);}
}

/** No local/session storage, no automatic financial POST, no silent retry. */
export function createPurchaseController({fetchImpl=fetch,now=Date.now,
  newKey=()=>crypto.randomUUID(),onState=()=>{}}={}){
  let token=null,userEmail='',order=null,health=null,provider=null;
  let phase='READY',attempted=false,busy=false,epoch=0,qrExpiryEmitted=false;
  const snapshot=()=>Object.freeze({
    phase,account:userEmail,order:order?copy(order):null,provider:provider?copy(provider):null,
    signedIn:Boolean(token),canBuy:Boolean(token&&health?.sitePurchaseEnabled&&
      health?.buyerReconciliationReadEnabled&&!order&&!attempted&&!busy),
    canRead:Boolean(token&&health?.buyerReconciliationReadEnabled&&order&&!busy),
    canRefresh:Boolean(token&&health?.buyerReconciliationReadEnabled&&!busy),
    attempted,busy
  });
  const emit=(next,message)=>{phase=next;onState(snapshot(),message);};
  const signout=()=>{epoch++;token=null;userEmail='';order=null;provider=null;
    health=null;attempted=false;busy=false;qrExpiryEmitted=false;
    emit('READY','Sessão encerrada.');};
  const active=e=>{if(e!==epoch||!token)throw Error('SESSION_CLOSED');};
  return Object.freeze({
    snapshot,
    signout,
    async signIn(googleToken){
      if(busy||token||typeof googleToken!=='string'||googleToken.length>16384||!JWT.test(googleToken))
        return false;
      const e=++epoch;busy=true;emit('SIGNING_IN','Verificando a conta Google.');
      try{
        const login=await requestJson(fetchImpl,PURCHASE_API+'/auth/google',{
          method:'POST',body:{id_token:googleToken}});
        if(e!==epoch||!JWT.test(login.access_token||'')||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login.user?.email||''))
          throw Error('INVALID_LOGIN');
        token=login.access_token;userEmail=login.user.email;
        const state=inspectPurchaseHealth(await requestJson(fetchImpl,PATH+'/health'));
        active(e);health=state;
        // Existing order MUST be loaded before any buyer-facing POST.
        if(state.buyerReconciliationReadEnabled){
          const current=await requestJson(fetchImpl,PATH+'/orders/current',{accessToken:token});
          active(e);
          if(current?.order)order=inspectPurchaseOrder(current.order,now());
        }
        busy=false;
        if(order){emit('ORDER_EXISTS',messageForOrder(order.status));return true;}
        if(state.sitePurchaseEnabled&&state.buyerReconciliationReadEnabled){
          emit('READY_TO_BUY','Conta verificada. Nenhuma ordem pendente encontrada.');
          return true;
        }
        emit('CHECKOUT_CLOSED','Checkout não liberado pelo servidor. Nenhuma cobrança será criada.');
        return true;
      }catch {
        if(e===epoch){token=null;userEmail='';health=null;order=null;busy=false;
          emit('ERROR','Não foi possível validar sua conta e consultar a situação do checkout.');}
        return false;
      }
    },
    async buy(acceptedTerms=false){
      if(!token||!health?.sitePurchaseEnabled||!health?.buyerReconciliationReadEnabled||
        order||busy||attempted||acceptedTerms!==true)return false;
      const e=epoch;attempted=true;busy=true;
      emit('CREATING','Enviando uma única tentativa de compra. Não atualize ou repita a solicitação.');
      try{
        const result=await requestJson(fetchImpl,PATH+'/orders',{method:'POST',accessToken:token,
          body:{planKey:'monthly',channel:'WEB_OFFICIAL_DIRECT',
            acceptedTermsVersion:TERMS,requestKey:newKey()}});
        active(e);
        order=inspectPurchaseOrder(result,now());
        qrExpiryEmitted=false;busy=false;
        emit('ORDER_EXISTS',messageForOrder(order.status));
        return true;
      }catch{
        if(e===epoch){busy=false;emit('OUTCOME_UNCERTAIN',
          'A criação pode ter sido registrada. Não repita o Pix; consulte a ordem existente pela API.');}
        return false;
      }
    },
    async refresh(){
      if(!token||!health?.buyerReconciliationReadEnabled||busy)return false;
      const e=epoch;busy=true;emit('READING','Consultando o estado canônico e o Mercado Pago.');
      try{
        let target=order;
        if(!target){
          const current=await requestJson(fetchImpl,PATH+'/orders/current',{accessToken:token});
          active(e);
          if(current?.order)target=inspectPurchaseOrder(current.order,now());
        }
        if(!target){busy=false;emit('NO_ORDER','Não existe ordem pendente vinculada à conta.');return true;}
        const [canonical,reconciliation]=await Promise.all([
          requestJson(fetchImpl,PATH+'/orders/'+target.orderId,{accessToken:token}),
          requestJson(fetchImpl,PATH+'/orders/'+target.orderId+'/reconciliation',{accessToken:token})
        ]);
        active(e);
        order=inspectPurchaseOrder(canonical,now());
        provider=inspectPurchaseReconciliation(reconciliation,order.orderId);
        busy=false;emit('ORDER_EXISTS',messageForProvider(provider.providerState));return true;
      }catch{
        if(e===epoch){busy=false;emit('READ_ERROR',
          'A API não confirmou o estado nesta consulta. Nenhuma nova compra foi iniciada.');}
        return false;
      }
    },
    getPix(){return order?.qrCode&&Date.parse(order.checkoutExpiresAt)>now()?
      order.qrCode:null;},
    checkExpiry(){
      if(order?.qrCode&&order.status==='AWAITING_PAYMENT'&&
        Date.parse(order.checkoutExpiresAt)<=now()&&!qrExpiryEmitted){
        qrExpiryEmitted=true;
        emit('PIX_WINDOW_EXPIRED','O prazo do QR Code terminou. Consulte o Mercado Pago pela API; não repita a emissão.');
      }
    },
  });
}
function boot(){
  const el=id=>document.getElementById(id);
  const googleSlot=el('google-slot'),start=el('buy'),refresh=el('refresh'),
    consent=el('terms');
  let sdkReady=false;
  const controller=createPurchaseController({
    onState:(s,message)=>{
      el('account').textContent=s.account?'Conta conectada: '+s.account:'Aguardando login.';
      el('disconnect').hidden=!s.signedIn;
      el('availability').textContent=message||'Verificando a disponibilidade do checkout.';
      el('status').textContent=message||'Acompanhe sua ordem.';
      consent.disabled=!s.canBuy;
      start.disabled=!s.canBuy||!consent.checked;
      refresh.disabled=!s.canRefresh;
      el('order-panel').hidden=!s.order;
      if(s.order){
        el('order-ref').textContent=s.order.orderId;
        el('canonical').textContent=s.order.status;
        el('provider').textContent=s.provider?.providerState||'Ainda não consultado';
        el('expiry').textContent=new Date(s.order.checkoutExpiresAt).toLocaleString('pt-BR');
      }else{
        el('order-ref').textContent='';el('canonical').textContent='—';
        el('provider').textContent='—';el('expiry').textContent='—';
      }
      const pix=controller.getPix();
      el('pix-panel').hidden=!pix;
      el('pix-code').value=pix||'';
      if(s.attempted){start.disabled=true;consent.disabled=true;}
    }
  });
  consent.addEventListener('change',()=>{const s=controller.snapshot();
    start.disabled=!s.canBuy||!consent.checked;});
  start.addEventListener('click',()=>controller.buy(consent.checked));
  refresh.addEventListener('click',()=>controller.refresh());
  el('disconnect').addEventListener('click',()=>{controller.signout();consent.checked=false;
    googleSlot.replaceChildren();renderGoogle();});
  el('copy').addEventListener('click',async()=>{const pix=controller.getPix();
    if(!pix)return;try{await navigator.clipboard.writeText(pix);
      el('status').textContent='Código Pix copiado. Confira o recebedor no seu banco.';}
    catch{el('pix-code').focus();el('pix-code').select();}
  });
  const renderGoogle=()=>{
    if(!sdkReady)return;
    const api=window.google.accounts.id;
    api.disableAutoSelect();
    api.initialize({client_id:PURCHASE_CLIENT_ID,callback:async response=>{
      let credential=response?.credential;
      try{if(response)response.credential=undefined;}catch{}
      if(!credential)return;await controller.signIn(credential);credential=null;
    },auto_select:false,button_auto_select:false,use_fedcm_for_button:true,ux_mode:'popup'});
    api.renderButton(googleSlot,{theme:'outline',size:'large',shape:'pill',
      text:'continue_with',width:Math.min(320,Math.max(200,googleSlot.clientWidth))});
  };
  const loaded=Date.now();
  const tryGoogle=()=>{
    if(window.google?.accounts?.id){sdkReady=true;renderGoogle();}
    else if(Date.now()-loaded<10000)setTimeout(tryGoogle,200);
    else el('availability').textContent='Login Google indisponível neste navegador.';
  };
  const expiryPoll=setInterval(()=>controller.checkExpiry(),15000);
  window.addEventListener('visibilitychange',()=>{if(!document.hidden)controller.checkExpiry();});
  window.addEventListener('pagehide',()=>{clearInterval(expiryPoll);controller.signout();});
  tryGoogle();
}
if(typeof window!=='undefined'&&typeof document!=='undefined')boot();
