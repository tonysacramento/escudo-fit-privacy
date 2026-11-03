import {cancellationTransport,cancellationController,cancellationReceiptText} from './cancellation-client.mjs?v=20261102-refund-2';
const $=id=>document.getElementById(id);
const messages={SIGN_IN_REQUIRED:'Entre com a mesma Conta Google no Escudo Fit e volte a esta página.',
  SESSION_CHANGED:'A conta foi alterada. Consulte novamente para continuar com a conta atual.',
  PILOT_UNAVAILABLE:'Não foi possível localizar uma compra disponível neste canal agora. Nenhum novo pedido foi confirmado. Você pode consultar novamente ou solicitar pelo suporte.',
  REQUEST_UNCONFIRMED:'Não foi possível confirmar o pedido. Consulte novamente antes de reenviar; nenhum reembolso foi confirmado.'};
let busy=false,controller;
const view={
  clear(){ $('purchase').hidden=true;$('receipt').hidden=true;$('refundFinancial').hidden=true;$('accessSnapshot').hidden=true;
    $('purchaseSelection').hidden=true;$('purchasePicker').replaceChildren();$('confirm').checked=false;$('submit').disabled=true; },
  busy(value){busy=value;$('refresh').disabled=value;$('purchasePicker').disabled=value;$('submit').disabled=value||!$('confirm').checked;},
  purchases(items,selectedId,truncated){
    $('purchasePicker').replaceChildren();
    for(const p of items){const option=document.createElement('option');option.value=p.orderId;
      option.textContent=(p.planKey==='yearly'?'12 meses':'30 dias')+' — R$ '+Number(p.amountBRL).toFixed(2).replace('.',',')+
        ' — compra '+p.orderId.slice(-8);option.selected=p.orderId===selectedId;$('purchasePicker').append(option);}
    $('purchaseSelection').hidden=items.length<2&&!truncated;$('purchaseTruncated').hidden=!truncated;
  },
  purchase(p){$('amount').textContent=Number(p.amountBRL).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    $('purchasePlan').textContent=p.planKey==='yearly'?'Plano pré-pago de 12 meses':'Plano pré-pago de 30 dias';
    $('orderReference').textContent=p.orderId;
    $('participant').textContent=p.participantId;
    $('validUntil').textContent=new Date(p.premiumUntil).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília)';
    $('purchase').hidden=false;$('status').textContent='Confira a compra antes de confirmar a solicitação.';},
  receipt(r){$('purchase').hidden=true;$('receipt').hidden=false;$('protocol').textContent=r.protocol;
    $('receiptOrderReference').textContent=r.orderId;
    $('receivedAt').textContent=new Date(r.receivedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília)';
    const text=cancellationReceiptText(r);
    $('receiptTitle').textContent=text.title;$('receiptState').textContent=text.label;
    $('status').textContent=text.message;$('receiptDetail').textContent=text.detail;
    $('refundFinancial').hidden=!r.refundExecuted;
    $('refundId').textContent=r.refundExecuted?r.refundId:'';
    $('numericRefund').hidden=!r.refundExecuted||!r.numericRefundId;
    $('numericRefundId').textContent=r.numericRefundId||'';
    $('refundedAt').textContent=r.refundExecuted?new Date(r.refundedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília)':'';
    $('accessSnapshot').hidden=r.refundStatusVersion!==2||r.status!=='REFUND_COMPLETED';
    if(!$('accessSnapshot').hidden)$('accessSnapshotAt').textContent=new Date(r.accessSnapshotAt)
      .toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília)';},
  error(code){$('status').textContent=messages[code]||messages.REQUEST_UNCONFIRMED;},
};
const transport=cancellationTransport({storage:localStorage,onAccountChange:()=>controller?.reset()});
controller=cancellationController({transport,view,keyStorage:localStorage,discoverCustomerPurchases:true});
$('purchasePicker').addEventListener('change',()=>controller.selectOrder($('purchasePicker').value));
$('confirm').addEventListener('change',()=>{$('submit').disabled=busy||!$('confirm').checked;});
$('submit').addEventListener('click',()=>void controller.submit($('confirm').checked));
$('refresh').addEventListener('click',()=>void controller.load());
window.addEventListener('storage',event=>{
  if(event.key==='escudofit_web_auth_v1'){controller.reset();view.error('SESSION_CHANGED');}
});
void controller.load();

