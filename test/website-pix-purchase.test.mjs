import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  createPurchaseController,inspectPurchaseHealth,inspectPurchaseOrder,
  inspectPurchaseReconciliation,PURCHASE_API
} from '../app/comprar/purchase.mjs';

const EF='EF-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JWT='synthetic.access.jwt',GOOGLE='synthetic.google.jwt';
const NOW=Date.UTC(2026,9,24,17,0,0),UUID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const order=(extra={})=>({orderId:EF,requestKey:UUID,planKey:'monthly',amountBRL:'4.99',
  currency:'BRL',status:'AWAITING_PAYMENT',
  checkoutExpiresAt:new Date(NOW+1800000).toISOString(),
  qrCode:'000201'+'8'.repeat(60),premiumActivated:false,...extra});
const health=(extra={})=>({mode:'CONFIGURED',sitePurchaseEnabled:true,
  buyerReconciliationReadEnabled:true,termsVersion:'prepaid-v1-2026-10-16',
  plans:{monthly:{amount:'4.99'},yearly:{amount:'49.90'}},automaticRenewal:false,...extra});
const reconciled=(extra={})=>({orderId:EF,providerOrderId:'ORD01SYNTHETICCOMMERCIAL0000001',
  canonicalStatus:'PENDING',providerState:'EXPIRED_RECONCILIATION_REQUIRED',
  method:'AUTHENTICATED_GET_ONLY',premiumActivated:false,reconciliationWritten:false,...extra});
const response=(data,status=200)=>new Response(JSON.stringify(data),
  {status,headers:{'content-type':'application/json'}});
function harness({existing=null,configured=true,readEnabled=true,postError=false,
  loginError=false,healthError=false,currentError=false,payment=order()}={}){
  const calls=[],events=[],responses=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,method:options.method,body:options.body||null,
      auth:options.headers.authorization||null,
      credentials:options.credentials,redirect:options.redirect});
    if(url.endsWith('/auth/google')){
      if(loginError)return response({code:'AUTH_GOOGLE_TOKEN_INVALID'},401);
      return response({user:{id:'user1',name:'Conta de teste',email:'buyer@example.invalid'},
        access_token:JWT});
    }
    if(url.endsWith('/health')){
      if(healthError)return response({code:'COMMERCIAL_HEALTH_UNAVAILABLE'},503);
      return response(health({
        sitePurchaseEnabled:configured,buyerReconciliationReadEnabled:readEnabled}));
    }
    if(url.endsWith('/orders/current')){
      if(currentError)return response({code:'COMMERCIAL_PAYMENTS_DISABLED'},503);
      return response({order:existing});
    }
    if(url.endsWith('/orders/'+EF+'/reconciliation'))return response(reconciled());
    if(url.endsWith('/orders/'+EF))return response(payment);
    if(url.endsWith('/orders')&&options.method==='POST'){
      if(postError)throw Error('SYNTHETIC_AMBIGUOUS_NETWORK_ERROR');
      return response(payment,201);
    }
    throw Error('UNEXPECTED_URL:'+url);
  };
  const c=createPurchaseController({fetchImpl,now:()=>NOW,newKey:()=>UUID,
    onState:(s,message)=>{events.push({s,message});}});
  return {c,calls,events,responses};
}
test('all values validated: one monthly prepaid Pix; QR expires and does not mean paid',()=>{
  const h=inspectPurchaseHealth(health());
  assert.equal(h.sitePurchaseEnabled,true);
  assert.equal(inspectPurchaseOrder(order(),NOW).qrCode.startsWith('000201'),true);
  assert.equal(inspectPurchaseOrder(order(),NOW+1800000).qrCode,null);
  assert.deepEqual(inspectPurchaseReconciliation(reconciled(),EF),{
    providerState:'EXPIRED_RECONCILIATION_REQUIRED',canonicalStatus:'PENDING'});
  for(const x of [{premiumActivated:true},{status:'PAID'},{amountBRL:'49.90'},
    {orderId:'EF-foreign'},{qrCode:'javascript:bad'}]){
    assert.throws(()=>inspectPurchaseOrder(order(x),NOW));
  }
  assert.throws(()=>inspectPurchaseHealth(health({automaticRenewal:true})));
  assert.throws(()=>inspectPurchaseReconciliation(reconciled({reconciliationWritten:true}),EF));
});
test('old production health response with missing new flags is treated as OFF',()=>{
 const previous=health();
 delete previous.sitePurchaseEnabled;
 delete previous.buyerReconciliationReadEnabled;
 assert.deepEqual(inspectPurchaseHealth(previous),
   {sitePurchaseEnabled:false,buyerReconciliationReadEnabled:false});
 assert.throws(()=>inspectPurchaseHealth(health({sitePurchaseEnabled:'true'})));
});

test('Google profile remains visible/authenticated after commercial API returns HTTP 503',async()=>{
 const h=harness({healthError:true});
 assert.equal(await h.c.signIn(GOOGLE),true);
 const state=h.c.snapshot();
 assert.equal(state.signedIn,true);
 assert.equal(state.account,'buyer@example.invalid');
 assert.equal(state.name,'Conta de teste');
 assert.equal(state.phase,'CHECKOUT_UNAVAILABLE');
 assert.equal(state.canBuy,false);
 assert.equal(state.canRefresh,true);
 assert.match(h.events.at(-1).message,/HTTP 503/);
 assert.equal(await h.c.buy(true),false);
 assert.equal(await h.c.retryPreflight(),false);
 assert.equal(h.c.snapshot().signedIn,true);
 assert.equal(h.c.snapshot().account,'buyer@example.invalid');
 assert.equal(h.calls.filter(x=>x.url.endsWith('/orders')&&x.method==='POST').length,0);
 h.c.signout();
 assert.equal(h.c.snapshot().signedIn,false);
 assert.equal(h.c.snapshot().account,'');
});
test('Google profile is not cleared when current order query fails; retries are GET only',async()=>{
 const h=harness({currentError:true});
 assert.equal(await h.c.signIn(GOOGLE),true);
 assert.equal(h.c.snapshot().account,'buyer@example.invalid');
 assert.equal(h.c.snapshot().phase,'CHECKOUT_UNAVAILABLE');
 assert.equal(h.c.snapshot().canBuy,false);
 assert.equal(await h.c.retryPreflight(),false);
 assert.equal(h.c.snapshot().signedIn,true);
 const current=h.calls.filter(x=>x.url.endsWith('/orders/current'));
 assert.equal(current.length,2);
 assert(current.every(x=>x.method==='GET'));
 assert.equal(h.calls.filter(x=>x.url.endsWith('/orders')&&x.method==='POST').length,0);
});
test('auth failure does not produce a synthetic logged-in profile',async()=>{
 const h=harness({loginError:true});
 assert.equal(await h.c.signIn(GOOGLE),false);
 assert.equal(h.c.snapshot().signedIn,false);
 assert.equal(h.c.snapshot().account,'');
 assert.equal(h.c.snapshot().phase,'AUTH_ERROR');
 assert.match(h.events.at(-1).message,/HTTP 401/);
 assert.equal(h.calls.length,1);
 assert.equal(await h.c.buy(true),false);
});
test('payment API recovery is read-only and only enables purchase after canonical GET',async()=>{
 const requests=[],observed=[];let healthReads=0;
 const controller=createPurchaseController({
   now:()=>NOW,newKey:()=>UUID,
   onState:(state,message)=>observed.push({state,message}),
   fetchImpl:async(url,opts)=>{
     requests.push({url,method:opts.method});
     if(url.endsWith('/auth/google'))return response({
       user:{id:'u',name:'Comprador',email:'buyer@example.invalid'},access_token:JWT});
     if(url.endsWith('/health'))return ++healthReads===1?
       response({code:'TEMPORARY_FAILURE'},503):response(health());
     if(url.endsWith('/orders/current'))return response({order:null});
     throw Error('UNEXPECTED_REMOTE_CALL');
   },
 });
 assert.equal(await controller.signIn(GOOGLE),true);
 assert.equal(controller.snapshot().signedIn,true);
 assert.equal(controller.snapshot().canBuy,false);
 assert.equal(await controller.retryPreflight(),true);
 assert.equal(controller.snapshot().signedIn,true);
 assert.equal(controller.snapshot().canBuy,true);
 assert.equal(requests.filter(x=>x.url.endsWith('/orders/current')).length,1);
 assert.equal(requests.filter(x=>x.url.endsWith('/orders')&&x.method==='POST').length,0);
});

test('page checks GET health + current FIRST, sends only one explicit POST to authenticated backend',async()=>{
  const h=harness();
  assert.equal(h.c.snapshot().canBuy,false);
  assert.equal(await h.c.signIn(GOOGLE),true);
  assert.deepEqual(h.calls.map(x=>x.method),['POST','GET','GET']);
  assert.equal(h.calls[0].url,PURCHASE_API+'/auth/google');
  assert.deepEqual(JSON.parse(h.calls[0].body),{id_token:GOOGLE});
  assert.equal(h.calls[1].url,PURCHASE_API+'/payments/commercial/health');
  assert.equal(h.calls[2].url,PURCHASE_API+'/payments/commercial/orders/current');
  assert.equal(h.c.snapshot().canBuy,true);
  assert.equal(await h.c.buy(false),false);
  assert.equal(h.calls.filter(x=>x.method==='POST').length,1); // Google login only
  assert.equal(await h.c.buy(true),true);
  assert.equal(h.c.snapshot().canBuy,false);
  assert.equal(h.c.snapshot().attempted,true);
  assert.equal(h.c.getPix(),'000201'+'8'.repeat(60));
  assert.equal(await h.c.buy(true),false);
  const buys=h.calls.filter(x=>x.url===PURCHASE_API+'/payments/commercial/orders'&&x.method==='POST');
  assert.equal(buys.length,1);
  assert.deepEqual(JSON.parse(buys[0].body),{planKey:'monthly',
    channel:'WEB_OFFICIAL_DIRECT',acceptedTermsVersion:'prepaid-v1-2026-10-16',
    requestKey:UUID});
  assert.equal(buys[0].auth,'Bearer '+JWT);
  assert.equal(buys[0].credentials,'omit');
  assert.equal(buys[0].redirect,'error');
  assert(!JSON.stringify(h.events).includes(JWT));
  assert(!JSON.stringify(h.events).includes(GOOGLE));
});
test('existing pending order prevents buyer POST, GET reconciliation never updates financial state',async()=>{
  const h=harness({existing:order()});
  assert.equal(await h.c.signIn(GOOGLE),true);
  assert.equal(h.c.snapshot().canBuy,false);
  assert.equal(await h.c.buy(true),false);
  assert.equal(await h.c.refresh(),true);
  assert.equal(h.c.snapshot().provider.providerState,'EXPIRED_RECONCILIATION_REQUIRED');
  assert.equal(h.c.snapshot().provider.canonicalStatus,'PENDING');
  assert.deepEqual(h.calls.filter(x=>x.url.endsWith('/reconciliation'))
    .map(x=>x.method),['GET']);
  assert.equal(h.calls.filter(x=>x.url.endsWith('/orders')&&x.method==='POST').length,0);
  assert.equal(h.c.snapshot().canBuy,false);
});
test('OFF flags prevent buyer POST, including when the read-only API is enabled',async()=>{
  for(const opts of [{configured:false,readEnabled:true},{configured:false,readEnabled:false},
    {configured:true,readEnabled:false}]){
    const h=harness(opts);await h.c.signIn(GOOGLE);
    assert.equal(h.c.snapshot().canBuy,false);
    assert.equal(await h.c.buy(true),false);
    assert.equal(h.calls.filter(x=>x.url.endsWith('/orders')&&x.method==='POST').length,0);
  }
});
test('after ambiguous POST result, no local retry and no Premium award',async()=>{
  const h=harness({postError:true});
  await h.c.signIn(GOOGLE);
  assert.equal(await h.c.buy(true),false);
  assert.equal(h.c.snapshot().attempted,true);
  assert.equal(h.c.snapshot().phase,'OUTCOME_UNCERTAIN');
  assert.equal(await h.c.buy(true),false);
  assert.equal(h.calls.filter(x=>x.url.endsWith('/orders')&&x.method==='POST').length,1);
  assert(!JSON.stringify(h.events).includes('SYNTHETIC_AMBIGUOUS_NETWORK_ERROR'));
  assert.equal(await h.c.refresh(),true); // GET current, not another POST
  assert.equal(h.calls.filter(x=>x.url.endsWith('/orders')&&x.method==='POST').length,1);
});
test('site purchase is a distinct no-index page and landing/app links go to its own URL',()=>{
 const html=readFileSync(new URL('../app/comprar/index.html',import.meta.url),'utf8');
 const main=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const web=readFileSync(new URL('../app/index.html',import.meta.url),'utf8');
 const script=readFileSync(new URL('../app/comprar/purchase.mjs',import.meta.url),'utf8');
 assert.match(html,/noindex,nofollow/);
 assert.match(html,/id="buy"/);assert.match(html,/id="refresh"/);
 assert.match(main,/href="\.\/app\/comprar\/"/);
 assert.match(web,/id="webPremiumPurchase"[^>]+href="\.\/comprar\/"/);
 assert.doesNotMatch(main,/(?:href|action)="https?:\/\/[^"]+mercadopago\.com/);
 assert.doesNotMatch(script,/localStorage|sessionStorage|innerHTML|\bwindow\.open\(/);
});

test('PWA service worker excludes all buyer checkout resources from offline cache',()=>{
 const sw=readFileSync(new URL('../app/sw.js',import.meta.url),'utf8');
 assert.match(sw,/url\.pathname\.startsWith\(new URL\('\.\/comprar\/'/);
 assert.match(sw,/return;/);
 const body=readFileSync(new URL('../app/comprar/index.html',import.meta.url),'utf8');
 assert.match(body,/noindex,nofollow/);
});
