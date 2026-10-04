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
  await expect(page.locator('#profilePlan')).toHaveText('VIP VITALÍCIO');

  await page.locator('[data-target="profile"]').click();
  await expect(page.locator('#profileEmail')).toHaveText('elaineqne@gmail.com');

  await page.locator('#logoutButtonBottom').click();

  await expect(page.locator('#marketingExperience')).toBeVisible();
  await expect(page.locator('#appExperience')).toBeHidden();
  await expect(page.getByText('Sua rotina. Sua evolução.')).toBeVisible();
});
