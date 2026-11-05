// Escudo Fit v44 — approval-only browser flow via 0%-traffic tagged API candidate. This page never issues Pix,
// invokes the private signer directly, grants Premium or sends payment data.
// All identity and nonce validation is authoritative on the backend.
export const V2_API='https://v2approval---escudo-fit-api-v38-olb3tmj35q-uc.a.run.app';
export const V2_CLIENT_ID='835029473980-22hokuuman3rpbiefs54gg1ntnqu6lc7.apps.googleusercontent.com';
export const CHALLENGE_PATH='/api/v38/payments/pilot-v2/operator/challenge';
export const APPROVE_PATH='/api/v38/payments/pilot-v2/operator/approve';
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const NONCE=/^ef-v2-(buyer|operator)-[A-Za-z0-9_-]{43}$/;
export const looksLikeGoogleIdToken=v=>typeof v==='string'&&v.length<16384&&JWT.test(v);

export function validateV2Challenge(value,now=Date.now()){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||
    value.state!=='V2_GOOGLE_CHALLENGE'||!UUID.test(value.challengeId||'')||
    !NONCE.test(value.operatorNonce||'')||!value.operatorNonce.startsWith('ef-v2-operator-')||
    !NONCE.test(value.buyerNonce||'')||!value.buyerNonce.startsWith('ef-v2-buyer-')||
    value.operatorNonce===value.buyerNonce||
    !Number.isSafeInteger(value.expiresAtMs)||value.expiresAtMs<=now||
    value.expiresAtMs>now+300000)throw Error('CHALLENGE_INVALID');
  return Object.freeze({
    challengeId:value.challengeId,operatorNonce:value.operatorNonce,
    buyerNonce:value.buyerNonce,expiresAtMs:value.expiresAtMs
  });
}
export function validateV2Approval(value){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||
    value.state!=='APPROVED_V2_SINGLE_PILOT'||!UUID.test(value.approvalId||'')||
    value.ordersCreated!==0||value.premiumGranted!==false)throw Error('APPROVAL_UNCONFIRMED');
  return Object.freeze({state:value.state,approvalId:value.approvalId,
    ordersCreated:0,premiumGranted:false});
}
export async function v2Request(path,headers,{fetchImpl=fetch}={}){
  if(![CHALLENGE_PATH,APPROVE_PATH].includes(path))throw Error('PATH_REJECTED');
  const response=await fetchImpl(V2_API+path,{
    method:'POST',mode:'cors',credentials:'omit',cache:'no-store',
    referrerPolicy:'no-referrer',redirect:'error',
    headers:{accept:'application/json',...headers},
    // Intentionally no body and no Content-Type: the relay rejects either.
    signal:AbortSignal.timeout(15000)
  });
  if(!response.ok||!/^application\/json(?:;|$)/i.test(response.headers?.get('content-type')||''))
    throw Error('APPROVAL_API_UNAVAILABLE');
  const raw=await response.text();
  if(raw.length>4096)throw Error('APPROVAL_RESPONSE_TOO_LARGE');
  try{return JSON.parse(raw);}catch{throw Error('APPROVAL_RESPONSE_INVALID');}
}

/** No tokens or nonces are put in URLs, cookies, localStorage or logs.
 * A lost approval response is terminal: never retry a potentially signed POST.
 */
export function createV2ApprovalController({request=v2Request,now=Date.now,onState=()=>{}}={}){
  let phase='OPERATOR_INITIAL',challenge=null,operatorJwt=null,buyerJwt=null;
  let busy=false,submitted=false,approvalId=null,epoch=0;
  const snapshot=()=>Object.freeze({phase,busy,submitted,approvalId,
    expiresAtMs:challenge?.expiresAtMs||null,
    canApprove:phase==='READY'&&!busy&&!submitted&&challenge?.expiresAtMs>now()});
  const emit=message=>onState(snapshot(),message);
  const clear=()=>{operatorJwt=null;buyerJwt=null;challenge=null;};
  const expired=()=>{
    if(challenge&&challenge.expiresAtMs<=now()){
      clear();phase='EXPIRED';busy=false;emit('O desafio Google expirou. Reinicie o processo; nenhuma assinatura foi criada por esta página.');
      return true;
    }
    return false;
  };
  return Object.freeze({
    snapshot,
    nonceForGoogle(){
      if(phase==='OPERATOR_NONCE')return challenge?.operatorNonce||null;
      if(phase==='BUYER_NONCE')return challenge?.buyerNonce||null;
      return null;
    },
    reset(){
      if(submitted)return false;
      epoch++;clear();busy=false;phase='OPERATOR_INITIAL';approvalId=null;
      emit('Reiniciado sem enviar aprovação.');return true;
    },
    destroy(){epoch++;clear();busy=false;phase='CLOSED';},
    checkExpiry(){return expired();},
    async beginChallenge(token){
      if(phase!=='OPERATOR_INITIAL'||busy||submitted||!looksLikeGoogleIdToken(token))return false;
      const current=++epoch;busy=true;phase='CHALLENGE_LOADING';
      emit('Solicitando desafio nonce ao servidor. Nenhuma assinatura será criada.');
      try{
        const value=await request(CHALLENGE_PATH,{authorization:'Bearer '+token});
        if(current!==epoch)return false;
        challenge=validateV2Challenge(value,now());busy=false;phase='OPERATOR_NONCE';
        emit('Desafio emitido. Entre novamente com a conta Google do operador usando o nonce correspondente.');
        return true;
      }catch{
        if(current===epoch){clear();busy=false;phase='ERROR';emit('Desafio indisponível ou inválido. Confira o relay e a janela de autorização.');}
        return false;
      }
    },
    acceptNonceCredential(role,token){
      if(busy||submitted||expired()||!looksLikeGoogleIdToken(token))return false;
      if(role==='operator'&&phase==='OPERATOR_NONCE'){
        operatorJwt=token;phase='BUYER_NONCE';
        emit('Token nonce do operador recebido. Agora escolha a conta Google do comprador P-00.');
        return true;
      }
      if(role==='buyer'&&phase==='BUYER_NONCE'){
        buyerJwt=token;phase='READY';
        emit('Os dois tokens nonce foram recebidos. Confira os termos e autorize uma única assinatura.');
        return true;
      }
      return false;
    },
    async approve(confirmed){
      if(confirmed!==true||!snapshot().canApprove||!operatorJwt||!buyerJwt||
         !looksLikeGoogleIdToken(operatorJwt)||!looksLikeGoogleIdToken(buyerJwt))return false;
      const current=epoch;submitted=true;busy=true;phase='SUBMITTING';
      const headers={authorization:'Bearer '+operatorJwt,
        'x-escudo-buyer-authorization':'Bearer '+buyerJwt,
        'x-escudo-challenge-id':challenge.challengeId};
      emit('Assinatura solicitada uma única vez. Não atualize nem repita esta operação.');
      try{
        const response=await request(APPROVE_PATH,headers);
        if(current!==epoch)return false;
        const valid=validateV2Approval(response);
        approvalId=valid.approvalId;clear();busy=false;phase='APPROVED';
        emit('Aprovação assinada confirmada pelo servidor. Nenhum Pix foi emitido.');
        return true;
      }catch{
        if(current===epoch){
          clear();busy=false;phase='UNKNOWN';
          emit('Resultado da assinatura incerto. Não repita: consulte a aprovação no Firestore antes de qualquer nova tentativa.');
        }
        return false;
      }
    }
  });
}

function boot(){
  if(window.location.origin!=='https://escudofit.com.br'||window.top!==window.self){
    document.body.textContent='A aprovação privada só pode ocorrer diretamente no domínio oficial do Escudo Fit.';
    return;
  }
  const el=id=>document.getElementById(id);
  const slot=el('google-slot'),confirm=el('consent'),approve=el('approve');
  let googleReady=false,lastRendered='';
  const controller=createV2ApprovalController({onState:(s,message)=>{
    el('state').textContent=message;
    el('phase').textContent=s.phase;
    el('deadline').textContent=s.expiresAtMs?
      new Date(s.expiresAtMs).toLocaleString('pt-BR'):'—';
    approve.disabled=!s.canApprove||!confirm.checked;
    confirm.disabled=!s.canApprove;
    el('restart').disabled=s.submitted;
    el('receipt').hidden=s.phase!=='APPROVED';
    el('approval-ref').textContent=s.approvalId||'';
    renderGoogle();
  }});
  const renderGoogle=()=>{
    if(!googleReady)return;
    const s=controller.snapshot();
    if(!['OPERATOR_INITIAL','OPERATOR_NONCE','BUYER_NONCE'].includes(s.phase)){
      slot.replaceChildren();lastRendered='';return;
    }
    const nonce=controller.nonceForGoogle(),key=s.phase+':'+(nonce||'');
    if(lastRendered===key)return;
    lastRendered=key;slot.replaceChildren();
    // Google supports resetting GIS configuration; one button at a time avoids
    // cross-role callbacks. The backend verifies the JWT audience/nonce/subject.
    const api=window.google.accounts.id;
    api.disableAutoSelect();
    api.initialize({
      client_id:V2_CLIENT_ID,
      ...(nonce?{nonce}:{}),
      callback:async response=>{
        let jwt=response?.credential;
        try{if(response)response.credential=undefined;}catch{}
        if(!jwt)return;
        const current=controller.snapshot().phase;
        if(current==='OPERATOR_INITIAL')await controller.beginChallenge(jwt);
        else if(current==='OPERATOR_NONCE')controller.acceptNonceCredential('operator',jwt);
        else if(current==='BUYER_NONCE')controller.acceptNonceCredential('buyer',jwt);
        jwt=null;
      },
      auto_select:false,button_auto_select:false,use_fedcm_for_button:true,ux_mode:'popup'
    });
    api.renderButton(slot,{theme:'outline',size:'large',shape:'pill',
      text:'signin_with',width:Math.min(320,Math.max(200,slot.clientWidth))});
    el('identity-prompt').textContent=s.phase==='BUYER_NONCE'?
      'Escolha agora a conta Google do COMPRADOR P-00 (diferente da conta do operador).':
      'Escolha a conta Google do OPERADOR autorizado.';
  };
  confirm.addEventListener('change',()=>{approve.disabled=!confirm.checked||!controller.snapshot().canApprove;});
  approve.addEventListener('click',()=>controller.approve(confirm.checked));
  el('restart').addEventListener('click',()=>{if(controller.reset()){confirm.checked=false;renderGoogle();}});
  const ready=Date.now();
  const poll=()=>{
    if(window.google?.accounts?.id){googleReady=true;renderGoogle();}
    else if(Date.now()-ready<10000)setTimeout(poll,200);
    else el('state').textContent='Biblioteca Google indisponível neste navegador.';
  };
  const clock=setInterval(()=>controller.checkExpiry(),1000);
  window.addEventListener('pagehide',()=>{clearInterval(clock);controller.destroy();});
  el('phase').textContent='OPERATOR_INITIAL';
  poll();
}
if(typeof window!=='undefined'&&typeof document!=='undefined')boot();
