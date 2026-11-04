export const PRIVATE_V2_API='https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/private-pilot-v2';
export const GOOGLE_CLIENT_ID='835029473980-22hokuuman3rpbiefs54gg1ntnqu6lc7.apps.googleusercontent.com';
// Stable intent identifiers are not credentials and must never change on retry.
export const REQUEST_KEY='e032b3fb-74de-4108-9a6f-48767faf8edf';
export const ORDER_ID='EF-4d7923e9-d058-4221-918a-502011da1fbd';
const allowed=new Set(['state','orderId','orderCreated','paymentConfirmed','premiumGranted','noticeState',
  'expiresAt','amountBRL','qrCode','qrCodeBase64','ticketUrl']);
const states=new Set(['DISABLED','APPROVAL_REQUIRED','READY_FOR_SINGLE_PURCHASE','NOT_CREATED','AWAITING_PAYMENT',
  'PREMIUM_ACTIVE','DELIVERY_PENDING','REVIEW_REQUIRED','EXPIRED','CHECK_CANONICAL_ACCESS',
  'PAYMENT_OBSERVED_AWAITING_DELIVERY','ORDER_CREATED_CHECKOUT_REVIEW_REQUIRED',
  'EXISTING_ORDER_RECONCILIATION_REQUIRED','PILOT_V2_PREDECESSOR_UNCERTAIN_NO_POST',
  'PILOT_V2_PREDECESSOR_CHANGED_NO_POST','PILOT_V2_POST_LATCH_UNCERTAIN_NO_POST',
  'PROVIDER_POST_OUTCOME_UNCERTAIN','BIND_OUTCOME_UNCERTAIN']);
export function validatePrivateV2Result(v,now=Date.now()){
  if(!v||Object.getPrototypeOf(v)!==Object.prototype||!states.has(v.state)||Object.keys(v).some(k=>!allowed.has(k))||
    typeof v.paymentConfirmed!=='boolean'||typeof v.premiumGranted!=='boolean'||
    v.orderId!==undefined&&v.orderId!==null&&v.orderId!==ORDER_ID||
    v.amountBRL!==undefined&&v.amountBRL!=='4.99'||
    v.noticeState!==undefined&&v.noticeState!==null&&!['READY','LEASED','SENT','DELIVERY_UNCERTAIN','REVIEW_REQUIRED','MISSING'].includes(v.noticeState))
    throw Error('PRIVATE_V2_RESPONSE_INVALID');
  if(v.state==='PREMIUM_ACTIVE'){
    if(v.paymentConfirmed!==true||v.premiumGranted!==true||v.orderId!==ORDER_ID||
      !Number.isFinite(Date.parse(v.expiresAt))||Date.parse(v.expiresAt)<=now||Date.parse(v.expiresAt)>now+31*86400000)
      throw Error('PRIVATE_V2_PREMIUM_NOT_CONFIRMED');
  }else if(v.paymentConfirmed!==false||v.premiumGranted!==false)throw Error('PRIVATE_V2_PREMIUM_NOT_CONFIRMED');
  if(v.qrCode!==undefined&&v.qrCode!==null){
    if(v.state!=='AWAITING_PAYMENT'||v.orderId!==ORDER_ID||v.amountBRL!=='4.99'||
      typeof v.qrCode!=='string'||v.qrCode.length<20||v.qrCode.length>8192||!v.qrCode.startsWith('000201')||
      !Number.isFinite(Date.parse(v.expiresAt))||Date.parse(v.expiresAt)<=now||Date.parse(v.expiresAt)>now+1800000||
      !(v.qrCodeBase64===null||typeof v.qrCodeBase64==='string'&&v.qrCodeBase64.length<=180000&&/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(v.qrCodeBase64)))
      throw Error('PRIVATE_V2_QR_INVALID');
  }else if(v.qrCodeBase64)throw Error('PRIVATE_V2_QR_INVALID');
  return Object.freeze({...v,ticketUrl:null});
}
const messages={APPROVAL_REQUIRED:'A compra de teste está sendo preparada. Consulte novamente quando a preparação estiver concluída.',
  READY_FOR_SINGLE_PURCHASE:'A compra está pronta. Confira os termos e gere seu único Pix de R$ 4,99.',
  AWAITING_PAYMENT:'Confira o valor e o recebedor no seu banco. Depois de pagar, acompanhe esta mesma compra.',
  PAYMENT_OBSERVED_AWAITING_DELIVERY:'Pagamento identificado. Estamos concluindo a ativação do seu acesso.',
  DELIVERY_PENDING:'Pagamento identificado. Estamos concluindo a ativação do seu acesso.',
  PREMIUM_ACTIVE:'Seu Premium está ativo. Use a mesma Conta Google na Web e no Android.',
  EXPIRED:'Este Pix expirou. A mesma compra precisa ser conferida antes de qualquer nova tentativa.',
  REVIEW_REQUIRED:'Esta compra precisa ser conferida. Não faça outro pagamento.',
  DISABLED:'Esta compra de teste ainda não está disponível.'};
export function createPrivateV2Controller({fetchImpl=fetch,now=Date.now,onState=()=>{},schedule=setTimeout,cancel=clearTimeout}={}){
  let credential=null,loginAt=0,epoch=0,phase='SIGNED_OUT',attempted=false,hasOrder=false,pix=null,flight=null,poll=null,expiry=null,tokenExpiry=null;
  const emit=(state,message,extra={})=>{phase=state;onState(Object.freeze({phase:state,message,
    canPurchase:state==='READY_FOR_SINGLE_PURCHASE'&&!attempted,hasLogin:Boolean(credential),hasPix:Boolean(pix),...extra}));};
  const erasePix=()=>{pix=null;cancel(expiry);expiry=null;};
  const clearTimers=()=>{cancel(poll);cancel(tokenExpiry);poll=null;tokenExpiry=null;};
  const reset=()=>{epoch++;credential=null;loginAt=0;flight?.abort();flight=null;clearTimers();erasePix();
    emit('SIGNED_OUT','Confirme novamente sua Conta Google para consultar esta mesma compra.');};
  const current=()=>{if(!credential||now()-loginAt>=240000){reset();return false;}return true;};
  const receive=v=>{
    erasePix();hasOrder=Boolean(v.orderId)||hasOrder;
    if(v.qrCode){pix=v;expiry=schedule(()=>{erasePix();emit('EXPIRED',messages.EXPIRED);},Date.parse(v.expiresAt)-now());}
    const state=v.state==='AWAITING_PAYMENT'&&!pix?'CHECKING':v.state;
    emit(state,messages[v.state]||'Estamos conferindo esta mesma compra. Não faça outro pagamento.',
      {expiresAt:v.expiresAt||null,noticeState:v.noticeState||null});
  };
  async function request(action,fields={}){
    if(!current()||flight)return null;
    const e=epoch,abort=new AbortController();flight=abort;
    const timeout=schedule(()=>abort.abort(),65000);
    try{
      const r=await fetchImpl(PRIVATE_V2_API,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',
        referrerPolicy:'no-referrer',signal:abort.signal,headers:{authorization:'Bearer '+credential,'content-type':'application/json'},
        body:JSON.stringify({action,...fields})});
      if(e!==epoch)return null;
      if(r.status===401){reset();return null;}
      if(!r.ok||!r.body||!/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type')||'')||
        Number(r.headers.get('content-length')||0)>200000)throw Error('PRIVATE_V2_UNAVAILABLE');
      let size=0,chunks=[];const reader=r.body.getReader();
      try{for(;;){const q=await reader.read();if(e!==epoch)return null;if(q.done)break;
        size+=q.value.byteLength;if(size>200000)throw Error('PRIVATE_V2_RESPONSE_TOO_LARGE');chunks.push(q.value);}}
      finally{reader.cancel().catch(()=>{});}
      const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
      return e===epoch?validatePrivateV2Result(JSON.parse(new TextDecoder().decode(bytes)),now()):null;
    }catch{if(e===epoch){erasePix();emit('HELD','Não foi possível concluir a conferência. Consulte esta mesma compra; não gere outro Pix.');}return null;}
    finally{cancel(timeout);abort.abort();if(flight===abort)flight=null;}
  }
  async function refresh(){
    if(!current()||flight)return false;
    cancel(poll);erasePix();emit('CHECKING','Conferindo sua compra…');
    const v=await request(hasOrder||attempted?'status':'preflight');if(!v)return false;receive(v);
    if(['AWAITING_PAYMENT','ORDER_CREATED_CHECKOUT_REVIEW_REQUIRED','EXISTING_ORDER_RECONCILIATION_REQUIRED'].includes(v.state)){
      const qr=await request('checkout');if(qr)receive(qr);
    }
    if(credential&&(!['PREMIUM_ACTIVE','EXPIRED','REVIEW_REQUIRED','DISABLED'].includes(phase)||
      phase==='PREMIUM_ACTIVE'&&v.noticeState!=='SENT'))
      poll=schedule(()=>{void refresh();},30000);
    return true;
  }
  return Object.freeze({
    async login(response){
      reset();let token=response?.credential;try{if(response&&typeof response==='object')response.credential=undefined;}catch{}
      if(typeof token!=='string'||token.length>16384||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))return false;
      credential=token;token=null;loginAt=now();tokenExpiry=schedule(reset,240000);return refresh();
    },
    async purchase(termsAccepted){
      if(termsAccepted!==true||phase!=='READY_FOR_SINGLE_PURCHASE'||attempted||!current()||flight)return false;
      attempted=true;cancel(poll);erasePix();emit('ISSUING','Preparando seu único Pix…');
      const v=await request('issue',{requestKey:REQUEST_KEY,confirmedTermsVersion:'prepaid-v1-2026-10-16'});
      if(!v)return false;receive(v);hasOrder=Boolean(v.orderId)||hasOrder;return refresh();
    },
    refresh,reset,
    getPix(){if(!credential||!current())return null;if(pix&&Date.parse(pix.expiresAt)<=now()){
      erasePix();emit('EXPIRED',messages.EXPIRED);return null;}return pix?Object.freeze({...pix}):null;},
    snapshot(){return Object.freeze({phase,attempted,hasOrder,hasLogin:Boolean(credential),hasPix:Boolean(pix)});}
  });
}
function boot(){
  const el=id=>document.getElementById(id),slot=el('google-slot');let ready=false;
  const c=createPrivateV2Controller({onState:s=>{
    el('status').textContent=s.message;el('terms-box').hidden=!s.canPurchase;el('purchase').hidden=!s.canPurchase;
    el('purchase').disabled=!s.canPurchase||!el('terms').checked;el('refresh').hidden=!s.hasLogin;
    el('refresh').disabled=['CHECKING','ISSUING'].includes(s.phase);el('clear').hidden=!s.hasLogin;
    el('login').hidden=s.hasLogin;el('pix-box').hidden=!s.hasPix;el('open-app').hidden=s.phase!=='PREMIUM_ACTIVE';
    el('step-title').textContent=s.phase==='PREMIUM_ACTIVE'?'Seu Premium está ativo':s.hasPix?'Seu Pix de R$ 4,99':
      s.phase==='SIGNED_OUT'?'Entre para continuar':'Acompanhe sua compra';
    const pix=c.getPix();el('pix-code').value=pix?.qrCode||'';
    if(pix?.qrCodeBase64){el('qr').src='data:image/png;base64,'+pix.qrCodeBase64;el('qr').hidden=false;}
    else{el('qr').removeAttribute('src');el('qr').hidden=true;}
    el('expiry').textContent=pix?'Válido até '+new Date(pix.expiresAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília).':'';
    el('validity').hidden=s.phase!=='PREMIUM_ACTIVE';el('validity').textContent=s.expiresAt&&s.phase==='PREMIUM_ACTIVE'?
      'Validade: '+new Date(s.expiresAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília).':'';
    el('notice').textContent=s.phase==='PREMIUM_ACTIVE'?(s.noticeState==='SENT'?'Confirmação enviada por e-mail.':
      'Seu acesso está ativo. A confirmação por e-mail está sendo conferida.'):'';
    if(s.phase==='SIGNED_OUT')slot.replaceChildren();
  }});
  el('terms').addEventListener('change',()=>{el('purchase').disabled=!el('terms').checked||c.snapshot().phase!=='READY_FOR_SINGLE_PURCHASE';});
  el('purchase').addEventListener('click',()=>{void c.purchase(el('terms').checked);});
  el('refresh').addEventListener('click',()=>{void c.refresh();});el('clear').addEventListener('click',()=>c.reset());
  el('copy').addEventListener('click',async()=>{const p=c.getPix();if(!p)return;try{await navigator.clipboard.writeText(p.qrCode);
    el('status').textContent='Código copiado. O pagamento é feito por você, no seu banco.';}catch{el('pix-code').focus();el('pix-code').select();}});
  el('login').addEventListener('click',()=>{
    if(!ready)return;c.reset();const g=window.google.accounts.id;g.disableAutoSelect();
    g.initialize({client_id:GOOGLE_CLIENT_ID,auto_select:false,button_auto_select:false,use_fedcm_for_button:true,
      ux_mode:'popup',callback:r=>{slot.replaceChildren();void c.login(r);}});
    g.renderButton(slot,{theme:'outline',size:'large',shape:'pill',text:'continue_with',width:Math.min(320,Math.max(200,slot.clientWidth))});
  });
  window.addEventListener('pagehide',()=>c.reset());window.addEventListener('pageshow',e=>{if(e.persisted)c.reset();});
  window.addEventListener('escudofit:accountChanged',()=>c.reset());
  window.addEventListener('storage',e=>{if(e.key==='escudofit_web_auth_v1')c.reset();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&c.snapshot().hasLogin)void c.refresh();});
  const started=Date.now(),load=()=>{if(window.google?.accounts?.id){ready=true;el('login').disabled=false;return;}
    if(Date.now()-started<10000)setTimeout(load,200);else el('status').textContent='O login Google não carregou. Reabra a página.';};load();
}
if(typeof window!=='undefined'&&typeof document!=='undefined')boot();
