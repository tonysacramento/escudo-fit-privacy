import { test, expect } from '@playwright/test';

test('landing -> login -> app -> logout -> landing', async ({ page }) => {
  await page.route('https://accounts.google.com/gsi/client', async route => {
    const mock = `
      window.google = {
        accounts: {
          id: {
            initialize(opts) { window.__googleCallback = opts.callback; },
            renderButton(el) {
              const btn = document.createElement('button');
              btn.id = 'mock-google-login';
              btn.textContent = 'Continuar com Google';
              btn.onclick = () => window.__googleCallback({ credential: 'mock-google-id-token' });
              el.appendChild(btn);
            },
            disableAutoSelect() {}
          }
        }
      };
    `;
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: mock });
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/auth/google', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        user: {
          id: 'qa-user-elaine',
          email: 'elaineqne@gmail.com',
          name: 'Elaine Queiroz Silva',
          picture: ''
        },
        entitlement: {
          mode: 'VIP_LIFETIME',
          source: 'ADMIN_GRANT',
          isActive: true,
          expiresAt: null,
          revalidateAfter: null
        },
        access_token: 'qa-access-token',
        refresh_token: 'qa-refresh-token'
      })
    });
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/me', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ user: { id:'qa-user-elaine', email:'elaineqne@gmail.com', name:'Elaine Queiroz Silva' } })
    });
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/entitlement/me', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ mode:'VIP_LIFETIME', source:'ADMIN_GRANT', isActive:true, expiresAt:null, revalidateAfter:null })
    });
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/auth/logout', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ logged_out: true })
    });
  });

  await page.goto('http://127.0.0.1:4173/app/', { waitUntil: 'networkidle' });

  await expect(page.locator('#marketingExperience')).toBeVisible();
  await expect(page.locator('#appExperience')).toBeHidden();
  await expect(page.getByText('Os principais benefícios do Escudo Fit')).toBeVisible();

  await page.locator('[data-scroll-login]').first().click();
  await expect(page.locator('#mock-google-login')).toBeVisible();
  await page.locator('#mock-google-login').click();

  await expect(page.locator('#marketingExperience')).toBeHidden();
  await expect(page.locator('#appExperience')).toBeVisible();
  await expect(page.locator('#welcomeName')).toHaveText('Elaine Queiroz Silva');
  await expect(page.locator('#planBadge')).toHaveText('VIP VITALÍCIO');
  await expect(page.locator('#profilePlan')).toHaveText('WEB FULL • VIP VITALÍCIO');
  await expect(page.locator('.nav-item[data-target="activities"]')).toBeVisible();
  await expect(page.locator('.nav-item[data-target="applications"]')).toBeVisible();

  await page.locator('.nav-item[data-target="activities"]').click();
  await expect(page.locator('.app-view[data-view="activities"]')).toBeVisible();
  await expect(page.locator('#addActivity')).toBeVisible();

  await page.locator('.nav-item[data-target="applications"]').click();
  await expect(page.locator('.app-view[data-view="applications"]')).toBeVisible();
  await expect(page.locator('[data-application-site="Abdômen"]')).toBeVisible();

  await page.locator('[data-target="profile"]').click();
  await expect(page.locator('#profileEmail')).toHaveText('elaineqne@gmail.com');

  await page.locator('#logoutButtonBottom').click();

  await expect(page.locator('#marketingExperience')).toBeVisible();
  await expect(page.locator('#appExperience')).toBeHidden();
  await expect(page.getByText('Sua rotina. Sua evolução.')).toBeVisible();
});


test('mobile layout remains usable before and after login', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.route('https://accounts.google.com/gsi/client', async route => {
    const mock = `
      window.google = {
        accounts: {
          id: {
            initialize(opts) { window.__googleCallback = opts.callback; },
            renderButton(el) {
              const btn = document.createElement('button');
              btn.id = 'mock-google-login-mobile';
              btn.textContent = 'Continuar com Google';
              btn.onclick = () => window.__googleCallback({ credential: 'mock-google-id-token-mobile' });
              el.appendChild(btn);
            },
            disableAutoSelect() {}
          }
        }
      };
    `;
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: mock });
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/auth/google', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        user: { id:'qa-mobile', email:'qa.mobile@example.com', name:'QA Mobile' },
        entitlement: { mode:'PREMIUM', source:'ADMIN_GRANT', isActive:true, expiresAt:null, revalidateAfter:null },
        access_token:'qa-mobile-access',
        refresh_token:'qa-mobile-refresh'
      })
    });
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/auth/logout', async route => {
    await route.fulfill({ status:200, contentType:'application/json', headers:{'access-control-allow-origin':'*'}, body:'{"logged_out":true}' });
  });

  await page.goto('http://127.0.0.1:4173/app/', { waitUntil:'networkidle' });
  await expect(page.locator('#marketingExperience')).toBeVisible();

  const landingOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(landingOverflow).toBeFalsy();

  await page.locator('[data-scroll-login]').first().click();
  await page.locator('#mock-google-login-mobile').click();

  await expect(page.locator('#appExperience')).toBeVisible();
  await expect(page.locator('#planBadge')).toHaveText('PREMIUM');

  const appOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(appOverflow).toBeFalsy();

  await expect(page.locator('.bottom-nav')).toBeVisible();
  await expect(page.locator('#welcomeName')).toHaveText('QA Mobile');
});


test('stale cached profile is not trusted when backend validation fails', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('escudofit_web_auth_v1', JSON.stringify({
      user: { id:'stale-user', email:'old-profile@example.com', name:'Perfil Antigo' },
      entitlement: { mode:'VIP_LIFETIME' },
      access_token:'stale-access',
      refresh_token:'stale-refresh'
    }));
  });

  await page.route('https://accounts.google.com/gsi/client', async route => {
    const mock = `
      window.google = {
        accounts: {
          id: {
            initialize(opts) { window.__googleCallback = opts.callback; },
            renderButton(el) {
              const btn = document.createElement('button');
              btn.id = 'mock-google-login-stale';
              btn.textContent = 'Continuar com Google';
              el.appendChild(btn);
            },
            disableAutoSelect() {}
          }
        }
      };
    `;
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: mock });
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/me', async route => {
    await route.fulfill({ status: 500, contentType:'application/json', body:'{"code":"INTERNAL_ERROR"}' });
  });

  await page.goto('http://127.0.0.1:4173/app/', { waitUntil:'networkidle' });

  await expect(page.locator('#marketingExperience')).toBeVisible();
  await expect(page.locator('#appExperience')).toBeHidden();
  await expect(page.locator('#mock-google-login-stale')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('escudofit_web_auth_v1'))).toBeNull();
});


test('FREE account opens Web Full and hydrates account history', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.route('https://accounts.google.com/gsi/client', async route => {
    const mock = `
      window.google = {
        accounts: {
          id: {
            initialize(opts) { window.__googleCallback = opts.callback; },
            renderButton(el) {
              const btn = document.createElement('button');
              btn.id = 'mock-google-login-wellness';
              btn.textContent = 'Continuar com Google';
              btn.onclick = () => window.__googleCallback({ credential: 'mock-free-token' });
              el.appendChild(btn);
            },
            disableAutoSelect() {}
          }
        }
      };
    `;
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: mock });
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/auth/google', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        user: { id:'qa-free', email:'qa.free@example.com', name:'QA Wellness' },
        entitlement: { mode:'FREE', source:'SYSTEM_DEFAULT', isActive:true, expiresAt:null, revalidateAfter:null },
        access_token:'qa-free-access',
        refresh_token:'qa-free-refresh'
      })
    });
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/history', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        weights: [{ id:'w-1', weightKg:82.4, timestampMs:Date.UTC(2026,9,5,12,0,0), origin:'PROFILE' }],
        measurements: [{ date:'2026-10-05', waist:92.5, abdomen:96.0, hips:101.2 }]
      })
    });
  });

  await page.goto('http://127.0.0.1:4173/app/', { waitUntil:'networkidle' });
  await page.locator('[data-scroll-login]').first().click();
  await page.locator('#mock-google-login-wellness').click();

  await expect(page.locator('#appExperience')).toBeVisible();
  await expect(page.locator('#experienceLabel')).toHaveText('FULL');
  await expect(page.locator('#planBadge')).toHaveText('FREE');
  await expect(page.locator('#profilePlan')).toHaveText('WEB FULL • FREE');
  await expect(page.locator('[data-target="measurements"]')).not.toHaveClass(/entitlement-hidden/);
  await expect(page.locator('[data-target="activities"]')).not.toHaveClass(/entitlement-hidden/);
  await expect(page.locator('[data-target="applications"]')).not.toHaveClass(/entitlement-hidden/);
  await expect(page.locator('#lastWeight')).toHaveText('82,4 kg');
});


test('quick trial signup reserves access before Google login', async ({ page }) => {
  await page.route('https://accounts.google.com/gsi/client', async route => {
    const mock = `
      window.google = {
        accounts: {
          id: {
            initialize(opts) { window.__googleCallback = opts.callback; },
            renderButton(el) {
              const btn = document.createElement('button');
              btn.id = 'mock-google-login-trial';
              btn.textContent = 'Continuar com Google';
              el.appendChild(btn);
            },
            disableAutoSelect() {}
          }
        }
      };
    `;
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: mock });
  });

  let captured = null;
  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/trial/register', async route => {
    captured = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ registered:true, next:'GOOGLE_LOGIN' })
    });
  });

  await page.goto('http://127.0.0.1:4173/app/', { waitUntil:'networkidle' });
  await expect(page.getByRole('button', { name:'Começar 14 dias grátis' }).first()).toBeVisible();

  await page.locator('[data-scroll-trial]').first().click();
  await page.locator('#trialName').fill('Maria Silva');
  await page.locator('#trialEmail').fill('maria@gmail.com');
  await page.locator('#trialLgpd').check();
  await page.locator('#trialForm').evaluate(form => form.requestSubmit());

  await expect(page.locator('#trialStatus')).toContainText('Cadastro concluído');
  await expect(page.locator('#trialLoginButton')).toBeVisible();
  await expect(page.locator('#trialAndroidButton')).toBeVisible();
  expect(captured).toEqual({
    name:'Maria Silva',
    email:'maria@gmail.com',
    company:'',
    consentAccepted:true,
    consentVersion:'LGPD-2026-10-07-v1'
  });
});


test('same Google account restores remote history after local data is cleared', async ({ page }) => {
  await page.route('https://accounts.google.com/gsi/client', async route => {
    const mock = `
      window.google = {
        accounts: {
          id: {
            initialize(opts) { window.__googleCallback = opts.callback; },
            renderButton(el) {
              const btn = document.createElement('button');
              btn.className = 'mock-google-history-login';
              btn.textContent = 'Continuar com Google';
              btn.onclick = () => window.__googleCallback({ credential: 'mock-history-token' });
              el.appendChild(btn);
            },
            disableAutoSelect() {}
          }
        }
      };
    `;
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: mock });
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/auth/google', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        user: { id:'qa-history-user', email:'history@example.com', name:'QA Histórico' },
        entitlement: { mode:'PREMIUM', source:'ADMIN_GRANT', isActive:true, expiresAt:null, revalidateAfter:null },
        access_token:'qa-history-access',
        refresh_token:'qa-history-refresh'
      })
    });
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/history', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        weights: [
          { id:'history-weight-1', weightKg:79.6, timestampMs:Date.UTC(2026,9,6,12,0,0), origin:'PROFILE' }
        ],
        measurements: [
          { date:'2026-10-06', waist:90.2, abdomen:94.1, hips:100.4, arm:34.0 }
        ]
      })
    });
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/auth/logout', async route => {
    await route.fulfill({ status:200, contentType:'application/json', headers:{'access-control-allow-origin':'*'}, body:'{"logged_out":true}' });
  });

  await page.goto('http://127.0.0.1:4173/app/', { waitUntil:'networkidle' });
  await page.locator('[data-scroll-login]').first().click();
  await page.locator('.mock-google-history-login').click();

  await expect(page.locator('#lastWeight')).toHaveText('79,6 kg');
  await page.locator('[data-target="measurements"]').click();
  await expect(page.locator('#measurementHistoryList')).toContainText('90,2 cm');

  await page.locator('#logoutButton').click();
  await expect(page.locator('#marketingExperience')).toBeVisible();

  // Simulate a clean/new device: remove only this account's local app state.
  await page.evaluate(() => localStorage.removeItem('escudofit_web_user_v2_qa-history-user'));

  await page.locator('[data-scroll-login]').first().click();
  await expect(page.locator('.mock-google-history-login')).toBeVisible();
  await page.locator('.mock-google-history-login').click();

  // History must be restored from the account backend, not from localStorage.
  await expect(page.locator('#lastWeight')).toHaveText('79,6 kg');
  await page.locator('[data-target="measurements"]').click();
  await expect(page.locator('#measurementHistoryList')).toContainText('90,2 cm');
});


test('switching Google accounts never leaks the previous account history', async ({ page }) => {
  let loginNumber = 0;

  await page.route('https://accounts.google.com/gsi/client', async route => {
    const mock = `
      window.google = {
        accounts: {
          id: {
            initialize(opts) { window.__googleCallback = opts.callback; },
            renderButton(el) {
              const btn = document.createElement('button');
              btn.className = 'mock-google-isolation-login';
              btn.textContent = 'Continuar com Google';
              btn.onclick = () => window.__googleCallback({ credential: 'mock-isolation-token' });
              el.appendChild(btn);
            },
            disableAutoSelect() {}
          }
        }
      };
    `;
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: mock });
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/auth/google', async route => {
    loginNumber += 1;
    const accountA = loginNumber === 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        user: accountA
          ? { id:'qa-account-a', email:'account-a@example.com', name:'Conta A' }
          : { id:'qa-account-b', email:'account-b@example.com', name:'Conta B' },
        entitlement: { mode:'PREMIUM', source:'ADMIN_GRANT', isActive:true, expiresAt:null, revalidateAfter:null },
        access_token: accountA ? 'access-a' : 'access-b',
        refresh_token: accountA ? 'refresh-a' : 'refresh-b'
      })
    });
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/history', async route => {
    const authHeader = route.request().headers()['authorization'] || '';
    const accountA = authHeader.includes('access-a');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        weights: accountA
          ? [{ id:'weight-a', weightKg:81.2, timestampMs:Date.UTC(2026,9,5,12,0,0), origin:'PROFILE' }]
          : [{ id:'weight-b', weightKg:67.3, timestampMs:Date.UTC(2026,9,6,12,0,0), origin:'PROFILE' }],
        measurements: []
      })
    });
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/auth/logout', async route => {
    await route.fulfill({ status:200, contentType:'application/json', headers:{'access-control-allow-origin':'*'}, body:'{"logged_out":true}' });
  });

  await page.goto('http://127.0.0.1:4173/app/', { waitUntil:'networkidle' });
  await page.locator('[data-scroll-login]').first().click();
  await page.locator('.mock-google-isolation-login').click();
  await expect(page.locator('#welcomeName')).toHaveText('Conta A');
  await expect(page.locator('#lastWeight')).toHaveText('81,2 kg');

  await page.locator('#logoutButton').click();
  await expect(page.locator('#marketingExperience')).toBeVisible();

  await page.locator('[data-scroll-login]').first().click();
  await expect(page.locator('.mock-google-isolation-login')).toBeVisible();
  await page.locator('.mock-google-isolation-login').click();

  await expect(page.locator('#welcomeName')).toHaveText('Conta B');
  await expect(page.locator('#lastWeight')).toHaveText('67,3 kg');
  await expect(page.locator('#weightHistory')).not.toContainText('81,2 kg');
});


test('pending local history survives login hydration and is not overwritten', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('escudofit_web_user_v2_qa-merge-user', JSON.stringify({
      water:0, waterGoal:2000, steps:0, stepsGoal:8000, protein:0, proteinGoal:100,
      weights:[
        { id:'local-pending', value:77.7, at:'2026-10-07T08:00:00.000Z' }
      ],
      measurements:{ waist:89.5, savedAt:'2026-10-07T08:00:00.000Z' },
      measurementHistory:[
        { date:'2026-10-07', waist:89.5, abdomen:null, hip:null, arm:null, thigh:null, chest:null }
      ],
      profile:{name:''}
    }));
  });

  await page.route('https://accounts.google.com/gsi/client', async route => {
    const mock = `
      window.google = {
        accounts: {
          id: {
            initialize(opts) { window.__googleCallback = opts.callback; },
            renderButton(el) {
              const btn = document.createElement('button');
              btn.id = 'mock-google-merge-login';
              btn.textContent = 'Continuar com Google';
              btn.onclick = () => window.__googleCallback({ credential:'mock-merge-token' });
              el.appendChild(btn);
            },
            disableAutoSelect() {}
          }
        }
      };
    `;
    await route.fulfill({ status:200, contentType:'application/javascript', body:mock });
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/auth/google', async route => {
    await route.fulfill({
      status:200,
      contentType:'application/json',
      headers:{'access-control-allow-origin':'*'},
      body:JSON.stringify({
        user:{ id:'qa-merge-user', email:'merge@example.com', name:'QA Merge' },
        entitlement:{ mode:'PREMIUM', source:'ADMIN_GRANT', isActive:true, expiresAt:null, revalidateAfter:null },
        access_token:'qa-merge-access',
        refresh_token:'qa-merge-refresh'
      })
    });
  });

  let historyRequests=0;
  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/history', async route => {
    historyRequests += 1;
    await route.fulfill({
      status:200,
      contentType:'application/json',
      headers:{'access-control-allow-origin':'*'},
      body:JSON.stringify({
        weights:[
          { id:'remote-existing', weightKg:78.8, timestampMs:Date.UTC(2026,9,6,12,0,0), origin:'PROFILE' }
        ],
        measurements:[
          { date:'2026-10-07', waist:91.0 }
        ]
      })
    });
  });

  await page.goto('http://127.0.0.1:4173/app/', { waitUntil:'networkidle' });
  await page.locator('[data-scroll-login]').first().click();
  await page.locator('#mock-google-merge-login').click();

  await expect(page.locator('#weightHistory')).toContainText('77,7 kg');
  await expect(page.locator('#weightHistory')).toContainText('78,8 kg');
  await page.locator('[data-target="measurements"]').click();
  await expect(page.locator('#measurementHistoryList')).toContainText('89,5 cm');

  await expect.poll(() => historyRequests).toBe(1);
});


test('Web hydration writes account history and reloads from remote', async ({ page }) => {
  let remoteWater = { date:'2026-10-07', consumedMl:1000, updatedAtMs:1000 };

  await page.addInitScript(() => {
    const OriginalDate = Date;
    class FixedDate extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : ['2026-10-07T13:00:00.000Z'])); }
      static now() { return OriginalDate.parse('2026-10-07T13:00:00.000Z'); }
    }
    window.Date = FixedDate;
  });

  await page.route('https://accounts.google.com/gsi/client', async route => {
    const mock = `
      window.google={accounts:{id:{
        initialize(opts){window.__googleCallback=opts.callback},
        renderButton(el){const b=document.createElement('button');b.id='mock-water-login';b.onclick=()=>window.__googleCallback({credential:'water-token'});el.appendChild(b)},
        disableAutoSelect(){}
      }}};
    `;
    await route.fulfill({status:200,contentType:'application/javascript',body:mock});
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/auth/google', async route => {
    await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({
      user:{id:'qa-water-user',email:'water@example.com',name:'QA Water'},
      entitlement:{mode:'PREMIUM',source:'ADMIN_GRANT',isActive:true,expiresAt:null,revalidateAfter:null},
      access_token:'water-access',refresh_token:'water-refresh'
    })});
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/me', async route => {
    await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({
      user:{id:'qa-water-user',email:'water@example.com',name:'QA Water'}
    })});
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/entitlement/me', async route => {
    await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({
      mode:'PREMIUM',source:'ADMIN_GRANT',isActive:true,expiresAt:null,revalidateAfter:null
    })});
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/history', async route => {
    await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({
      weights:[],measurements:[],water:[remoteWater]
    })});
  });

  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/history/sync', async route => {
    const body=route.request().postDataJSON();
    if(Array.isArray(body.water)&&body.water[0]) remoteWater=body.water[0];
    await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({synced:true,water:1})});
  });

  await page.goto('http://127.0.0.1:4173/app/',{waitUntil:'networkidle'});
  await page.locator('[data-scroll-login]').first().click();
  await page.locator('#mock-water-login').click();

  await expect(page.locator('#waterMl')).toHaveText('1000 ml');
  await page.locator('[data-water="200"]').first().click();
  await expect(page.locator('#waterMl')).toHaveText('1200 ml');
  await expect.poll(()=>remoteWater.consumedMl).toBe(1200);

  await page.evaluate(()=>localStorage.removeItem('escudofit_web_user_v2_qa-water-user'));
  await page.reload({waitUntil:'networkidle'});
  await expect(page.locator('#waterMl')).toHaveText('1200 ml');
});


test('quick signup requires privacy consent', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/app/', { waitUntil:'networkidle' });
  await page.locator('[data-scroll-trial]').first().click();
  await page.locator('#trialName').fill('Maria Silva');
  await page.locator('#trialEmail').fill('maria@gmail.com');
  await page.locator('#trialForm').evaluate(form => form.requestSubmit());
  await expect(page.locator('#trialStatus')).toContainText('leia e aceite');
});

test('non-Gmail signup is routed to Web-only access', async ({ page }) => {
  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/trial/register', async route => {
    const body=route.request().postDataJSON();
    expect(body.email).toBe('maria@outlook.com');
    expect(body.consentAccepted).toBe(true);
    await route.fulfill({
      status:200,
      contentType:'application/json',
      headers:{'access-control-allow-origin':'*'},
      body:JSON.stringify({registered:true,accessChannel:'WEB_ONLY',next:'WEB_EMAIL_ACCESS'})
    });
  });

  await page.goto('http://127.0.0.1:4173/app/', { waitUntil:'networkidle' });
  await page.locator('[data-scroll-trial]').first().click();
  await page.locator('#trialName').fill('Maria Silva');
  await page.locator('#trialEmail').fill('maria@outlook.com');
  await page.locator('#trialLgpd').check();
  await page.locator('#trialForm').evaluate(form => form.requestSubmit());

  await expect(page.locator('#trialStatus')).toContainText('acesso pela Web');
  await expect(page.locator('#trialLoginButton')).toBeHidden();
  await expect(page.locator('#trialAndroidButton')).toBeHidden();
});


test('Monise30 campaign link shows 30 days and pending approval confirmation', async ({ page }) => {
  let captured=null;
  await page.route('https://escudo-fit-api-v38-835029473980.us-central1.run.app/api/v38/trial/register', async route => {
    captured=route.request().postDataJSON();
    await route.fulfill({
      status:200,
      contentType:'application/json',
      headers:{'access-control-allow-origin':'*'},
      body:JSON.stringify({
        registered:true,
        accessChannel:'WEB_ONLY',
        promoCode:'Monise30',
        trialDays:30,
        pendingApproval:true,
        next:'MANUAL_APPROVAL'
      })
    });
  });

  await page.goto('http://127.0.0.1:4173/app/?promo=Monise30', { waitUntil:'networkidle' });
  await expect(page.locator('#trialTitle')).toHaveText('30 dias grátis de Escudo Fit');
  await expect(page.locator('#trialIntro')).toContainText('liberado em até 24 horas');

  await page.locator('#trialName').fill('Stella Monise');
  await page.locator('#trialEmail').fill('stellamonise@hotmail.com');
  await page.locator('#trialLgpd').check();
  await page.locator('#trialForm').evaluate(form=>form.requestSubmit());

  await expect(page.locator('#trialStatus')).toContainText('30 dias grátis');
  await expect(page.locator('#trialStatus')).toContainText('até 24 horas');
  await expect(page.locator('#trialLoginButton')).toBeHidden();
  expect(captured.promoCode).toBe('Monise30');
});
