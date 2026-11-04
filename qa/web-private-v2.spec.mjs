import {test,expect} from '@playwright/test';
const API='https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/private-pilot-v2';
const ORDER='EF-4d7923e9-d058-4221-918a-502011da1fbd';
const GOOGLE=`window.google={accounts:{id:{disableAutoSelect(){},initialize(v){window.syntheticGsi=v;},renderButton(slot){const b=document.createElement('button');b.textContent='Google do ensaio';b.onclick=()=>window.syntheticGsi.callback({credential:'synthetic.buyer.token'});slot.append(b);}}}};`;
for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  test.describe(viewport.width+'px',()=>{
    test.use({viewport,locale:'pt-BR',timezoneId:'America/Sao_Paulo'});
    test('one purchase, owned QR and canonical access/mail states; no LIVE calls',async({page})=>{
      let issued=0,paid=false;
      await page.route('https://accounts.google.com/gsi/client',r=>r.fulfill({contentType:'application/javascript',body:GOOGLE}));
      await page.route(API,async route=>{
        if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'http://127.0.0.1:4173','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'POST'}});
        const b=route.request().postDataJSON();
        let v;
        if(b.action==='preflight')v={state:'READY_FOR_SINGLE_PURCHASE',amountBRL:'4.99',paymentConfirmed:false,premiumGranted:false};
        else if(b.action==='issue'){issued++;v={state:'ORDER_CREATED_CHECKOUT_REVIEW_REQUIRED',orderId:ORDER,orderCreated:true,paymentConfirmed:false,premiumGranted:false};}
        else if(paid)v={state:'PREMIUM_ACTIVE',orderId:ORDER,paymentConfirmed:true,premiumGranted:true,
          expiresAt:new Date(Date.now()+30*86400000).toISOString(),noticeState:'SENT'};
        else if(b.action==='checkout')v={state:'AWAITING_PAYMENT',orderId:ORDER,amountBRL:'4.99',
          expiresAt:new Date(Date.now()+120000).toISOString(),qrCode:'000201synthetic-private-v2-no-payment',qrCodeBase64:null,ticketUrl:null,
          paymentConfirmed:false,premiumGranted:false};
        else v={state:'AWAITING_PAYMENT',orderId:ORDER,paymentConfirmed:false,premiumGranted:false,noticeState:null};
        return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'http://127.0.0.1:4173'},body:JSON.stringify(v)});
      });
      await page.goto('http://127.0.0.1:4173/app/pilot-pix/v2/');
      await page.getByRole('button',{name:'Continuar com Google',exact:true}).click();
      await page.getByRole('button',{name:'Google do ensaio'}).click();
      const buy=page.getByRole('button',{name:'Gerar meu único Pix de R$ 4,99'});
      await expect(buy).toBeDisabled();await page.getByRole('checkbox').check();await buy.click();
      await expect(page.getByLabel('Pix copia e cola')).toHaveValue('000201synthetic-private-v2-no-payment');
      await expect(buy).toBeHidden();expect(issued).toBe(1);
      await page.screenshot({path:'test-results/private-v2-'+viewport.width+'.png',fullPage:true});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      paid=true;await page.getByRole('button',{name:'Consultar esta compra'}).click();
      await expect(page.getByRole('heading',{name:'Seu Premium está ativo',exact:true})).toBeVisible();
      await expect(page.getByText('Confirmação enviada por e-mail.',{exact:true})).toBeVisible();
      await expect(page.getByLabel('Pix copia e cola')).toBeHidden();expect(issued).toBe(1);
      await page.getByRole('button',{name:'Trocar de conta ou encerrar consulta'}).click();
      await expect(page.getByRole('button',{name:'Continuar com Google',exact:true})).toBeVisible();
    });
    test('approval not ready cannot show a purchase button or Pix',async({page})=>{
      let issues=0;
      await page.route('https://accounts.google.com/gsi/client',r=>r.fulfill({contentType:'application/javascript',body:GOOGLE}));
      await page.route(API,route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,
        headers:{'access-control-allow-origin':'http://127.0.0.1:4173','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'POST'}});
        if(route.request().method()==='POST'&&route.request().postDataJSON().action==='issue')issues++;
        return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'http://127.0.0.1:4173'},
          body:JSON.stringify({state:'APPROVAL_REQUIRED',amountBRL:'4.99',paymentConfirmed:false,premiumGranted:false})});});
      await page.goto('http://127.0.0.1:4173/app/pilot-pix/v2/');
      await page.getByRole('button',{name:'Continuar com Google',exact:true}).click();await page.getByRole('button',{name:'Google do ensaio'}).click();
      await expect(page.getByText(/A compra de teste está sendo preparada/)).toBeVisible();
      await expect(page.getByRole('button',{name:'Gerar meu único Pix de R$ 4,99'})).toBeHidden();
      await expect(page.getByLabel('Pix copia e cola')).toBeHidden();expect(issues).toBe(0);
    });
  });
}
