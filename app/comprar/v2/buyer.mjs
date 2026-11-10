// Escudo Fit v44 private buyer-only Pix flow. Browser never signs, grants Premium,
// reconciles payments or calls Mercado Pago directly. All financial state is server-authoritative.
export const BUYER_API='https://v2buyer---escudo-fit-api-v38-olb3tmj35q-uc.a.run.app';
export const BUYER_CLIENT_ID='835029473980-22hokuuman3rpbiefs54gg1ntnqu6lc7.apps.googleusercontent.com';
export const BUYER_RELAY='/api/v38/private-pilot-v2';
export const BUYER_REQUEST_KEY='e032b3fb-74de-4108-9a6f-48767faf8edf';
export const BUYER_TERMS='prepaid-v1-2026-10-16';
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const EF=/^EF-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const STATES=new Set(['DISABLED','APPROVAL_REQUIRED','READY_FOR_SINGLE_PURCHASE','NOT_CREATED',
  'AWAITING_PAYMENT','PREMIUM_ACTIVE','DELIVERY_PENDING','REVIEW_REQUIRED','EXPIRED',
  'CHECK_CANONICAL_ACCESS','PAYMENT_OBSERVED_AWAITING_DELIVERY',
  'ORDER_CREATED_CHECKOUT_REVIEW_REQUIRED','EXISTING_ORDER_RECONCILIATION_REQUIRED',
  'PILOT_V2_PREDECESSOR_UNCERTAIN_NO_POST','PILOT_V2_PREDECESSOR_CHANGED_NO_POST',
  'PILOT_V2_POST_LATCH_UNCERTAIN_NO_POST','PROVIDER_POST_OUTCOME_UNCERTAIN','BIND_OUTCOME_UNCERTAIN',
  'REFUNDED','PILOT_CLOSED']);
const tokenOk=v=>typeof v==='string'&&v.length<16384&&JWT.test(v);
export function validatePrivateBuyerResult(v,now=Date.now()){
  if(!v||Object.getPrototypeOf(v)!==Object.prototype||!STATES.has(v.state)||
    typeof v.paymentConfirmed!=='boolean'||typeof v.premiumGranted!=='boolean'||
    (v.state==='PREMIUM_ACTIVE'?!v.paymentConfirmed||!v.premiumGranted:
      v.paymentConfirmed||v.premiumGranted)||
    (v.orderId!=null&&!EF.test(v.orderId))||
    (v.amountBRL!==undefined&&v.amountBRL!=='4.99'))throw Error('PRIVATE_V2_RESPONSE_INVALID');
  const hasQR=typeof v.qrCode==='string';
  if(hasQR&&(v.state!=='AWAITING_PAYMENT'||v.amountBRL!=='4.99'||
    v.qrCode.length>8192||v.qrCode.length<20||!v.qrCode.startsWith('000201')||
    !Number.isFinite(Date.parse(v.expiresAt||''))||Date.parse(v.expiresAt)<=now||
    Date.parse(v.expiresAt)>now+1800000))throw Error('PRIVATE_V2_QR_INVALID');
  if(v.qrCode!=null&&!hasQR)throw Error('PRIVATE_V2_QR_INVALID');
  if(v.noticeState!=null&&(typeof v.noticeState!=='string'||v.noticeState.length>80))
    throw Error('PRIVATE_V2_NOTICE_INVALID');
  return Object.freeze({state:v.state,orderId:v.orderId||null,amountBRL:v.amountBRL||null,
    orderCreated:v.orderCreated===true,paymentConfirmed:v.paymentConfirmed,
    premiumGranted:v.premiumGranted,canonicalCommitted:v.canonicalCommitted===true,
    noticeState:v.noticeState||null,expiresAt:v.expiresAt||null,
    qrCode:hasQR?v.qrCode:null});
}
export async function privateBuyerRequest(action,token,{fetchImpl=fetch}={}){
  if(!['preflight','issue','checkout','status'].includes(action)||!tokenOk(token))
    throw Error('PRIVATE_V2_CLIENT_REJECTED');
  const body=action==='issue'?{action,requestKey:BUYER_REQUEST_KEY,confirmedTermsVersion:BUYER_TERMS}:{action};
  const res=await fetchImpl(BUYER_API+BUYER_RELAY,{
    method:'POST',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',
    referrerPolicy:'no-referrer',signal:AbortSignal.timeout(70000),
    headers:{authorization:'Bearer '+token,accept:'application/json','content-type':'application/json'},
    body:JSON.stringify(body)
  });
  if(res.status===503)throw Error('PRIVATE_V2_RELAY_503');
  if(!res.ok||!/^application\/json(?:;|$)/i.test(res.headers?.get('content-type')||''))
    throw Error('PRIVATE_V2_API_UNAVAILABLE');
  const raw=await res.text();
  if(raw.length>200000)throw Error('PRIVATE_V2_UPSTREAM_TOO_LARGE');
  try{return JSON.parse(raw);}catch{throw Error('PRIVATE_V2_UPSTREAM_INVALID');}
}
/** A lost issue response is terminal: never send a second issue request. */
export function createPrivateBuyerController({request=privateBuyerRequest,now=Date.now,onState=()=>{}}={}){
  let token=null,busy=false,attempted=false,phase='GOOGLE_LOGIN',last=null,epoch=0;
  const snapshot=()=>Object.freeze({
    phase,busy,attempted,
    canIssue:!!token&&!busy&&!attempted&&phase==='READY_FOR_SINGLE_PURCHASE',
    canRead:!!token&&!busy,orderId:last?.orderId||null,
    serverState:last?.state||null,paymentConfirmed:last?.paymentConfirmed===true,
    premiumGranted:last?.premiumGranted===true,noticeState:last?.noticeState||null,
    expiresAt:last?.expiresAt||null
  });
  const emit=message=>onState(snapshot(),message);
  const active=at=>at===epoch&&!!token;
  const read=async action=>{
    if(!token||busy||attempted&&action==='preflight')return false;
    const current=epoch;busy=true;phase='READING';emit('Consultando o estado privado; nenhuma compra está sendo criada.');
    try{
      const result=validatePrivateBuyerResult(await request(action,token),now());
      if(!active(current))return false;
      last=result;busy=false;phase=result.state;
      emit(result.state==='READY_FOR_SINGLE_PURCHASE'?
        'Aprovação válida. É permitido solicitar um único Pix com confirmação expressa.':
        result.state==='PREMIUM_ACTIVE'?
          'Premium confirmado pelo servidor. Confira o estado do aviso automático.':
        result.state==='REFUNDED'?
          'A compra deste piloto já foi concluída e reembolsada. Um novo teste exige uma nova rodada do piloto. Nenhum Pix foi solicitado.':
        result.state==='PILOT_CLOSED'?
          'Nenhuma rodada de compra do piloto está aberta agora. Nenhum Pix foi solicitado e nada foi cobrado.':
          'Estado retornado pelo servidor: '+result.state+'. Não crie uma segunda ordem.');
      return true;
    }catch(error){
      if(active(current)){busy=false;phase='READ_UNAVAILABLE';emit(error?.message==='PRIVATE_V2_RELAY_503'?
        'A consulta da autorização falhou (HTTP 503). Aguarde e use Verificar autorização novamente. Nenhum Pix foi solicitado.':
        'Leitura indisponível. Verifique a autorização novamente. Não gere outro Pix sem consultar a ordem existente.');}
      return false;
    }
  };
  return Object.freeze({
    snapshot,
    async signIn(jwt){
      if(token||busy||!tokenOk(jwt))return false;
      token=jwt;phase='SIGNED_IN';emit('Conta Google recebida. Consultando autorização privada do P-00.');
      return read('preflight');
    },
    async preflight(){return read('preflight');},
    async checkout(){return read('checkout');},
    async status(){return read('status');},
    async issue(confirmed){
      if(confirmed!==true||!snapshot().canIssue)return false;
      const current=epoch;
      attempted=true;busy=true;phase='ISSUE_SUBMITTED';emit('Solicitação enviada uma única vez. Nunca repita o POST financeiro.');
      try{
        const result=validatePrivateBuyerResult(await request('issue',token),now());
        if(!active(current))return false;
        last=result;busy=false;phase=result.state;
        emit('O servidor respondeu '+result.state+'. Consulte o QR apenas pela leitura autenticada; não repita a emissão.');
        return true;
      }catch{
        if(active(current)){busy=false;phase='ISSUE_OUTCOME_UNCERTAIN';
          emit('Resultado da emissão incerto. Não repita o Pix; consulte o estado canônico e o Mercado Pago.');}
        return false;
      }
    },
    pix(){return last?.qrCode&&last.state==='AWAITING_PAYMENT'&&
      last.expiresAt&&Date.parse(last.expiresAt)>now()?last.qrCode:null;},
    reset(){epoch++;token=null;last=null;busy=false;phase='GOOGLE_LOGIN';
      emit('Sessão Google encerrada. O registro de tentativa de emissão permanece protegido.');},
    destroy(){epoch++;token=null;last=null;busy=false;phase='CLOSED';}
  });
}
function boot(){
  if(window.location.origin!=='https://escudofit.com.br'||window.top!==window.self){
    document.body.textContent='Compra privada disponível somente no domínio oficial do Escudo Fit.';
    return;
  }
  const el=id=>document.getElementById(id),slot=el('google-slot'),consent=el('terms');
  let ready=false,activePage=true;
  const controller=createPrivateBuyerController({onState:(s,message)=>{
    el('state').textContent=message;el('phase').textContent=s.phase;
    el('server-state').textContent=s.serverState||'—';
    el('order-id').textContent=s.orderId||'—';
    el('notice').textContent=s.noticeState||'Não confirmado';
    el('payment').textContent=s.paymentConfirmed?'Confirmado':'Não confirmado';
    el('premium').textContent=s.premiumGranted?'Ativo':'Não confirmado';
    el('buy').disabled=!s.canIssue||!consent.checked;
    // Consent may be acknowledged after Google login, even during a temporary API hold.
    // Only canIssue (server READY) may unlock the financial POST button.
    consent.disabled=!s.canRead;
    el('retry-preflight').disabled=!s.canRead||s.attempted;
    el('checkout').disabled=!s.canRead||!s.orderId;
    el('refresh').disabled=!s.canRead;
    slot.hidden=s.phase!=='GOOGLE_LOGIN';el('logout').hidden=s.phase==='GOOGLE_LOGIN';
    const qr=controller.pix();el('pix-panel').hidden=!qr;el('pix-code').value=qr||'';
    el('expiry').textContent=s.expiresAt?new Date(s.expiresAt).toLocaleString('pt-BR'):'—';
  }});
  consent.addEventListener('change',()=>{el('buy').disabled=!consent.checked||!controller.snapshot().canIssue;});
  el('retry-preflight').addEventListener('click',()=>controller.preflight());
  el('buy').addEventListener('click',()=>controller.issue(consent.checked));
  el('checkout').addEventListener('click',()=>controller.checkout());
  el('refresh').addEventListener('click',()=>controller.status());
  el('logout').addEventListener('click',()=>{controller.reset();consent.checked=false;
    slot.replaceChildren();renderGoogle();});
  el('copy').addEventListener('click',async()=>{
    const qr=controller.pix();if(!qr)return;
    try{await navigator.clipboard.writeText(qr);el('state').textContent='Pix copiado; confira valor e recebedor no banco.';}
    catch{el('state').textContent='Não foi possível copiar o Pix.';}
  });
  const renderGoogle=()=>{
    if(!ready||!activePage)return;
    const sdk=window.google.accounts.id;
    sdk.disableAutoSelect();
    sdk.initialize({client_id:BUYER_CLIENT_ID,callback:async response=>{
      let credential=response?.credential;
      try{if(response)response.credential=undefined;}catch{}
      if(credential)await controller.signIn(credential);
      credential=null;
    },auto_select:false,button_auto_select:false,use_fedcm_for_button:true,ux_mode:'popup'});
    sdk.renderButton(slot,{theme:'outline',size:'large',shape:'pill',text:'continue_with',
      width:Math.min(320,Math.max(200,slot.clientWidth))});
  };
  const begin=Date.now();
  const load=()=>{
    if(window.google?.accounts?.id){ready=true;renderGoogle();}
    else if(Date.now()-begin<10000)setTimeout(load,200);
    else el('state').textContent='Login Google indisponível neste navegador.';
  };
  window.addEventListener('pagehide',()=>{activePage=false;controller.destroy();});
  load();
}
if(typeof window!=='undefined'&&typeof document!=='undefined'&&window.location.pathname==='/app/comprar/v2/buyer.html')boot();
