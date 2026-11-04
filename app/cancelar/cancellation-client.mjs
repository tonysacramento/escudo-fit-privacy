const AUTH_KEY='escudofit_web_auth_v1';
const AUTH_API='https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38';
const API='https://escudo-fit-cancellation-requests-835029473980.us-central1.run.app/api/v38';
const PATH='/payments/cancellations';
const CUSTOMER_PATH='/payments/customer-cancellations';
const orderPattern=/^EF-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const protocol=/^EF-CANCEL-[a-f0-9]{24}$/;
const hex=/^[a-f0-9]{64}$/;
export const REFUND_STATUS_VERSION=2;
export function cancellationReceiptText(r){
  if(!validCancellationReceipt(r))throw Error('REQUEST_UNCONFIRMED');
  const money='R$ '+Number(r.amountBRL).toFixed(2).replace('.',',');
  if(r.refundStatusVersion===2&&r.status==='REFUND_COMPLETED')return {
    title:'Reembolso concluído',label:'Concluído',message:'Reembolso integral de '+money+' concluído.',
    detail:'A devolução e a compensação do benefício desta compra foram concluídas. Seu histórico foi preservado. '+
      (r.planAfterRefund==='PREMIUM'?'O período Premium anterior foi preservado até '+
        new Date(r.premiumUntilAfterRefund).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília).':
        'Plano registrado nesta compensação: Free.')+' Confira seu plano atual no Perfil.'};
  return {
    REQUEST_RECEIVED:{title:'Pedido recebido',label:'Recebido para análise',
      message:'Pedido recebido para análise. O reembolso ainda não foi executado.',
      detail:'O recebimento do pedido não comprova que o dinheiro já foi devolvido. O processamento financeiro é uma etapa separada.'},
    REFUND_PROCESSING:{title:'Reembolso em processamento',label:'Aguardando confirmação financeira',
      message:'O processamento foi iniciado. A devolução ainda não está confirmada.',
      detail:'Consulte este mesmo protocolo para acompanhar. Não é necessário abrir outro pedido.'},
    REFUND_CONFIRMED:{title:'Devolução confirmada',label:'Finalização do acesso pendente',
      message:'A devolução integral de '+money+' foi confirmada pelo Mercado Pago.',
      detail:'O encerramento do acesso referente a esta compra ainda está sendo finalizado. Consulte novamente este protocolo.'},
    REFUND_COMPLETED:{title:'Reembolso concluído',label:'Concluído',
      message:'Reembolso integral de '+money+' concluído.',
      detail:'A devolução foi confirmada pelo Mercado Pago e o acesso Premium referente a esta compra foi encerrado. Seu histórico foi preservado.'},
  }[r.status];
}
export function validCancellationReceipt(r) {
  const customer=r?.refundStatusVersion===2;
  if(r?.refundStatusVersion!==undefined&&![1,2].includes(r.refundStatusVersion))return false;
  const refundId=customer?/^REF[A-Z0-9]{12,60}$/.test(r?.refundId||'')&&/^[1-9]\d{0,29}$/.test(r?.numericRefundId||''):
    /^[1-9]\d*$/.test(r?.refundId||'');
  const received=r?.status==='REQUEST_RECEIVED'&&r.eligibility==='PENDING_REVIEW'&&
    r.refundExecuted===false&&r.entitlementChanged===false;
  const processing=r?.status==='REFUND_PROCESSING'&&r.eligibility==='APPROVED'&&
    r.refundExecuted===false&&r.entitlementChanged===false&&r.refundId===null&&
    r.refundedAt===null&&r.accessCompensation==='PENDING';
  const confirmed=['REFUND_CONFIRMED','REFUND_COMPLETED'].includes(r?.status)&&r.eligibility==='APPROVED'&&
    r.refundExecuted===true&&refundId&&
    typeof r.refundedAt==='string'&&Number.isFinite(Date.parse(r.refundedAt))&&
    (r.status==='REFUND_COMPLETED'?r.entitlementChanged===true&&r.accessCompensation==='COMPLETED':
      r.entitlementChanged===false&&r.accessCompensation==='PENDING'||
      r.entitlementChanged===true&&r.accessCompensation==='PUBLICATION_PENDING');
  const finalSnapshot=!customer||r.status!=='REFUND_COMPLETED'||
    typeof r.publishedAt==='string'&&Number.isFinite(Date.parse(r.publishedAt))&&r.accessSnapshotAt===r.publishedAt&&
    (r.planAfterRefund==='FREE'?r.premiumUntilAfterRefund===null:
      r.planAfterRefund==='PREMIUM'&&typeof r.premiumUntilAfterRefund==='string'&&
      Date.parse(r.premiumUntilAfterRefund)>Date.parse(r.publishedAt));
  return Boolean(r && finalSnapshot&&(received||processing||confirmed) && protocol.test(r.protocol||'') && hex.test(r.caseId||'') &&
    r.protocol==='EF-CANCEL-'+r.caseId.slice(0,24) &&
    typeof r.receivedAt==='string' &&
    Number.isFinite(Date.parse(r.receivedAt)) && (customer?['4.99','49.90'].includes(r.amountBRL):r.amountBRL==='4.99') && r.currency==='BRL' &&
    hex.test(r.acknowledgementDigest||''));
}
export function cancellationTransport({storage,fetchImpl=fetch,onAccountChange=()=>{}}) {
  const read=()=>{try{return JSON.parse(storage.getItem(AUTH_KEY)||'null');}catch{return null;}};
  const changed=uid=>{if(read()?.user?.id!==uid){onAccountChange();throw Error('SESSION_CHANGED');}};
  return {
    session:read,
    async request(path,options={}) {
      const selected=path.startsWith(CUSTOMER_PATH+'/purchases/')?path.slice((CUSTOMER_PATH+'/purchases/').length):null;
      if(![PATH,PATH+'/current',CUSTOMER_PATH,CUSTOMER_PATH+'/purchases'].includes(path)&&!orderPattern.test(selected||''))
        throw Error('REQUEST_UNCONFIRMED');
      const start=read(),uid=start?.user?.id;
      if(!uid||!start?.access_token)throw Error('SIGN_IN_REQUIRED');
      const call=token=>fetchImpl(API+path,{...options,cache:'no-store',credentials:'omit',redirect:'error',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
      let response=await call(start.access_token);changed(uid);
      if(response.status===401&&start.refresh_token) {
        const refresh=await fetchImpl(AUTH_API+'/auth/refresh',{method:'POST',cache:'no-store',credentials:'omit',redirect:'error',
          headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:start.refresh_token}),
          signal:AbortSignal.timeout(15000)});
        changed(uid);
        if(!refresh.ok)throw Error('SIGN_IN_REQUIRED');
        const next=await refresh.json();changed(uid);
        const current=read();
        if(current.refresh_token===start.refresh_token) {
          if(typeof next.access_token!=='string'||!next.access_token)throw Error('SIGN_IN_REQUIRED');
          storage.setItem(AUTH_KEY,JSON.stringify({...current,access_token:next.access_token,
            refresh_token:next.refresh_token||current.refresh_token}));
        }
        changed(uid);response=await call(read().access_token);changed(uid);
      }
      if(response.status===401||response.status===403)throw Error('SIGN_IN_REQUIRED');
      if(response.status===503||response.status===404)throw Error('PILOT_UNAVAILABLE');
      if(!response.ok)throw Error('REQUEST_UNCONFIRMED');
      const body=await response.json();changed(uid);return body;
    },
  };
}
export function cancellationController({transport,view,keyStorage,newKey=()=>crypto.randomUUID(),discoverCustomerPurchases=false}) {
  let purchase=null,receipt=null,busy=false,identity=null,entries=[],selected=null,truncated=false;
  const clear=()=>{purchase=null;receipt=null;identity=null;entries=[];selected=null;truncated=false;view.clear();};
  const sameAccount=()=>{if(transport.session()?.user?.id!==identity){clear();throw Error('SESSION_CHANGED');}};
  const error=e=>view.error(e?.message||'REQUEST_UNCONFIRMED');
  const validate=(result,source)=>{
    const p=result?.purchase,r=result?.request,customer=source==='CUSTOMER';
    if(!orderPattern.test(p?.orderId||'')||p.currency!=='BRL'||!/^P-\d{2}$/.test(p.participantId||'')||
      !Number.isFinite(Date.parse(p.premiumUntil))||
      (customer?!['monthly','yearly'].includes(p.planKey)||p.amountBRL!==({monthly:'4.99',yearly:'49.90'})[p.planKey]:
        p.amountBRL!=='4.99'))throw Error('REQUEST_UNCONFIRMED');
    if(r){
      if(!validCancellationReceipt(r)||r.orderId!==p.orderId||r.amountBRL!==p.amountBRL||
        (customer?r.refundStatusVersion!==2:r.refundStatusVersion===2)||
        result.refundExecuted!==r.refundExecuted||result.entitlementChanged!==r.entitlementChanged)
        throw Error('REQUEST_UNCONFIRMED');
    }else if(result.refundExecuted!==false||result.entitlementChanged!==false)throw Error('REQUEST_UNCONFIRMED');
    return {...result,source};
  };
  const show=entry=>{
    selected=entry;purchase=entry.purchase;receipt=entry.request||null;
    view.purchases?.(entries.map(e=>e.purchase),purchase.orderId,truncated);
    if(receipt)view.receipt(receipt);else view.purchase(purchase);
  };
  return {
    reset:clear,
    selectOrder(orderId){
      if(busy)return;
      try{sameAccount();const entry=entries.find(e=>e.purchase.orderId===orderId);
        if(!entry)throw Error('REQUEST_UNCONFIRMED');view.clear();show(entry);
      }catch(e){clear();error(e);}
    },
    async load() {
      if(busy)return;const previous=purchase?.orderId;busy=true;clear();identity=transport.session()?.user?.id;view.busy(true);
      try {
        if(discoverCustomerPurchases){
          try{
            const result=await transport.request(CUSTOMER_PATH+'/purchases');sameAccount();
            if(!Array.isArray(result.purchases)||result.purchases.length>20||typeof result.truncated!=='boolean'||
              result.refundExecutionAvailable!==false)throw Error('REQUEST_UNCONFIRMED');
            entries=result.purchases.map(e=>validate(e,'CUSTOMER'));truncated=result.truncated;
            if(new Set(entries.map(e=>e.purchase.orderId)).size!==entries.length)throw Error('REQUEST_UNCONFIRMED');
          }catch(e){if(e.message!=='PILOT_UNAVAILABLE')throw e;}
        }
        try{const legacy=await transport.request(PATH+'/current');sameAccount();
          const entry=validate(legacy,'LEGACY');
          if(entries.some(e=>e.purchase.orderId===entry.purchase.orderId))throw Error('REQUEST_UNCONFIRMED');
          entries.push(entry);
        }catch(e){if(!discoverCustomerPurchases||e.message!=='PILOT_UNAVAILABLE')throw e;}
        sameAccount();if(!entries.length)throw Error('PILOT_UNAVAILABLE');
        show(entries.find(e=>e.purchase.orderId===previous)||entries[0]);
      } catch(e){clear();error(e);}finally{busy=false;view.busy(false);}
    },
    async submit(confirmed) {
      if(busy||receipt||!purchase||confirmed!==true)return;
      busy=true;view.busy(true);
      try {
        sameAccount();
        const customer=selected?.source==='CUSTOMER';
        const namespace=(customer?'escudofit_cancellation_request_v2:':'escudofit_cancellation_request_v1:')+identity+':'+purchase.orderId;
        let requestKey=keyStorage.getItem(namespace);
        if(!requestKey){requestKey=newKey();keyStorage.setItem(namespace,requestKey);}
        const result=await transport.request(customer?CUSTOMER_PATH:PATH,{method:'POST',body:JSON.stringify({
          orderId:purchase.orderId,requestKey,confirm:true})});
        sameAccount();
        if(!validCancellationReceipt(result)||result.orderId!==purchase.orderId||result.amountBRL!==purchase.amountBRL||
          (customer?result.refundStatusVersion!==2:result.refundStatusVersion===2))throw Error('REQUEST_UNCONFIRMED');
        receipt=result;view.receipt(receipt);
      } catch(e){error(e);}finally{busy=false;view.busy(false);}
    },
  };
}

