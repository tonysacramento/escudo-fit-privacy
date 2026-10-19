// Fixed future audit tag on the existing V38 service. Default traffic is preserved.
export const AUDIT_API='https://pilot-audit---escudo-fit-api-v38-olb3tmj35q-uc.a.run.app/api/v38/pilot-audit/identity';
export const GOOGLE_CLIENT_ID='835029473980-22hokuuman3rpbiefs54gg1ntnqu6lc7.apps.googleusercontent.com';
const PURPOSE='ESCUDO_FIT_NONFINANCIAL_IDENTITY_V1';
const token=value=>typeof value==='string'&&value.length<=16384&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&
  Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const noFinance=value=>value.financialGo===false&&value.orderCreated===false&&value.premiumGranted===false;
const challengeValid=(v,now)=>exact(v,['state','purpose','challengeId','buyerNonce','operatorNonce','expiresAtMs',
  'financialGo','orderCreated','premiumGranted'])&&v.state==='CHALLENGE'&&v.purpose===PURPOSE&&
  /^[A-Za-z0-9_-]{43}$/.test(v.challengeId)&&/^ef-audit-buyer-v1-[A-Za-z0-9_-]{43}$/.test(v.buyerNonce)&&
  /^ef-audit-operator-v1-[A-Za-z0-9_-]{43}$/.test(v.operatorNonce)&&
  Number.isSafeInteger(v.expiresAtMs)&&v.expiresAtMs>now&&v.expiresAtMs<=now+300000&&noFinance(v);
const proofValid=v=>exact(v,['state','purpose','buyerEmailHash','operatorSubjectHash','buyerSubjectHash',
  'googleSignaturesVerified','noncesVerified','identitiesDistinct','freshIdentitiesVerified','challengeConsumed',
  'financialGo','orderCreated','premiumGranted'])&&v.state==='PASS_NONFINANCIAL_IDENTITIES'&&v.purpose===PURPOSE&&
  ['buyerEmailHash','operatorSubjectHash','buyerSubjectHash'].every(k=>/^[a-f0-9]{64}$/.test(v[k]))&&
  ['googleSignaturesVerified','noncesVerified','identitiesDistinct','freshIdentitiesVerified','challengeConsumed']
    .every(k=>v[k]===true)&&noFinance(v);

/** No app module, storage, cookie, token decoding, payment endpoint or automatic retry. */
export function createPilotAuditController({fetchImpl=fetch,now=Date.now,schedule=setTimeout,cancel=clearTimeout,
  renderGoogle,onState=()=>{},entryNonce=()=>{
    const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
    return 'ef-audit-entry-v1-'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  }}={}) {
  let phase='READY',epoch=0,bootstrap=null,buyer=null,challenge=null,expiry=0,timer=null,flight=null;
  const emit=(next,message='',error=false)=>{phase=next;onState(Object.freeze({phase,message,error}));};
  const erase=()=>{bootstrap=null;buyer=null;challenge=null;expiry=0;cancel(timer);timer=null;flight?.abort();flight=null;};
  const reset=(message='Verificação cancelada. As credenciais desta página foram descartadas.')=>{
    epoch++;erase();emit('READY',message);
  };
  const fail=()=>{epoch++;erase();emit('FAILED','Não foi possível concluir. Confira as contas selecionadas e inicie uma nova verificação.',true);};
  const live=e=>e===epoch&&expiry>now();
  const check=e=>{if(e!==epoch)throw Error('STALE');if(expiry<=now())throw Error('EXPIRED');};
  const request=async(body,e)=>{
    check(e);const controller=new AbortController();flight=controller;
    const timeout=schedule(()=>controller.abort(),12000);
    try{
      const response=await fetchImpl(AUDIT_API,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',
        redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal,
        headers:{'content-type':'application/json',authorization:'Bearer '+bootstrap},body:JSON.stringify(body)});
      check(e);
      if(!response.ok||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))throw Error('UNAVAILABLE');
      const reader=response.body.getReader();let size=0;const chunks=[];
      try{for(;;){const {value,done}=await reader.read();check(e);if(done)break;size+=value.byteLength;
        if(size>4096)throw Error('LARGE');chunks.push(value);}}
      finally{await reader.cancel().catch(()=>{});}
      const joined=new Uint8Array(size);let offset=0;
      for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}
      const result=JSON.parse(new TextDecoder().decode(joined));check(e);return result;
    }finally{cancel(timeout);controller.abort();if(flight===controller)flight=null;}
  };
  const arm=e=>{cancel(timer);timer=schedule(()=>{if(e===epoch){epoch++;erase();
    emit('EXPIRED','O prazo terminou. Inicie novamente para obter credenciais novas.',true);}},Math.max(0,expiry-now()));};
  const prompt=(role,nonce,e)=>{
    const accept=async response=>{
      // Discard the GIS response object itself; never retain the profile or raw callback.
      let credential=response?.credential;
      if(response&&typeof response==='object')try{response.credential=undefined;}catch{}
      if(e!==epoch||phase!==role){credential=null;return false;}
      try{
        check(e);if(!token(credential))throw Error('CREDENTIAL');
        if(role==='ENTRY'){
          bootstrap=credential;credential=null;emit('CHECKING','Conferindo a conta de auditoria…');
          const result=await request({action:'CHALLENGE'},e);check(e);
          if(!challengeValid(result,now()))throw Error('CHALLENGE');
          challenge=result;expiry=Math.min(expiry,result.expiresAtMs);arm(e);
          emit('BUYER','Escolha agora a conta do comprador.');prompt('BUYER',result.buyerNonce,e);
        }else if(role==='BUYER'){
          buyer=credential;credential=null;emit('OPERATOR','Confirme novamente a conta de auditoria, diferente do comprador.');
          prompt('OPERATOR',challenge.operatorNonce,e);
        }else{
          const body={action:'VERIFY',challengeId:challenge.challengeId,buyerIdToken:buyer,operatorIdToken:credential};
          credential=null;buyer=null;emit('CHECKING','Verificando as duas identidades…');
          let result;
          try{result=await request(body,e);}finally{body.buyerIdToken=null;body.operatorIdToken=null;}
          check(e);if(!proofValid(result))throw Error('PROOF');
          erase();emit('PASSED','Identidades verificadas. Nenhuma cobrança ou liberação de Premium foi realizada.');
        }
        return true;
      }catch{credential=null;if(e===epoch)fail();return false;}
    };
    renderGoogle({role,nonce,callback:accept});
  };
  return Object.freeze({
    start(){epoch++;erase();const e=epoch;expiry=now()+300000;arm(e);
      emit('ENTRY','Entre com a conta selecionada para auditoria.');
      try{prompt('ENTRY',entryNonce(),e);}catch{fail();}},
    reset,
    checkExpiry(){if(!['READY','FAILED','EXPIRED','PASSED'].includes(phase)&&!live(epoch)){
      epoch++;erase();emit('EXPIRED','O prazo terminou. Inicie novamente.',true);}},
    snapshot:()=>Object.freeze({phase,hasCredentials:Boolean(bootstrap||buyer),hasChallenge:Boolean(challenge)}),
  });
}

function boot() {
  const get=id=>document.getElementById(id),slot=get('google-slot');
  const text={
    READY:['PREPARAÇÃO','Tudo pronto para começar','Primeiro entre com a conta selecionada para auditoria.'],
    ENTRY:['1 DE 3','Entrar para iniciar a auditoria','Use a conta de auditoria selecionada para o piloto.'],
    BUYER:['2 DE 3','Identificar o comprador','No botão do Google, escolha a conta selecionada para realizar a compra.'],
    OPERATOR:['3 DE 3','Confirmar a conta de auditoria','Escolha a conta de auditoria novamente. Ela deve ser diferente da conta do comprador.'],
    CHECKING:['VERIFICANDO','Aguarde a confirmação','Mantenha esta página aberta durante a verificação.'],
    PASSED:['CONCLUÍDO','Duas identidades verificadas','A prova de identidade foi concluída. A próxima etapa do piloto exige autorização própria.'],
    FAILED:['TENTAR NOVAMENTE','Verificação não concluída','Confira as contas selecionadas e reinicie. Nenhuma cobrança foi criada.'],
    EXPIRED:['PRAZO ENCERRADO','Inicie uma nova verificação','As credenciais desta página foram descartadas.'],
  };
  let googleReady=false;
  const controller=createPilotAuditController({
    onState:state=>{
      const copy=text[state.phase];get('step-count').textContent=copy[0];get('step-title').textContent=copy[1];
      get('step-description').textContent=copy[2];get('status').textContent=state.message;
      get('status').dataset.error=String(state.error);slot.replaceChildren();
      get('start').hidden=!['READY','FAILED','EXPIRED','PASSED'].includes(state.phase);
      get('start').disabled=!googleReady;get('start').textContent=state.phase==='READY'?'Começar verificação':'Nova verificação';
      get('cancel').hidden=['READY','FAILED','EXPIRED','PASSED'].includes(state.phase);
    },
    renderGoogle:({nonce,callback})=>{
      if(!googleReady)throw Error('GOOGLE_UNAVAILABLE');
      const id=window.google.accounts.id;id.disableAutoSelect();
      id.initialize({client_id:GOOGLE_CLIENT_ID,nonce,callback,auto_select:false,button_auto_select:false,
        use_fedcm_for_button:true,ux_mode:'popup',cancel_on_tap_outside:true});
      id.renderButton(slot,{theme:'outline',size:'large',shape:'pill',text:'continue_with',
        width:Math.min(320,Math.max(200,slot.clientWidth)),logo_alignment:'left'});
    },
  });
  get('start').addEventListener('click',()=>controller.start());
  get('cancel').addEventListener('click',()=>controller.reset());
  window.addEventListener('pagehide',()=>controller.reset(''));
  window.addEventListener('pageshow',event=>{if(event.persisted)controller.reset('Inicie uma nova verificação.');});
  document.addEventListener('visibilitychange',()=>controller.checkExpiry());
  window.addEventListener('escudofit:accountChanged',()=>controller.reset('A conta mudou. Inicie novamente.'));
  window.addEventListener('storage',event=>{if(event.key==='escudofit_web_auth_v1')controller.reset('A conta mudou. Inicie novamente.');});
  const started=Date.now();
  const load=()=>{
    if(window.google?.accounts?.id){googleReady=true;get('start').disabled=false;get('start').textContent='Começar verificação';get('status').textContent='';return;}
    if(Date.now()-started>=10000){get('status').textContent='O login Google não carregou. Reabra esta página para tentar novamente.';return;}
    setTimeout(load,200);
  };
  load();
}
if(typeof window!=='undefined'&&typeof document!=='undefined')boot();
