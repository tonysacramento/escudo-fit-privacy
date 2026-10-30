import {cancellationTransport,cancellationController} from './cancellation-client.mjs?v=20261030-request-1';
const $=id=>document.getElementById(id);
const messages={SIGN_IN_REQUIRED:'Entre com a mesma Conta Google no Escudo Fit e volte a esta página.',
  SESSION_CHANGED:'A conta foi alterada. Consulte novamente para continuar com a conta atual.',
  PILOT_UNAVAILABLE:'Não foi possível localizar uma compra disponível neste canal agora. Nenhum novo pedido foi confirmado. Você pode consultar novamente ou solicitar pelo suporte.',
  REQUEST_UNCONFIRMED:'Não foi possível confirmar o pedido. Consulte novamente antes de reenviar; nenhum reembolso foi confirmado.'};
let busy=false,controller;
const view={
  clear(){ $('purchase').hidden=true;$('receipt').hidden=true;$('confirm').checked=false;$('submit').disabled=true; },
  busy(value){busy=value;$('refresh').disabled=value;$('submit').disabled=value||!$('confirm').checked;},
  purchase(p){$('amount').textContent=Number(p.amountBRL).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    $('participant').textContent=p.participantId;
    $('validUntil').textContent=new Date(p.premiumUntil).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília)';
    $('purchase').hidden=false;$('status').textContent='Confira a compra antes de confirmar a solicitação.';},
  receipt(r){$('purchase').hidden=true;$('receipt').hidden=false;$('protocol').textContent=r.protocol;
    $('receivedAt').textContent=new Date(r.receivedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília)';
    $('status').textContent='Pedido recebido para análise. O reembolso ainda não foi executado.';},
  error(code){$('status').textContent=messages[code]||messages.REQUEST_UNCONFIRMED;},
};
const transport=cancellationTransport({storage:localStorage,onAccountChange:()=>controller?.reset()});
controller=cancellationController({transport,view,keyStorage:localStorage});
$('confirm').addEventListener('change',()=>{$('submit').disabled=busy||!$('confirm').checked;});
$('submit').addEventListener('click',()=>void controller.submit($('confirm').checked));
$('refresh').addEventListener('click',()=>void controller.load());
window.addEventListener('storage',event=>{
  if(event.key==='escudofit_web_auth_v1'){controller.reset();view.error('SESSION_CHANGED');}
});
void controller.load();
