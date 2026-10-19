export const PREVIEW_API='https://pilot-pix---escudo-fit-api-v38-olb3tmj35q-uc.a.run.app/api/v38/pilot-pix/preview';
export const GOOGLE_CLIENT_ID='835029473980-22hokuuman3rpbiefs54gg1ntnqu6lc7.apps.googleusercontent.com';
const PURPOSE='ESCUDO_FIT_NONFINANCIAL_APPROVAL_PREVIEW_V1';
const KEY='projects/escudo-fitclima/locations/us-central1/keyRings/escudo-fit-approvals/cryptoKeys/first-live-pilot-operator/cryptoKeyVersions/1';
const FINGERPRINT='47a836a4284792962d0c3bd3ddcb55e6514a0a84b6e40c55a15e4db638210610';
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
const challengeValid=(v,now)=>exact(v,['state','purpose','challengeId','buyerNonce','operatorNonce','expiresAtMs',...noFinanceFields])&&
  v.state==='CHALLENGE'&&v.purpose===PURPOSE&&/^[A-Za-z0-9_-]{43}$/.test(v.challengeId)&&
  /^ef-preview-buyer-v1-[A-Za-z0-9_-]{43}$/.test(v.buyerNonce)&&/^ef-preview-operator-v1-[A-Za-z0-9_-]{43}$/.test(v.operatorNonce)&&
  Number.isSafeInteger(v.expiresAtMs)&&v.expiresAtMs>now&&v.expiresAtMs<=now+300000&&noFinance(v);

export async function validatePreviewResponse(v,now=Date.now()) {
  const flags=['googleSignaturesVerified','noncesVerified','identitiesDistinct','freshIdentitiesVerified','challengeConsumed','canonicalBuyerVerified'];
  if(!exact(v,['state','purpose','proposal','scopeDigest',...flags,...noFinanceFields])||v.state!=='UNSIGNED_APPROVAL_PROPOSAL'||
    v.purpose!==PURPOSE||!noFinance(v)||!flags.every(k=>v[k]===true)||!exact(v.proposal,['schemaVersion','keyVersion','keyFingerprint','record']))throw Error('INVALID');
  const p=v.proposal,r=p.record;
  if(p.schemaVersion!==1||p.keyVersion!==KEY||p.keyFingerprint!==FINGERPRINT||!exact(r,fields)||r.schemaVersion!==1||
    !uuid.test(r.approvalId)||r.scope!=='FIRST_LIVE_PIX_SINGLE_ORDER'||r.state!=='APPROVED_SINGLE_PILOT'||
    r.approvedBySubjectHash!==OPERATOR||r.subjectHash===OPERATOR||
    !['subjectHash','bindingDigest','requestKeyHash'].every(k=>/^[a-f0-9]{64}$/.test(r[k]))||
    r.receiverAccountId!=='13926970'||r.maxAmountBRL!=='4.99'||r.currency!=='BRL'||r.maxOrders!==1||
    r.planKey!=='monthly'||r.channel!=='WEB_OFFICIAL_DIRECT'||r.termsVersion!==TERMS||
    !Number.isSafeInteger(r.issuedAtMs)||r.issuedAtMs<=0||r.issuedAtMs>now+60000||r.issuedAtMs<now-300000||
    !Number.isSafeInteger(r.expiresAtMs)||r.expiresAtMs<=now||r.expiresAtMs<=r.issuedAtMs||r.expiresAtMs>r.issuedAtMs+1800000)throw Error('INVALID');
  const h=(await sha('ESCUDO_FIT_PILOT_REQUEST_KEY_V1|'+r.approvalId)).slice(0,32).split('');
  h[12]='4';h[16]=((parseInt(h[16],16)&3)|8).toString(16);const key=h.join('');
  const requestKey=`${key.slice(0,8)}-${key.slice(8,12)}-${key.slice(12,16)}-${key.slice(16,20)}-${key.slice(20)}`;
  const payload=JSON.stringify(['ESCUDO_FIT_FIRST_LIVE_APPROVAL_V1','escudo-fitclima','escudo-fit-payments-commercial',
    r.schemaVersion,r.approvalId,r.scope,r.approvedBySubjectHash,r.subjectHash,r.bindingDigest,r.requestKeyHash,
    r.receiverAccountId,r.maxAmountBRL,r.currency,r.maxOrders,r.planKey,r.channel,r.termsVersion,r.issuedAtMs,r.expiresAtMs]);
  if(r.requestKeyHash!==await sha(requestKey)||v.scopeDigest!==await sha(payload))throw Error('INVALID');
  return Object.freeze({...p,record:Object.freeze({...r})});
}

/** Explicit Google callbacks; no product session, storage, token decoding or retry. */
export function createPilotPreviewController({fetchImpl=fetch,now=Date.now,schedule=setTimeout,cancel=clearTimeout,
  renderGoogle,onState=()=>{},entryNonce=()=>{
    const b=new Uint8Array(32);crypto.getRandomValues(b);return 'ef-preview-entry-v1-'+Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
  }}={}) {
  let phase='READY',epoch=0,bootstrap=null,buyer=null,challenge=null,proposal=null,expiry=0,timer=null,flight=null;
  const emit=(p,message='',error=false)=>{phase=p;onState(Object.freeze({phase:p,message,error,hasProposal:Boolean(proposal)}));};
  const erase=()=>{bootstrap=null;buyer=null;challenge=null;proposal=null;expiry=0;cancel(timer);timer=null;flight?.abort();flight=null;};
  const reset=(message='Prévia cancelada. Os dados desta página foram descartados.')=>{epoch++;erase();emit('READY',message);};
  const fail=()=>{epoch++;erase();emit('FAILED','Não foi possível preparar. Confira as contas e inicie uma nova prévia.',true);};
  const check=e=>{if(e!==epoch||expiry<=now())throw Error('STALE');};
  const arm=e=>{cancel(timer);timer=schedule(()=>{if(e===epoch){epoch++;erase();emit('EXPIRED','O prazo terminou. Prepare uma nova proposta.',true);}},Math.max(0,expiry-now()));};
  const request=async(body,e)=>{
    check(e);const c=new AbortController();flight=c;const timeout=schedule(()=>c.abort(),28000);
    try{
      const response=await fetchImpl(PREVIEW_API,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',
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
        const result=await request({action:'CHALLENGE'},e);check(e);if(!challengeValid(result,now()))throw Error('CHALLENGE');
        challenge=result;expiry=Math.min(expiry,result.expiresAtMs);arm(e);
        emit('BUYER','Escolha a conta do comprador.');prompt('BUYER',result.buyerNonce,e);
      }else if(role==='BUYER'){
        buyer=credential;credential=null;emit('OPERATOR','Confirme novamente a conta de auditoria.');prompt('OPERATOR',challenge.operatorNonce,e);
      }else{
        const body={action:'PREVIEW',challengeId:challenge.challengeId,buyerIdToken:buyer,operatorIdToken:credential};
        buyer=null;credential=null;emit('CHECKING','Conferindo identidades, vínculo e plano…');let result;
        try{result=await request(body,e);}finally{body.buyerIdToken=null;body.operatorIdToken=null;}
        const checked=await validatePreviewResponse(result,now());check(e);erase();proposal=checked;expiry=checked.record.expiresAtMs;arm(e);
        emit('PASSED','Proposta sem assinatura pronta. Nenhuma aprovação financeira, cobrança ou liberação de Premium foi realizada.');
      }
      return true;
    }catch{credential=null;if(e===epoch)fail();return false;}
  }});
  return Object.freeze({start(){epoch++;erase();const e=epoch;expiry=now()+300000;arm(e);emit('ENTRY','Entre com a conta selecionada para auditoria.');
      try{prompt('ENTRY',entryNonce(),e);}catch{fail();}},reset,
    checkExpiry(){if(!['READY','FAILED','EXPIRED'].includes(phase)&&expiry<=now()){epoch++;erase();emit('EXPIRED','O prazo terminou. Prepare novamente.',true);}},
    getDownload(){if(phase!=='PASSED'||!proposal||expiry<=now()){this.checkExpiry();return null;}
      return Object.freeze({filename:'escudo-fit-proposta-sem-assinatura-'+proposal.record.approvalId+'.json',contents:JSON.stringify(proposal,null,2)+'\n'});},
    snapshot:()=>Object.freeze({phase,hasCredentials:Boolean(bootstrap||buyer),hasChallenge:Boolean(challenge),hasProposal:Boolean(proposal)})});
}

function boot(){
  const get=id=>document.getElementById(id),slot=get('google-slot');let googleReady=false;
  const copy={READY:['PREPARAÇÃO','Tudo pronto para preparar','Primeiro entre com a conta selecionada para auditoria.'],
    ENTRY:['1 DE 3','Entrar para iniciar a prévia','Use a conta selecionada para auditoria.'],
    BUYER:['2 DE 3','Identificar o comprador','Escolha a conta selecionada para realizar o piloto.'],
    OPERATOR:['3 DE 3','Confirmar a conta de auditoria','Ela deve ser diferente da conta do comprador.'],
    CHECKING:['VERIFICANDO','Aguarde a preparação','Mantenha esta página aberta. Nenhuma cobrança será criada.'],
    PASSED:['PRÉVIA CONCLUÍDA','Proposta pronta para baixar','O arquivo não tem assinatura e vale por até 30 minutos. Guarde-o apenas para a revisão do piloto.'],
    FAILED:['TENTAR NOVAMENTE','Prévia não concluída','Confira as contas selecionadas e tente novamente.'],
    EXPIRED:['PRAZO ENCERRADO','Prepare uma nova proposta','Os dados transitórios desta página foram descartados.']};
  const controller=createPilotPreviewController({onState:s=>{
    const c=copy[s.phase];get('step-count').textContent=c[0];get('step-title').textContent=c[1];get('step-description').textContent=c[2];
    get('status').textContent=s.message;get('status').dataset.error=String(s.error);slot.replaceChildren();
    get('start').hidden=!['READY','FAILED','EXPIRED','PASSED'].includes(s.phase);get('start').disabled=!googleReady;
    get('start').textContent=s.phase==='READY'?'Preparar proposta':'Nova prévia';
    get('download').hidden=s.phase!=='PASSED';get('download').disabled=!s.hasProposal;
    get('cancel').hidden=['READY','FAILED','EXPIRED'].includes(s.phase);
  },renderGoogle:({nonce,callback})=>{
    if(!googleReady)throw Error('UNAVAILABLE');const id=window.google.accounts.id;id.disableAutoSelect();
    id.initialize({client_id:GOOGLE_CLIENT_ID,nonce,callback,auto_select:false,button_auto_select:false,
      use_fedcm_for_button:true,ux_mode:'popup',cancel_on_tap_outside:true});
    id.renderButton(slot,{theme:'outline',size:'large',shape:'pill',text:'continue_with',width:Math.min(320,Math.max(200,slot.clientWidth)),logo_alignment:'left'});
  }});
  get('start').addEventListener('click',()=>controller.start());get('cancel').addEventListener('click',()=>controller.reset());
  get('download').addEventListener('click',()=>{const file=controller.getDownload();if(!file)return;
    const url=URL.createObjectURL(new Blob([file.contents],{type:'application/json'})),a=document.createElement('a');
    a.href=url;a.download=file.filename;a.hidden=true;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  window.addEventListener('pagehide',()=>controller.reset(''));window.addEventListener('pageshow',e=>{if(e.persisted)controller.reset('Inicie uma nova prévia.');});
  document.addEventListener('visibilitychange',()=>controller.checkExpiry());window.addEventListener('escudofit:accountChanged',()=>controller.reset('A conta mudou.'));
  window.addEventListener('storage',e=>{if(e.key==='escudofit_web_auth_v1')controller.reset('A conta mudou.');});
  const started=Date.now();const load=()=>{if(window.google?.accounts?.id){googleReady=true;get('start').disabled=false;
    get('start').textContent='Preparar proposta';get('status').textContent='';return;}
    if(Date.now()-started>=10000){get('status').textContent='O login Google não carregou. Reabra a página para tentar novamente.';return;}setTimeout(load,200);};load();
}
if(typeof window!=='undefined'&&typeof document!=='undefined')boot();
