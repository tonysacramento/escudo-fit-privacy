(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.EscudoFitPayments=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const BASE='/payments/commercial';
  const TERMS='prepaid-v1-2026-10-16';
  const PLANS={monthly:{amount:'4.99',label:'Premium por 30 dias',price:'R$ 4,99'},
    yearly:{amount:'49.90',label:'Premium por 12 meses',price:'R$ 49,90'}};
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const ORDER=/^EF-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const enabled=data=>data?.mode==='CONFIGURED'&&data.termsVersion===TERMS&&
    ['intakeEnabled','checkoutEnabled','webhookEnabled','workerEnabled','deliveryEnabled',
      'grantsEnabled','canonicalEntitlementEnabled'].every(k=>data[k]===true)&&
    data.plans?.monthly?.amount==='4.99'&&data.plans?.yearly?.amount==='49.90';
  const validOrder=o=>o&&ORDER.test(o.orderId||'')&&PLANS[o.planKey]?.amount===o.amountBRL&&o.currency==='BRL'&&
    ['PREPARING','AWAITING_PAYMENT','RECONCILING','COMMITTED','REVIEW_REQUIRED'].includes(o.status)&&
    (o.status!=='COMMITTED'||Number.isFinite(Date.parse(o.expiresAt||'')))&&
    (!o.qrCode||Number.isFinite(Date.parse(o.checkoutExpiresAt||'')));
  const activeAccess=(ent,now)=>ent?.isActive===true&&
    (ent.mode==='VIP_LIFETIME'||['PREMIUM','VIP_TEMPORARY'].includes(ent.mode)&&Date.parse(ent.expiresAt||'')>now);
  const failureMessage=code=>({
    COMMERCIAL_RENEWAL_TOO_EARLY:'Seu Premium ainda tem um período longo. Consulte a renovação mais perto do término.',
    COMMERCIAL_ADMIN_OR_TRIAL_PROTECTED:'Seu acesso atual está protegido. Fale com o suporte antes de contratar outro plano.',
    COMMERCIAL_CUSTOMER_NOT_ALLOWED:'A compra por Pix ainda não está disponível para esta conta.',
    COMMERCIAL_PROJECTION_REQUIRES_RECONCILIATION:'Precisamos conferir seu acesso antes de outra compra. Fale com o suporte.',
  })[code]||'Não foi possível confirmar a operação. Tente novamente; a mesma compra será consultada.';

  function createController({request,getOwner,getEntitlement=()=>null,refreshEntitlement,
    storage,uuid=()=>globalThis.crypto.randomUUID(),now=Date.now,onState=()=>{},
    schedule=fn=>setTimeout(fn,10000),cancel=clearTimeout}){
    let state={status:'CLOSED',planKey:'monthly',order:null,message:''},generation=0,owner=null,timer=null,openedAt=0;
    const attempts=new Map();
    const key=id=>'escudofit_payment_attempt_v1:'+id;
    const stop=()=>{if(timer!==null)cancel(timer);timer=null;};
    const emit=patch=>{state={...state,...patch};onState({...state});};
    const current=(g,id)=>{
      if(owner&&getOwner()!==owner){close();return false;}
      return generation===g&&owner===id&&getOwner()===id&&state.status!=='CLOSED';
    };
    function remember(attempt){attempts.set(owner,attempt);try{storage?.setItem(key(owner),JSON.stringify(attempt));}catch(_){}return attempt;}
    function attempt(){
      let value=attempts.get(owner);
      if(!value)try{value=JSON.parse(storage?.getItem(key(owner))||'null');}catch(_){}
      if(!UUID.test(value?.requestKey||'')||value.planKey!==state.planKey)value={requestKey:uuid(),planKey:state.planKey};
      if(!UUID.test(value.requestKey))throw Error('REQUEST_KEY_UNAVAILABLE');
      return remember(value);
    }
    async function json(path,options){const response=await request(path,options);const data=await response.json();return {ok:response.ok,data};}
    function queue(){stop();if(now()-openedAt<31*60000&&['AWAITING_PAYMENT','RECONCILING'].includes(state.status))timer=schedule(()=>{void refresh();});}
    async function accept(order,g,id){
      if(!current(g,id))return;
      if(!validOrder(order))throw Error('INVALID_ORDER');
      if(UUID.test(order.requestKey||''))remember({requestKey:order.requestKey,planKey:order.planKey});
      emit({order,planKey:order.planKey});
      if(order.status==='COMMITTED'){
        emit({status:'RECONCILING',message:'Pagamento confirmado. Atualizando seu acesso…'});
        const entitlement=await refreshEntitlement();
        if(!current(g,id))return;
        if(activeAccess(entitlement,now()))emit({status:'COMMITTED',message:'Pagamento confirmado e acesso atualizado.'});
        else emit({status:'RECONCILING',message:'Pagamento confirmado. Seu acesso está sendo atualizado; não faça outro pagamento.'});
      }else if(order.status==='REVIEW_REQUIRED')emit({status:'REVIEW_REQUIRED',message:'Sua compra precisa de conferência. Seu acesso já confirmado permanece preservado. Fale com o suporte.'});
      else if(['PREPARING','AWAITING_PAYMENT'].includes(order.status)&&Date.parse(order.checkoutExpiresAt||'')<=now())
        emit({status:'EXPIRED',message:'O prazo deste Pix terminou. Se você pagou, consulte a confirmação ou fale com o suporte.'});
      else if(order.status==='PREPARING'||order.status==='AWAITING_PAYMENT'&&!order.qrCode)
        emit({status:'READY',message:'Há uma compra em preparação. Continue para recuperar o mesmo Pix.'});
      else emit({status:order.status,message:order.status==='AWAITING_PAYMENT'?
        'Pague pelo aplicativo do seu banco. A confirmação será consultada automaticamente.':'Conferindo o pagamento e atualizando seu acesso…'});
      queue();
    }
    function close(){stop();generation++;owner=null;emit({status:'CLOSED',order:null,message:''});}
    async function open(planKey='monthly'){
      close();owner=getOwner();openedAt=now();const g=generation,id=owner;
      emit({status:'LOADING',planKey:PLANS[planKey]?planKey:'monthly',order:null,message:'Consultando a disponibilidade…'});
      if(!id){emit({status:'SIGNED_OUT',message:'Entre com sua Conta Google para consultar a compra Premium.'});return;}
      if(['TRIAL_14D','VIP_TEMPORARY','VIP_LIFETIME'].includes(getEntitlement()?.mode)){
        emit({status:'PROTECTED',message:'Seu acesso atual está ativo e será preservado. Fale com o suporte para conhecer as opções.'});return;}
      try{
        const health=await json(BASE+'/health');if(!current(g,id))return;
        if(!health.ok||!enabled(health.data)){emit({status:'UNAVAILABLE',message:'A compra por Pix ainda não está disponível. Você pode falar com o suporte.'});return;}
        const pending=await json(BASE+'/orders/current');if(!current(g,id))return;
        if(!pending.ok)throw Error('PENDING_LOOKUP_FAILED');
        if(pending.data.order)await accept(pending.data.order,g,id);
        else {attempt();emit({status:'READY',message:'Escolha seu plano e confirme os termos antes de gerar o Pix.'});}
      }catch(_){if(current(g,id))emit({status:'UNAVAILABLE',message:'Não foi possível consultar a compra agora. Tente novamente mais tarde.'});}
    }
    async function start(accepted){
      if(!['READY','RETRY'].includes(state.status)||!owner||getOwner()!==owner)return false;
      if(accepted!==true){emit({message:'Leia e confirme os termos da compra antes de continuar.'});return false;}
      const g=generation,id=owner;
      try{
        const saved=attempt();emit({status:'CREATING',message:'Preparando a mesma compra com segurança…'});
        const result=await json(BASE+'/orders',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({planKey:state.planKey,requestKey:saved.requestKey,
            channel:'WEB_OFFICIAL_DIRECT',acceptedTermsVersion:TERMS})});
        if(!current(g,id))return false;
        if(!result.ok){emit({status:'RETRY',message:failureMessage(result.data?.code)});return false;}
        await accept(result.data,g,id);return true;
      }catch(_){if(current(g,id))emit({status:'RETRY',message:failureMessage()});return false;}
    }
    async function refresh(){
      stop();const g=generation,id=owner,orderId=state.order?.orderId;
      if(!id||getOwner()!==id){close();return;}
      if(!ORDER.test(orderId||'')||state.status==='CLOSED')return;
      try{const result=await json(BASE+'/orders/'+orderId);if(!current(g,id))return;
        if(!result.ok)throw Error('ORDER_LOOKUP_FAILED');await accept(result.data,g,id);
      }catch(_){if(current(g,id)){emit({message:'A confirmação está demorando. Não faça outro pagamento; você pode consultar novamente.'});queue();}}
    }
    return {open,start,refresh,close,pause:stop,getState:()=>{if(owner&&getOwner()!==owner)close();return {...state};}};
  }

  function mount(options){
    const dialog=document.getElementById('premiumCheckoutDialog');if(!dialog)return null;
    const byId=id=>document.getElementById(id),plan=byId('premiumCheckoutPlan'),terms=byId('premiumCheckoutTerms');
    let lastOrder=null;
    const controller=createController({...options,onState:state=>{
      if(state.status==='CLOSED'){
        lastOrder=null;
        byId('premiumCheckoutQr').value='';byId('premiumCheckoutImage').removeAttribute('src');
        if(dialog.open)dialog.close();return;
      }
      if(!dialog.open){terms.checked=false;dialog.showModal();}
      plan.value=state.planKey;plan.disabled=Boolean(state.order)||state.status==='CREATING';
      byId('premiumCheckoutTitle').textContent=PLANS[state.planKey].label+' — '+PLANS[state.planKey].price;
      byId('premiumCheckoutMessage').textContent=state.message;
      const ready=['READY','RETRY'].includes(state.status);
      byId('premiumCheckoutAccept').hidden=!ready;
      byId('premiumCheckoutCreate').hidden=!ready;
      byId('premiumCheckoutCreate').disabled=!ready||!terms.checked;
      byId('premiumCheckoutLogin').hidden=state.status!=='SIGNED_OUT';
      byId('premiumCheckoutRefresh').hidden=!state.order||state.status==='COMMITTED';
      const expiry=Date.parse(state.order?.estimatedExpiresAt||state.order?.expiresAt||'');
      byId('premiumCheckoutExpiry').textContent=Number.isFinite(expiry)?'Validade prevista até '+new Date(expiry).toLocaleDateString('pt-BR')+'. A data exata aparece após a confirmação.':'';
      const payable=state.status==='AWAITING_PAYMENT'&&typeof state.order?.qrCode==='string'&&
        /^000201/.test(state.order.qrCode)&&state.order.qrCode.length<=8192;
      byId('premiumCheckoutPayment').hidden=!payable;
      byId('premiumCheckoutQr').value=payable?state.order.qrCode:'';
      const image=byId('premiumCheckoutImage'),base64=payable?state.order.qrCodeBase64:null;
      image.hidden=!(typeof base64==='string'&&base64.length<=180000&&/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(base64));
      if(image.hidden)image.removeAttribute('src');else image.src='data:image/png;base64,'+base64;
      lastOrder=payable?state.order:null;
    }});
    terms.addEventListener('change',()=>{byId('premiumCheckoutCreate').disabled=!terms.checked;});
    plan.addEventListener('change',()=>{void controller.open(plan.value);});
    byId('premiumCheckoutCreate').addEventListener('click',()=>{void controller.start(terms.checked);});
    byId('premiumCheckoutRefresh').addEventListener('click',()=>{void controller.refresh();});
    byId('premiumCheckoutLogin').addEventListener('click',()=>{const selected=controller.getState().planKey;controller.close();options.showLogin(selected);});
    byId('premiumCheckoutClose').addEventListener('click',()=>controller.close());
    dialog.addEventListener('cancel',()=>controller.close());
    byId('premiumCheckoutCopy').addEventListener('click',async()=>{
      if(!lastOrder||controller.getState().status!=='AWAITING_PAYMENT')return;
      try{await navigator.clipboard.writeText(lastOrder.qrCode);byId('premiumCheckoutMessage').textContent='Código Pix copiado. Confira os dados no aplicativo do banco antes de pagar.';}
      catch(_){byId('premiumCheckoutQr').select();}
    });
    document.querySelectorAll('[data-premium-plan]').forEach(button=>button.addEventListener('click',event=>{
      event.preventDefault();void controller.open(button.dataset.premiumPlan);
    }));
    window.addEventListener('escudofit:accountChanged',()=>controller.close());
    window.addEventListener('pagehide',()=>controller.close());
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')controller.pause();else if(dialog.open)void controller.refresh();});
    const selected=new URL(location.href).searchParams.get('premium');
    if(PLANS[selected])void controller.open(selected);
    return controller;
  }
  return {createController,mount};
});
