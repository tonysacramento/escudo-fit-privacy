export const APPROVAL_API='https://pilot-approval---escudo-fit-api-v38-olb3tmj35q-uc.a.run.app/api/v38/pilot-pix/approval';
export const GOOGLE_CLIENT_ID='835029473980-22hokuuman3rpbiefs54gg1ntnqu6lc7.apps.googleusercontent.com';
const PURPOSE='ESCUDO_FIT_SIGNED_APPROVAL_INSTALL_V1';
const OPERATOR='6b3b55088d7a4f1ccd0323121f5c01029d6e1be9a566850e5e6bb2c0838c4bbb';
const TERMS='prepaid-v1-2026-10-16';
const fields=['schemaVersion','approvalId','scope','state','approvedBySubjectHash','subjectHash','bindingDigest',
  'requestKeyHash','receiverAccountId','maxAmountBRL','currency','maxOrders','planKey','channel','termsVersion','issuedAtMs','expiresAtMs'];
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const noFinance=v=>['financialGo','approvalCreated','orderCreated','premiumGranted'].every(k=>v[k]===false);
const noFinanceFields=['financialGo','approvalCreated','orderCreated','premiumGranted'];
const token=v=>typeof v==='string'&&v.length<=16384&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,'0')).join('');

/** Scope/encoding precheck only. The private server verifies the Ed25519 signature
 * using its pinned public key before issuing a challenge and before storing. */
export async function validateSignedApproval(text,now=Date.now()){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>8192)throw Error('INVALID');
  const r=JSON.parse(text);
  if(!exact(r,[...fields,'operatorSignature'])||typeof r.operatorSignature!=='string'||! /^[A-Za-z0-9_-]{86}$/.test(r.operatorSignature)||r.schemaVersion!==1||
    !uuid.test(r.approvalId)||r.scope!=='FIRST_LIVE_PIX_SINGLE_ORDER'||r.state!=='APPROVED_SINGLE_PILOT'||
    r.approvedBySubjectHash!==OPERATOR||r.subjectHash===OPERATOR||
    !['subjectHash','bindingDigest','requestKeyHash'].every(k=>/^[a-f0-9]{64}$/.test(r[k]))||
    r.receiverAccountId!=='13926970'||r.maxAmountBRL!=='4.99'||r.currency!=='BRL'||r.maxOrders!==1||
    r.planKey!=='monthly'||r.channel!=='WEB_OFFICIAL_DIRECT'||r.termsVersion!==TERMS||
    !Number.isSafeInteger(r.issuedAtMs)||r.issuedAtMs<=0||r.issuedAtMs>now+60000||
    !Number.isSafeInteger(r.expiresAtMs)||r.expiresAtMs<=now||r.expiresAtMs<=r.issuedAtMs||r.expiresAtMs>r.issuedAtMs+1800000)throw Error('INVALID');
  const h=(await sha('ESCUDO_FIT_PILOT_REQUEST_KEY_V1|'+r.approvalId)).slice(0,32).split('');
  h[12]='4';h[16]=((parseInt(h[16],16)&3)|8).toString(16);const key=h.join('');
  const requestKey=`${key.slice(0,8)}-${key.slice(8,12)}-${key.slice(12,16)}-${key.slice(16,20)}-${key.slice(20)}`;
  const payload=JSON.stringify(['ESCUDO_FIT_FIRST_LIVE_APPROVAL_V1','escudo-fitclima','escudo-fit-payments-commercial',
    r.schemaVersion,r.approvalId,r.scope,r.approvedBySubjectHash,r.subjectHash,r.bindingDigest,r.requestKeyHash,
    r.receiverAccountId,r.maxAmountBRL,r.currency,r.maxOrders,r.planKey,r.channel,r.termsVersion,r.issuedAtMs,r.expiresAtMs]);
  if(r.requestKeyHash!==await sha(requestKey))throw Error('INVALID');
  return Object.freeze({record:Object.freeze({...r}),scopeDigest:await sha(payload)});
}
const challengeValid=(v,now)=>exact(v,['state','purpose','challengeId','buyerNonce','operatorNonce','expiresAtMs',...noFinanceFields])&&
  v.state==='CHALLENGE'&&v.purpose===PURPOSE&&/^[A-Za-z0-9_-]{43}$/.test(v.challengeId)&&
  /^ef-install-buyer-v1-[A-Za-z0-9_-]{43}$/.test(v.buyerNonce)&&/^ef-install-operator-v1-[A-Za-z0-9_-]{43}$/.test(v.operatorNonce)&&
  Number.isSafeInteger(v.expiresAtMs)&&v.expiresAtMs>now&&v.expiresAtMs<=now+300000&&noFinance(v);
const receiptValid=(v,file)=>exact(v,['state','purpose','approvalId','scopeDigest','approvalCreated','approvalRegistered',
  'googleSignaturesVerified','noncesVerified','freshIdentitiesVerified','identitiesDistinct','challengeConsumed',
  'financialGo','orderCreated','premiumGranted'])&&v.state==='SIGNED_APPROVAL_REGISTERED_NO_ORDER'&&
  v.purpose===PURPOSE&&v.approvalId===file.record.approvalId&&v.scopeDigest===file.scopeDigest&&
  typeof v.approvalCreated==='boolean'&&v.approvalRegistered===true&&
  ['googleSignaturesVerified','noncesVerified','freshIdentitiesVerified','identitiesDistinct','challengeConsumed'].every(k=>v[k]===true)&&
  ['financialGo','orderCreated','premiumGranted'].every(k=>v[k]===false);
/** Explicit Google callbacks; no product session, storage, token decoding or retry. */
export function createPilotApprovalInstallController({fetchImpl=fetch,now=Date.now,schedule=setTimeout,cancel=clearTimeout,
  renderGoogle,onState=()=>{},entryNonce=()=>{
    const b=new Uint8Array(32);crypto.getRandomValues(b);return 'ef-install-entry-v1-'+Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
  }}={}) {
  let phase='READY',epoch=0,bootstrap=null,buyer=null,challenge=null,signed=null,expiry=0,timer=null,flight=null;
  const emit=(p,message='',error=false)=>{phase=p;onState(Object.freeze({phase:p,message,error,hasSignedFile:Boolean(signed)}));};
  const erase=()=>{bootstrap=null;buyer=null;challenge=null;signed=null;expiry=0;cancel(timer);timer=null;flight?.abort();flight=null;};
  const reset=(message='Os dados desta página foram descartados.')=>{epoch++;erase();emit('READY',message);};
  const fail=()=>{epoch++;erase();emit('FAILED','Não foi possível confirmar o registro. Confira o arquivo e as contas. Nenhuma ordem foi criada.',true);};
  const check=e=>{if(e!==epoch||expiry<=now())throw Error('STALE');};
  const arm=e=>{cancel(timer);timer=schedule(()=>{if(e===epoch){epoch++;erase();emit('EXPIRED','O prazo terminou. Use um arquivo válido e confirme novamente.',true);}},Math.max(0,expiry-now()));};
  const request=async(body,e)=>{
    check(e);const c=new AbortController();flight=c;const timeout=schedule(()=>c.abort(),28000);
    try{
      const response=await fetchImpl(APPROVAL_API,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',
        referrerPolicy:'no-referrer',signal:c.signal,headers:{'content-type':'application/json',authorization:'Bearer '+bootstrap},body:JSON.stringify(body)});
      check(e);if(!response.ok||!response.body||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))throw Error('UNAVAILABLE');
      const reader=response.body.getReader(),chunks=[];let size=0;
      try{for(;;){const {value,done}=await reader.read();check(e);if(done)break;size+=value.byteLength;
        if(size>8192)throw Error('LARGE');chunks.push(value);}}
      finally{await reader.cancel().catch(()=>{});}
      const joined=new Uint8Array(size);let offset=0;for(const b of chunks){joined.set(b,offset);offset+=b.byteLength;}
      const result=JSON.parse(new TextDecoder().decode(joined));check(e);return result;
    }finally{cancel(timeout);c.abort();if(flight===c)flight=null;}
  };
  const prompt=(role,nonce,e)=>renderGoogle({role,nonce,callback:async response=>{
    let credential=response?.credential;if(response&&typeof response==='object')try{response.credential=undefined;}catch{}
    if(e!==epoch||phase!==role){credential=null;return false;}
    try{
      check(e);if(!token(credential))throw Error('CREDENTIAL');
      if(role==='ENTRY'){
        bootstrap=credential;credential=null;emit('CHECKING','Conferindo a conta de auditoria…');
        const result=await request({action:'CHALLENGE',signedApproval:signed.record},e);check(e);if(!challengeValid(result,now())||result.expiresAtMs>signed.record.expiresAtMs)throw Error('CHALLENGE');
        challenge=result;expiry=Math.min(expiry,result.expiresAtMs);arm(e);
        emit('BUYER','Escolha a conta do comprador.');prompt('BUYER',result.buyerNonce,e);
      }else if(role==='BUYER'){
        buyer=credential;credential=null;emit('OPERATOR','Confirme novamente a conta de auditoria.');prompt('OPERATOR',challenge.operatorNonce,e);
      }else{
        const body={action:'INSTALL',challengeId:challenge.challengeId,buyerIdToken:buyer,operatorIdToken:credential};
        buyer=null;credential=null;emit('CHECKING','Conferindo identidades, vínculo e plano…');let result;
        try{result=await request(body,e);}finally{body.buyerIdToken=null;body.operatorIdToken=null;}
        check(e);if(!receiptValid(result,signed))throw Error('RECEIPT');const until=signed.record.expiresAtMs;erase();expiry=until;arm(e);
        emit('PASSED','Aprovação registrada. Esta etapa não criou ordem Pix nem liberou Premium. O prazo do arquivo continua valendo.');
      }
      return true;
    }catch{credential=null;if(e===epoch)fail();return false;}
  }});

  return Object.freeze({
    async loadFile(text){
      epoch++;erase();const e=epoch;emit('CHECKING','Conferindo o escopo do arquivo…');
      try{const file=await validateSignedApproval(text,now());
        if(e!==epoch)return false;if(file.record.expiresAtMs<=now())throw Error('EXPIRED');
        signed=file;emit('READY','Arquivo carregado para conferência. O servidor verificará a assinatura.');return true;
      }catch{if(e===epoch)fail();return false;}
    },
    start(){
      if(phase!=='READY'||!signed)return false;
      if(signed.record.expiresAtMs<=now()){reset('O arquivo venceu. Prepare e assine uma nova proposta.');return false;}
      const file=signed;epoch++;erase();signed=file;const e=epoch;
      expiry=Math.min(now()+300000,file.record.expiresAtMs);arm(e);
      emit('ENTRY','Entre com a conta selecionada para auditoria.');
      try{prompt('ENTRY',entryNonce(),e);return true;}catch{fail();return false;}
    },reset,
    checkExpiry(){
      if((signed&&signed.record.expiresAtMs<=now())||(!['READY','FAILED','EXPIRED'].includes(phase)&&expiry<=now())){
        epoch++;erase();emit('EXPIRED','O prazo terminou. Use um arquivo válido e confirme novamente.',true);
      }
    },
    snapshot:()=>Object.freeze({phase,hasCredentials:Boolean(bootstrap||buyer),hasChallenge:Boolean(challenge),hasSignedFile:Boolean(signed)})
  });
}

function boot(){
  const get=id=>document.getElementById(id),slot=get('google-slot');let googleReady=false,fileEpoch=0;
  const copy={READY:['ARQUIVO','Carregue a aprovação assinada','Selecione o arquivo JSON produzido pela conta de auditoria.'],
    ENTRY:['1 DE 3','Identificar a auditoria','Use a conta selecionada para auditoria.'],
    BUYER:['2 DE 3','Identificar o comprador','Use a conta selecionada para realizar o piloto.'],
    OPERATOR:['3 DE 3','Confirmar a auditoria','Ela deve ser diferente da conta do comprador.'],
    CHECKING:['CONFERINDO','Aguarde a conferência','Esta etapa registra a aprovação e mantém a emissão do Pix desligada.'],
    PASSED:['REGISTRO CONCLUÍDO','Aprovação registrada','A emissão do Pix será feita na etapa seguinte, dentro do mesmo escopo.'],
    FAILED:['CONFERIR','Registro não confirmado','Confira o arquivo assinado, seu prazo e as contas selecionadas.'],
    EXPIRED:['PRAZO ENCERRADO','Use um arquivo válido','Uma proposta vencida precisa ser preparada e assinada novamente.']};
  const controller=createPilotApprovalInstallController({onState:s=>{
    const c=copy[s.phase];get('step-count').textContent=c[0];get('step-title').textContent=c[1];get('step-description').textContent=c[2];
    get('status').textContent=s.message;get('status').dataset.error=String(s.error);slot.replaceChildren();
    get('file-area').hidden=!['READY','FAILED','EXPIRED'].includes(s.phase);
    get('start').hidden=s.phase!=='READY';get('start').disabled=!googleReady||!s.hasSignedFile;
    get('cancel').hidden=s.phase==='READY'&&!s.hasSignedFile;
  },renderGoogle:({nonce,callback})=>{
    if(!googleReady)throw Error('UNAVAILABLE');const id=window.google.accounts.id;id.disableAutoSelect();
    id.initialize({client_id:GOOGLE_CLIENT_ID,nonce,callback,auto_select:false,button_auto_select:false,
      use_fedcm_for_button:true,ux_mode:'popup',cancel_on_tap_outside:true});
    id.renderButton(slot,{theme:'outline',size:'large',shape:'pill',text:'continue_with',
      width:Math.min(320,Math.max(200,slot.clientWidth)),logo_alignment:'left'});
  }});
  const reset=message=>{fileEpoch++;get('signed-file').value='';controller.reset(message);};
  get('signed-file').addEventListener('change',async()=>{
    const file=get('signed-file').files?.[0],e=++fileEpoch;controller.reset('');
    if(!file||file.size>8192){get('signed-file').value='';get('status').textContent='Selecione um arquivo JSON de até 8 KB.';return;}
    try{const text=await file.text();if(e!==fileEpoch)return;
      await controller.loadFile(text);if(e===fileEpoch)get('signed-file').value='';
    }catch{if(e===fileEpoch)reset('Não foi possível ler o arquivo.');}
  });
  get('start').addEventListener('click',()=>controller.start());
  get('cancel').addEventListener('click',()=>reset());
  window.addEventListener('pagehide',()=>reset(''));
  window.addEventListener('pageshow',e=>{if(e.persisted)reset('Carregue novamente um arquivo válido.');});
  document.addEventListener('visibilitychange',()=>controller.checkExpiry());
  window.addEventListener('escudofit:accountChanged',()=>reset('A conta mudou.'));
  window.addEventListener('storage',e=>{if(e.key==='escudofit_web_auth_v1')reset('A conta mudou.');});
  const started=Date.now();const load=()=>{
    if(window.google?.accounts?.id){googleReady=true;get('start').disabled=!controller.snapshot().hasSignedFile;
      if(controller.snapshot().phase==='READY'&&!controller.snapshot().hasSignedFile)get('status').textContent='Selecione a aprovação assinada.';return;}
    if(Date.now()-started>=10000){get('status').textContent='O login Google não carregou. Reabra a página.';return;}setTimeout(load,200);
  };load();
}
if(typeof window!=='undefined'&&typeof document!=='undefined')boot();
