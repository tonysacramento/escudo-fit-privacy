/** Owner-only v2 approval. Google tokens stay in memory and have server-issued nonces. */
export const GOOGLE_CLIENT_ID='835029473980-22hokuuman3rpbiefs54gg1ntnqu6lc7.apps.googleusercontent.com';
const ROOT='https://v2approval---escudo-fit-api-v38-olb3tmj35q-uc.a.run.app/api/v38/payments/pilot-v2/operator';
export const CHALLENGE_URL=ROOT+'/challenge';
export const APPROVAL_URL=ROOT+'/approve';
const token=s=>typeof s==='string'&&s.length<=16384&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s);
const validChallenge=(r,now)=>r?.state==='V2_GOOGLE_CHALLENGE'&&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(r.challengeId||'')&&
  /^ef-v2-buyer-[A-Za-z0-9_-]{43}$/.test(r.buyerNonce||'')&&
  /^ef-v2-operator-[A-Za-z0-9_-]{43}$/.test(r.operatorNonce||'')&&
  Number.isSafeInteger(r.expiresAtMs)&&r.expiresAtMs>now&&r.expiresAtMs<=now+300000;
export function createV2ApprovalController({renderGoogle,fetchImpl=fetch,now=Date.now,onState=()=>{}}={}){
  let step='READY',operator=null,buyer=null,challenge=null,deadline=0,epoch=0,flight=null;
  const emit=(message='')=>onState(Object.freeze({step,message,canConfirm:step==='CONFIRM'}));
  const erase=()=>{operator=null;buyer=null;challenge=null;deadline=0;flight?.abort();flight=null;};
  const reset=(message='Operação cancelada; credenciais descartadas.')=>{
    epoch++;erase();step='READY';emit(message);
  };
  const check=e=>{if(e!==epoch||now()>=deadline)throw Error('EXPIRED');};
  const ask=(role,nonce,e)=>renderGoogle({role,nonce,callback:async response=>{
    let credential=response?.credential;
    if(response&&typeof response==='object')try{response.credential=null;}catch{}
    if(e!==epoch||step!==role||!token(credential)){credential=null;reset('Login Google inválido.');return false;}
    try{
      check(e);
      if(role==='BOOTSTRAP'){
        step='CHECKING';emit('Solicitando desafio de uso único ao servidor.');
        const signal=new AbortController();flight=signal;
        let result;
        try{
          const res=await fetchImpl(CHALLENGE_URL,{method:'POST',mode:'cors',cache:'no-store',
            redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',
            headers:{authorization:'Bearer '+credential},signal:signal.signal});
          check(e);
          if(!res.ok||!/^application\/json(?:;|$)/i.test(res.headers.get('content-type')||''))
            throw Error('CHALLENGE_OFF');
          result=await res.json();
        }finally{signal.abort();if(flight===signal)flight=null;credential=null;}
        check(e);
        if(!validChallenge(result,now()))throw Error('BAD_CHALLENGE');
        challenge=result;deadline=Math.min(deadline,result.expiresAtMs);
        step='BUYER';emit('Entre com a conta Google compradora P-00.');
        ask('BUYER',challenge.buyerNonce,e);
      }else if(role==='BUYER'){
        buyer=credential;credential=null;
        step='OPERATOR';emit('Confirme novamente a conta Google do operador.');
        ask('OPERATOR',challenge.operatorNonce,e);
      }else{
        operator=credential;credential=null;
        step='CONFIRM';emit('Confirme a aprovação privada de R$ 4,99 para 30 dias.');
      }
      return true;
    }catch{credential=null;if(e===epoch){erase();step='HELD';emit('Não foi possível obter ou validar o desafio. Nenhuma assinatura executada.');}return false;}
  }});
  return Object.freeze({
    start(){
      if(step!=='READY')return false;
      epoch++;erase();const e=epoch;deadline=now()+300000;
      step='BOOTSTRAP';emit('Identifique a conta Google do operador para iniciar.');
      try{ask('BOOTSTRAP',undefined,e);return true;}catch{reset('Login Google indisponível.');return false;}
    },
    async confirm(){
      if(step!=='CONFIRM'||!token(operator)||!token(buyer)||!challenge)return false;
      const e=epoch;step='SENDING';emit('Conferindo autorizações e registro no servidor.');
      const signal=new AbortController();flight=signal;
      try{
        check(e);
        const response=await fetchImpl(APPROVAL_URL,{method:'POST',mode:'cors',credentials:'omit',
          redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',
          headers:{authorization:'Bearer '+operator,
            'x-escudo-buyer-authorization':'Bearer '+buyer,
            'x-escudo-challenge-id':challenge.challengeId},
          signal:signal.signal});
        check(e);
        if(!response.ok||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''))
          throw Error('HELD');
        const result=await response.json();check(e);
        if(result?.state!=='APPROVED_V2_SINGLE_PILOT'||
          !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(result.approvalId||'')||
          result.ordersCreated!==0||result.premiumGranted!==false)throw Error('RECEIPT');
        erase();step='DONE';emit('Aprovação v2 registrada. Nenhum Pix ou Premium foi criado.');
        return true;
      }catch{
        if(e===epoch){erase();step='HELD';emit('Registro não confirmado. Consulte o estado antes de repetir.');}
        return false;
      }finally{signal.abort();if(flight===signal)flight=null;}
    },reset,
    checkExpiry(){if(deadline&&now()>=deadline&&step!=='DONE')reset('Desafio expirado. Refazer autenticações.');},
    state:()=>Object.freeze({step,hasTokens:Boolean(operator||buyer)})
  });
}
function boot(){
  const node=id=>document.getElementById(id),slot=node('google-slot');
  let ready=false;
  const controller=createV2ApprovalController({
    onState:({step,message,canConfirm})=>{
      node('phase').textContent=step;
      node('step').textContent=({
        READY:'Iniciar autenticação',BOOTSTRAP:'Identificar operador',
        CHECKING:'Solicitando desafio',BUYER:'Comprador P-00',
        OPERATOR:'Confirmar operador',CONFIRM:'Confirmar autorização',
        SENDING:'Validando aprovação',DONE:'Aprovação registrada',
        HELD:'Aprovação pendente'})[step];
      node('status').textContent=message;
      node('start').hidden=step!=='READY';node('start').disabled=!ready;
      node('confirm').hidden=step!=='CONFIRM';node('confirm').disabled=!canConfirm;
      if(!['BOOTSTRAP','BUYER','OPERATOR'].includes(step))slot.replaceChildren();
    },
    renderGoogle:({nonce,callback})=>{
      if(!ready)throw Error('GIS_UNAVAILABLE');
      const gis=window.google.accounts.id;gis.disableAutoSelect();
      gis.initialize({client_id:GOOGLE_CLIENT_ID,...(nonce?{nonce}:{}),callback,
        auto_select:false,button_auto_select:false,use_fedcm_for_button:true,
        ux_mode:'popup',cancel_on_tap_outside:true});
      slot.replaceChildren();
      gis.renderButton(slot,{theme:'outline',size:'large',shape:'pill',
        text:'continue_with',width:Math.min(320,Math.max(220,slot.clientWidth))});
    }
  });
  node('start').addEventListener('click',()=>controller.start());
  node('confirm').addEventListener('click',()=>controller.confirm());
  node('cancel').addEventListener('click',()=>controller.reset());
  window.addEventListener('pagehide',()=>controller.reset(''));
  window.addEventListener('pageshow',event=>{if(event.persisted)controller.reset('Sessões descartadas.');});
  document.addEventListener('visibilitychange',()=>controller.checkExpiry());
  const started=Date.now(),poll=()=>{
    if(window.google?.accounts?.id){ready=true;node('start').disabled=false;
      node('status').textContent='Google pronto. Nenhuma assinatura ocorre sem confirmação.';return;}
    if(Date.now()-started>12000){node('status').textContent='Google indisponível. Reabra a página.';return;}
    setTimeout(poll,250);
  };
  poll();setInterval(()=>controller.checkExpiry(),1000);
}
if(typeof window!=='undefined'&&typeof document!=='undefined')boot();
