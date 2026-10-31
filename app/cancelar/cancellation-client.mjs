const AUTH_KEY='escudofit_web_auth_v1';
const AUTH_API='https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38';
const API='https://escudo-fit-cancellation-requests-835029473980.us-central1.run.app/api/v38';
const PATH='/payments/cancellations';
const protocol=/^EF-CANCEL-[a-f0-9]{24}$/;
const hex=/^[a-f0-9]{64}$/;
export const REFUND_STATUS_VERSION=1;
export function cancellationReceiptText(r){
  if(!validCancellationReceipt(r))throw Error('REQUEST_UNCONFIRMED');
  return {
    REQUEST_RECEIVED:{title:'Pedido recebido',label:'Recebido para análise',
      message:'Pedido recebido para análise. O reembolso ainda não foi executado.',
      detail:'O recebimento do pedido não comprova que o dinheiro já foi devolvido. O processamento financeiro é uma etapa separada.'},
    REFUND_PROCESSING:{title:'Reembolso em processamento',label:'Aguardando confirmação financeira',
      message:'O processamento foi iniciado. A devolução ainda não está confirmada.',
      detail:'Consulte este mesmo protocolo para acompanhar. Não é necessário abrir outro pedido.'},
    REFUND_CONFIRMED:{title:'Devolução confirmada',label:'Finalização do acesso pendente',
      message:'A devolução integral de R$ 4,99 foi confirmada pelo Mercado Pago.',
      detail:'O encerramento do acesso referente a esta compra ainda está sendo finalizado. Consulte novamente este protocolo.'},
    REFUND_COMPLETED:{title:'Reembolso concluído',label:'Concluído',
      message:'Reembolso integral de R$ 4,99 concluído.',
      detail:'A devolução foi confirmada pelo Mercado Pago e o acesso Premium referente a esta compra foi encerrado. Seu histórico foi preservado.'},
  }[r.status];
}
export function validCancellationReceipt(r) {
  const received=r?.status==='REQUEST_RECEIVED'&&r.eligibility==='PENDING_REVIEW'&&
    r.refundExecuted===false&&r.entitlementChanged===false;
  const processing=r?.status==='REFUND_PROCESSING'&&r.eligibility==='APPROVED'&&
    r.refundExecuted===false&&r.entitlementChanged===false&&r.refundId===null&&
    r.refundedAt===null&&r.accessCompensation==='PENDING';
  const confirmed=['REFUND_CONFIRMED','REFUND_COMPLETED'].includes(r?.status)&&r.eligibility==='APPROVED'&&
    r.refundExecuted===true&&/^[1-9]\d*$/.test(r.refundId||'')&&
    typeof r.refundedAt==='string'&&Number.isFinite(Date.parse(r.refundedAt))&&
    (r.status==='REFUND_COMPLETED'?r.entitlementChanged===true&&r.accessCompensation==='COMPLETED':
      r.entitlementChanged===false&&r.accessCompensation==='PENDING'||
      r.entitlementChanged===true&&r.accessCompensation==='PUBLICATION_PENDING');
  return Boolean(r && (received||processing||confirmed) && protocol.test(r.protocol||'') && hex.test(r.caseId||'') &&
    r.protocol==='EF-CANCEL-'+r.caseId.slice(0,24) &&
    typeof r.receivedAt==='string' &&
    Number.isFinite(Date.parse(r.receivedAt)) && r.amountBRL==='4.99' && r.currency==='BRL' &&
    hex.test(r.acknowledgementDigest||''));
}
export function cancellationTransport({storage,fetchImpl=fetch,onAccountChange=()=>{}}) {
  const read=()=>{try{return JSON.parse(storage.getItem(AUTH_KEY)||'null');}catch{return null;}};
  const changed=uid=>{if(read()?.user?.id!==uid){onAccountChange();throw Error('SESSION_CHANGED');}};
  return {
    session:read,
    async request(path,options={}) {
      if(![PATH,PATH+'/current'].includes(path))throw Error('REQUEST_UNCONFIRMED');
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
export function cancellationController({transport,view,keyStorage,newKey=()=>crypto.randomUUID()}) {
  let purchase=null,receipt=null,busy=false,identity=null;
  const clear=()=>{purchase=null;receipt=null;identity=null;view.clear();};
  const sameAccount=()=>{if(transport.session()?.user?.id!==identity){clear();throw Error('SESSION_CHANGED');}};
  const error=e=>view.error(e?.message||'REQUEST_UNCONFIRMED');
  return {
    reset:clear,
    async load() {
      if(busy)return;busy=true;clear();identity=transport.session()?.user?.id;view.busy(true);
      try {
        const result=await transport.request(PATH+'/current');sameAccount();
        if(!/^EF-[a-f0-9-]{36}$/.test(result.purchase?.orderId||'')||
          result.purchase.amountBRL!=='4.99'||result.purchase.currency!=='BRL')throw Error('REQUEST_UNCONFIRMED');
        purchase=result.purchase;
        if(result.request) {
          if(!validCancellationReceipt(result.request)||result.request.orderId!==purchase.orderId||
            result.refundExecuted!==result.request.refundExecuted||
            result.entitlementChanged!==result.request.entitlementChanged)throw Error('REQUEST_UNCONFIRMED');
          receipt=result.request;view.receipt(receipt);
        } else {
          if(result.refundExecuted!==false||result.entitlementChanged!==false)throw Error('REQUEST_UNCONFIRMED');
          view.purchase(purchase);
        }
      } catch(e){clear();error(e);}finally{busy=false;view.busy(false);}
    },
    async submit(confirmed) {
      if(busy||receipt||!purchase||confirmed!==true)return;
      busy=true;view.busy(true);
      try {
        sameAccount();
        const namespace='escudofit_cancellation_request_v1:'+identity+':'+purchase.orderId;
        let requestKey=keyStorage.getItem(namespace);
        if(!requestKey){requestKey=newKey();keyStorage.setItem(namespace,requestKey);}
        const result=await transport.request(PATH,{method:'POST',body:JSON.stringify({
          orderId:purchase.orderId,requestKey,confirm:true})});
        sameAccount();
        if(!validCancellationReceipt(result)||result.orderId!==purchase.orderId)throw Error('REQUEST_UNCONFIRMED');
        receipt=result;view.receipt(receipt);
      } catch(e){error(e);}finally{busy=false;view.busy(false);}
    },
  };
}
