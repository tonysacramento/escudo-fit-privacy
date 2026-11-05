/** Private v2 owner handoff. Only Google GIS issues tokens; never persist them. */
export const GOOGLE_CLIENT_ID='835029473980-22hokuuman3rpbiefs54gg1ntnqu6lc7.apps.googleusercontent.com';
export const APPROVAL_URL='https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/payments/pilot-v2/operator/approve';
const validToken=s=>typeof s==='string'&&s.length<16384&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s);
const nonce=()=>{
  const b=new Uint8Array(32);
  crypto.getRandomValues(b);
  return 'ef-v2-approval-'+Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
};
export function createV2ApprovalController({renderGoogle,fetchImpl=fetch,now=Date.now,
  onState=()=>{}}={}){
  let step='READY',operator=null,buyer=null,deadline=0,epoch=0,flight=null;
  const emit=(message='')=>onState(Object.freeze({step,message,canConfirm:step==='CONFIRM'}));
  const erase=()=>{operator=null;buyer=null;deadline=0;flight?.abort();flight=null;};
  const reset=(message='Operação cancelada. Tokens descartados.')=>{
    epoch++;erase();step='READY';emit(message);
  };
  const check=e=>{
    if(e!==epoch||now()>=deadline)throw Error('EXPIRED');
  };
  const ask=(role,e)=>{
    renderGoogle({role,nonce:nonce(),callback:response=>{
      let credential=response?.credential;
      if(response&&typeof response==='object')try{response.credential=null;}catch{}
      if(e!==epoch||step!==role||!validToken(credential)) {
        credential=null;reset('Não foi possível confirmar a autenticação Google.');return;
      }
      if(role==='OPERATOR'){
        operator=credential;credential=null;step='BUYER';
        emit('Entre com a conta Google compradora P-00.');
        ask('BUYER',e);
      } else {
        buyer=credential;credential=null;step='CONFIRM';
        emit('As duas autenticações foram obtidas. Confirme a autorização específica.');
      }
    }});
  };
  return Object.freeze({
    start(){
      if(step!=='READY')return false;
      epoch++;erase();const e=epoch;deadline=now()+120000;step='OPERATOR';
      emit('Entre com a conta Google do operador autorizado.');
      try{ask('OPERATOR',e);return true;}catch{reset('Login Google indisponível.');return false;}
    },
    async confirm(){
      if(step!=='CONFIRM'||!validToken(operator)||!validToken(buyer))return false;
      const e=epoch;step='SENDING';emit('Conferindo as identidades e a aprovação no servidor.');
      const signal=new AbortController();flight=signal;
      try{
        check(e);
        const response=await fetchImpl(APPROVAL_URL,{method:'POST',mode:'cors',credentials:'omit',
          redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',
          headers:{authorization:'Bearer '+operator,'x-escudo-buyer-authorization':'Bearer '+buyer},
          signal:signal.signal});
        check(e);
        const contentType=response.headers.get('content-type')||'';
        if(!response.ok||!/^application\/json(?:;|$)/i.test(contentType))throw Error('HELD');
        const result=await response.json();check(e);
        if(result?.state!=='APPROVED_V2_SINGLE_PILOT'||
          !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(result.approvalId||'')||
          result.ordersCreated!==0||result.premiumGranted!==false)throw Error('RECEIPT');
        erase();step='DONE';
        emit('Aprovação v2 registrada. Nenhum Pix ou Premium foi criado.');
        return true;
      }catch{
        if(e===epoch){erase();step='HELD';emit('Aprovação não confirmada. O assinador pode estar desligado; verifique o registro antes de tentar novamente.');}
        return false;
      }finally{signal.abort();if(flight===signal)flight=null;}
    },
    reset,
    checkExpiry(){
      if(deadline&&now()>=deadline&&step!=='DONE')reset('Sessão expirada. Refaça os dois logins.');
    },
    state:()=>Object.freeze({step,hasTokens:Boolean(operator||buyer)})
  });
}
function boot(){
  const node=id=>document.getElementById(id),slot=node('google-slot');
  let ready=false;
  const controller=createV2ApprovalController({
    onState:({step,message,canConfirm})=>{
      node('phase').textContent=step;
      node('step').textContent=({READY:'Iniciar autenticação',OPERATOR:'Operador autorizado',
        BUYER:'Comprador P-00',CONFIRM:'Confirmar autorização',SENDING:'Validando aprovação',
        DONE:'Aprovação registrada',HELD:'Aprovação pendente'})[step];
      node('status').textContent=message;
      node('start').hidden=step!=='READY';
      node('start').disabled=!ready;
      node('confirm').hidden=step!=='CONFIRM';
      node('confirm').disabled=!canConfirm;
      if(step!=='OPERATOR'&&step!=='BUYER')slot.replaceChildren();
    },
    renderGoogle:({nonce,callback})=>{
      if(!ready)throw Error('GIS_UNAVAILABLE');
      const gis=window.google.accounts.id;gis.disableAutoSelect();
      gis.initialize({client_id:GOOGLE_CLIENT_ID,nonce,callback,
        auto_select:false,button_auto_select:false,use_fedcm_for_button:true,
        ux_mode:'popup',cancel_on_tap_outside:true});
      slot.replaceChildren();
      gis.renderButton(slot,{theme:'outline',size:'large',shape:'pill',text:'continue_with',
        width:Math.min(320,Math.max(220,slot.clientWidth)),logo_alignment:'left'});
    }
  });
  node('start').addEventListener('click',()=>controller.start());
  node('confirm').addEventListener('click',()=>controller.confirm());
  node('cancel').addEventListener('click',()=>controller.reset());
  window.addEventListener('pagehide',()=>controller.reset(''));
  window.addEventListener('pageshow',event=>{if(event.persisted)controller.reset('Sessões descartadas.');});
  document.addEventListener('visibilitychange',()=>controller.checkExpiry());
  const start=Date.now();
  const poll=()=>{
    if(window.google?.accounts?.id){ready=true;node('start').disabled=false;
      node('status').textContent='Autenticação Google pronta. Nenhuma assinatura é feita sem sua confirmação.';return;}
    if(Date.now()-start>12000){node('status').textContent='Não foi possível carregar o Google. Reabra a página.';return;}
    setTimeout(poll,250);
  };
  poll();setInterval(()=>controller.checkExpiry(),1000);
}
if(typeof window!=='undefined'&&typeof document!=='undefined')boot();
