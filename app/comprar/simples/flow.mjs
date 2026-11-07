// Checkout único Escudo Fit v44: dois controladores existentes, nenhuma regra financeira no navegador.
// A etapa KMS exige consentimento e autenticação Google operador/comprador.
// A emissão Pix exige READY_FOR_SINGLE_PURCHASE no servidor, com uma única tentativa.
import {createV2ApprovalController,V2_CLIENT_ID} from '../v2/approval.mjs';
import {createPrivateBuyerController,BUYER_CLIENT_ID} from '../v2/buyer.mjs';
const $=id=>document.getElementById(id);
const slot=$('google-slot');
let mode='buyer',sdkReady=false,pageActive=true,lastGoogleKey='';
const approval=createV2ApprovalController({onState:showApproval});
const buyer=createPrivateBuyerController({onState:showBuyer});
const timestamp=ms=>ms?new Date(ms).toLocaleString('pt-BR'):'—';

function showApproval(s,message){
  $('approval-status').textContent=message;
  $('approval-phase').textContent=s.phase;
  $('approval-expiry').textContent=timestamp(s.expiresAtMs);
  $('approval-consent').disabled=!s.canApprove;
  $('approve').disabled=!s.canApprove||!$('approval-consent').checked;
  $('restart-approval').disabled=s.submitted;
  if(s.phase==='APPROVED'){
    mode='buyer';
    $('approval-panel').hidden=true;
    $('start-approval').hidden=true;
    buyer.reset();
    $('state').textContent='Autorização assinada. Agora entre com a conta Google do comprador P-00.';
  }
  renderGoogle();
}
function showBuyer(s,message){
  if(mode!=='buyer')return;
  $('state').textContent=message;
  $('phase').textContent=s.phase;
  $('server-state').textContent=s.serverState||'—';
  $('order-id').textContent=s.orderId||'—';
  $('payment').textContent=s.paymentConfirmed?'Confirmado':'Não confirmado';
  $('premium').textContent=s.premiumGranted?'Ativo':'Não confirmado';
  $('notice').textContent=s.noticeState||'Não confirmado';
  $('expiry').textContent=s.expiresAt?timestamp(Date.parse(s.expiresAt)):'—';
  $('terms').disabled=!s.canRead;
  $('buy').disabled=!s.canIssue||!$('terms').checked;
  $('retry-preflight').disabled=!s.canRead||s.attempted;
  $('checkout').disabled=!s.canRead||!s.orderId;
  $('refresh').disabled=!s.canRead;
  $('logout').hidden=!s.canRead;
  $('start-approval').hidden=s.phase!=='APPROVAL_REQUIRED';
  const qr=buyer.pix();
  $('pix-panel').hidden=!qr;
  $('pix-code').value=qr||'';
  renderGoogle();
}
function googleSetup(phase,nonce){
  if(!sdkReady||!pageActive)return;
  const key=mode+'|'+phase+'|'+(nonce||'');
  if(lastGoogleKey===key)return;
  lastGoogleKey=key;
  slot.replaceChildren();
  const g=window.google.accounts.id;
  g.disableAutoSelect();
  g.initialize({
    client_id:mode==='buyer'?BUYER_CLIENT_ID:V2_CLIENT_ID,
    ...(nonce?{nonce}:{}),
    callback:onGoogle,
    auto_select:false,button_auto_select:false,use_fedcm_for_button:true,ux_mode:'popup'
  });
  g.renderButton(slot,{theme:'outline',size:'large',shape:'pill',text:'continue_with',
    width:Math.min(320,Math.max(210,slot.clientWidth))});
}
async function onGoogle(response){
  let jwt=response?.credential;
  try{if(response)response.credential=undefined;}catch{}
  if(!jwt||!pageActive)return;
  const activeMode=mode;
  if(activeMode==='buyer'){
    await buyer.signIn(jwt);
    jwt=null;renderGoogle();return;
  }
  const s=approval.snapshot();
  if(s.phase==='OPERATOR_INITIAL')await approval.beginChallenge(jwt);
  else if(s.phase==='OPERATOR_NONCE')approval.acceptNonceCredential('operator',jwt);
  else if(s.phase==='BUYER_NONCE')approval.acceptNonceCredential('buyer',jwt);
  jwt=null;renderGoogle();
}
function renderGoogle(){
  if(!sdkReady||!pageActive)return;
  if(mode==='buyer'){
    const s=buyer.snapshot();
    if(s.phase!=='GOOGLE_LOGIN'){
      slot.replaceChildren();lastGoogleKey='';
      return;
    }
    $('identity-prompt').textContent='Entre com a conta Google do comprador P-00.';
    googleSetup('BUYER_LOGIN',null);
    return;
  }
  const phase=approval.snapshot().phase;
  const prompt=phase==='OPERATOR_INITIAL'?
    'Escolha a conta Google do operador autorizado.':
    phase==='OPERATOR_NONCE'?
    'Confirme novamente o operador com o desafio de segurança.':
    phase==='BUYER_NONCE'?
    'Agora escolha a conta Google do comprador P-00.':
    'Autenticação concluída. Confirme a assinatura abaixo.';
  $('identity-prompt').textContent=prompt;
  if(['OPERATOR_INITIAL','OPERATOR_NONCE','BUYER_NONCE'].includes(phase)){
    googleSetup(phase,approval.nonceForGoogle());return;
  }
  slot.replaceChildren();lastGoogleKey='';
}

$('terms').addEventListener('change',()=>{
  $('buy').disabled=!$('terms').checked||!buyer.snapshot().canIssue;
});
$('buy').addEventListener('click',()=>buyer.issue($('terms').checked));
$('checkout').addEventListener('click',()=>buyer.checkout());
$('refresh').addEventListener('click',()=>buyer.status());
$('retry-preflight').addEventListener('click',()=>buyer.preflight());
$('copy').addEventListener('click',async()=>{
  const qr=buyer.pix();if(!qr)return;
  try{await navigator.clipboard.writeText(qr);
    $('state').textContent='Pix copiado. Confira R$ 4,99 e o recebedor no banco.';}
  catch{$('state').textContent='Falha ao copiar. Selecione e copie o código manualmente.';}
});
$('logout').addEventListener('click',()=>{
  buyer.reset();$('terms').checked=false;renderGoogle();
});
$('start-approval').addEventListener('click',()=>{
  if(buyer.snapshot().phase!=='APPROVAL_REQUIRED')return;
  buyer.reset();$('terms').checked=false;
  mode='approval';
  $('approval-panel').hidden=false;
  $('start-approval').hidden=true;
  $('identity-prompt').textContent='Escolha primeiro a conta do operador.';
  $('approval-status').textContent='Autentique o operador e o comprador para assinar uma única aprovação KMS.';
  renderGoogle();
});
$('approval-consent').addEventListener('change',()=>{
  $('approve').disabled=!$('approval-consent').checked||!approval.snapshot().canApprove;
});
$('approve').addEventListener('click',()=>approval.approve($('approval-consent').checked));
$('restart-approval').addEventListener('click',()=>{
  if(!approval.reset())return;
  $('approval-consent').checked=false;renderGoogle();
});

if(location.origin!=='https://escudofit.com.br'||window.top!==window.self){
  document.body.textContent='Pagamento disponível somente no site oficial do Escudo Fit.';
  pageActive=false;
}else{
  $('identity-prompt').textContent='Entre com a conta Google do comprador P-00.';
  const started=Date.now();
  const waitGoogle=()=>{
    if(!pageActive)return;
    if(window.google?.accounts?.id){sdkReady=true;renderGoogle();}
    else if(Date.now()-started<10000)setTimeout(waitGoogle,200);
    else $('state').textContent='Login Google indisponível. Recarregue a página.';
  };
  waitGoogle();
  const timer=setInterval(()=>{if(mode==='approval')approval.checkExpiry();},1000);
  addEventListener('pagehide',()=>{
    clearInterval(timer);pageActive=false;approval.destroy();buyer.destroy();
  },{once:true});
}
