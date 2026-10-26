import { expect, test, type Page } from '@playwright/test';
import { loadEnv } from 'vite';

const supabaseUrl = loadEnv('development', process.cwd(), 'VITE_').VITE_SUPABASE_URL;
const userId = '00000000-0000-4000-8000-000000000001';
const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'fixture@example.com', user_metadata: { full_name: 'Profile Fixture' }, app_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const limits = { chatMessages: 800, planGenerations: 12, workoutAdjustments: 100, mealAdjustments: 100 };
const zeroUsage = { chatMessages: 0, planGenerations: 0, workoutAdjustments: 0, mealAdjustments: 0 };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

async function installFixtures(page: Page, holdQuota = false, membershipExpiresAt = '2099-01-01T00:00:00Z', admin = false) {
  const fixtureUser = admin ? { ...user, app_metadata:{role:'admin'}, factors:[{id:'90000000-0000-4000-8000-000000000001',factor_type:'totp',status:'verified',friendly_name:'Fitly Admin',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'}] } : user;
  const quotaGate = deferred();
  const auxiliaryGate = deferred();
  const requests: Record<string, number> = {};
  let used = 0;
  let expired = false;
  const tokenPart = (data: unknown) => Buffer.from(JSON.stringify(data)).toString('base64url');
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const session = { access_token: `${tokenPart({ alg: 'HS256', typ: 'JWT' })}.${tokenPart({ sub: userId, exp: expires, role: 'authenticated', aud: 'authenticated',aal:'aal1' })}.test`, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expires, user:fixtureUser };
  const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
  await page.addInitScript(({ storageKey, session }) => {
    localStorage.setItem(storageKey, JSON.stringify(session));
    (window as any).__firstCoachQuota = null;
    new MutationObserver(() => {
      const badge = document.querySelector('.ai-coach-chat-shell .ai-coach-quota-pill strong');
      if (badge && (window as any).__firstCoachQuota === null) (window as any).__firstCoachQuota = badge.textContent;
    }).observe(document, { childList: true, subtree: true });
  }, { storageKey, session });
  await page.routeWebSocket('**/realtime/v1/**', (socket) => socket.close());
  await page.route('**/auth/v1/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(route.request().url().includes('/token') ? session : fixtureUser) }));
  await page.route('**/rest/v1/**', async (route) => {
    const table = new URL(route.request().url()).pathname.split('/rest/v1/')[1];
    requests[table] = (requests[table] || 0) + 1;
    if (table === 'daily_progress_logs' || table === 'rpc/ensure_active_solo_challenge') await auxiliaryGate.promise;
    const fixtures: Record<string, unknown[]> = {
      profiles: [{ ...user, full_name: 'Profile Fixture', gender: 'Nam', birthday: '1995-01-01', membership_tier: 'pro', membership_expires_at: membershipExpiresAt, exp: 250, level: 3 }],
      lifestyle_settings: [{ user_id: userId, fitness_goal: 'Tăng cơ', weekly_workouts: 3, experience_level: 'beginner', workout_location: 'home' }],
      body_metrics: [{ user_id: userId, height: 175, weight: 70, target_weight: 72, created_at: '2026-10-24T00:00:00Z' }],
      health_conditions: [{ user_id: userId, injuries: '', health_condition: '' }],
      ai_data_consents: [{ user_id: userId, version: 1 }],
    };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/1' }, body: JSON.stringify(fixtures[table] || []) });
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests[path] = (requests[path] || 0) + 1;
    if (path === '/api/ai/quota') {
      if (holdQuota) await quotaGate.promise;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ membershipTier: expired ? 'free' : 'pro', canChat: !expired, trialExpired: expired, aiQuota: { limits: expired ? { chatMessages: 25, planGenerations: 5, workoutAdjustments: 5, mealAdjustments: 5 } : limits, usage: { ...zeroUsage, chatMessages: used }, remaining: expired ? { ...zeroUsage } : { ...limits, chatMessages: 800 - used } } }) });
    } else if (path === '/api/ai/chat') {
      used += 1;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ reply: 'Phản hồi kiểm tra.', actionRequired: false, aiQuota: { limits, usage: { ...zeroUsage, chatMessages: used }, remaining: { ...limits, chatMessages: 800 - used } } }) });
    } else if (path === '/api/profile') {
      await auxiliaryGate.promise;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Slow optional API"}' });
    } else {
      await route.fulfill({ contentType: 'application/json', body: '{"data":[]}' });
    }
  });
  return { requests, session, releaseQuota: quotaGate.resolve, releaseAuxiliary: auxiliaryGate.resolve, expireMembership: () => { expired = true; } };
}

test('profile loads without waiting for activity, challenges or a duplicate Render profile request', async ({ page }) => {
  const fixture = await installFixtures(page);
  try {
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Hồ sơ', exact: true })).toBeVisible();
    await expect(page.getByText('Profile Fixture', { exact: true })).toBeVisible();
    await expect(page.getByText('Đang tải thành tựu…', { exact: true })).toBeVisible();
    expect(fixture.requests['/api/profile'] || 0).toBe(0);
    expect(fixture.requests.profiles).toBe(1);
    expect(fixture.requests.body_metrics).toBe(1);
    expect(fixture.requests.health_conditions).toBe(1);
    expect(fixture.requests.lifestyle_settings).toBe(1);
  } finally { fixture.releaseAuxiliary(); }
});

test('Profile and Coach share the first quota and the remaining count after a chat, including warm profile navigation', async ({ page }) => {
  const fixture = await installFixtures(page);
  try {
    await page.goto('/profile');
    await expect(page.locator('[data-quota="chatMessages"]')).toContainText('800');
    await page.getByRole('link', { name: 'Mở AI Coach', exact: true }).click();
    await expect(page.locator('.ai-coach-quota-pill')).toContainText('800 lượt');
    expect(await page.evaluate(() => (window as any).__firstCoachQuota)).toBe('800 lượt');
    expect(fixture.requests['/api/ai/quota']).toBe(1);
    await page.getByPlaceholder('Nhắn tin cho AI Coach hôm nay...').fill('Hướng dẫn khởi động hôm nay');
    await page.getByRole('button', { name: 'Gửi tin nhắn', exact: true }).click();
    await expect(page.locator('.ai-coach-quota-pill')).toContainText('799 lượt');
    await page.getByRole('button', { name: 'Mở hồ sơ', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Hồ sơ', exact: true })).toBeVisible();
    await expect(page.locator('[data-quota="chatMessages"]')).toContainText('799');
    expect(fixture.requests.body_metrics).toBe(1);
    expect(fixture.requests.health_conditions).toBe(1);
    expect(fixture.requests['/api/ai/quota']).toBe(1);
  } finally { fixture.releaseAuxiliary(); }
});

test('a cold Coach opening renders its content and actual count together even when quota is slow', async ({ page }) => {
  const fixture = await installFixtures(page, true);
  try {
    await page.goto('/smart-planner');
    await expect.poll(() => fixture.requests['/api/ai/quota'] || 0).toBe(1);
    await expect(page.locator('.ai-coach-chat-shell')).toHaveCount(0);
    fixture.releaseQuota();
    await expect(page.locator('.ai-coach-quota-pill')).toContainText('800 lượt');
    expect(await page.evaluate(() => (window as any).__firstCoachQuota)).toBe('800 lượt');
    expect(fixture.requests['/api/ai/quota']).toBe(1);
  } finally { fixture.releaseQuota(); fixture.releaseAuxiliary(); }
});

test('a cached Coach quota refreshes when the current subscription expires', async ({ page }) => {
  const start = Date.now();
  await page.clock.install({ time: new Date(start) });
  const fixture = await installFixtures(page, false, new Date(start + 60_000).toISOString());
  try {
    await page.goto('/smart-planner');
    await expect(page.locator('.ai-coach-quota-pill')).toContainText('800 lượt');
    fixture.expireMembership();
    await page.clock.fastForward(61_000);
    await expect(page.locator('.ai-coach-quota-pill')).toContainText('0 lượt');
    await expect(page.getByRole('button', { name: 'Mở hồ sơ', exact: true })).toContainText('FREE');
    expect(fixture.requests['/api/ai/quota']).toBe(2);
  } finally { fixture.releaseAuxiliary(); }
});

test('saving a meal edit uses the versioned API and never deletes plan rows from the browser', async ({ page }) => {
  const fixture = await installFixtures(page);
  fixture.releaseAuxiliary();
  const planId = '70000000-0000-4000-8000-000000000001';
  const vietnam = new Date(Date.now()+7*3600_000);
  const day = (vietnam.getUTCDay()+6)%7;
  const week = new Date(vietnam.getTime()-day*86400_000).toISOString().slice(0,10);
  const rows = Array.from({length:7},(_,index) => ({
    id:`71000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,food_plan_id:planId,day_of_week:index,
    meal_type:'lunch',recipe_id:'rice',quantity:1,calories:200,protein:10,carbs:30,fat:4,order_index:0,is_rest_day:false,
    recipes:{id:'rice',name:'Món kiểm thử',calories:200,protein:10,carbs:30,fat:4,recipe_ingredients:[]},
  }));
  await page.route('**/rest/v1/weekly_food_plans*',(route) => route.fulfill({contentType:'application/json',body:JSON.stringify([{id:planId,name:'Thực đơn',week_start_date:week,plan_status:'active',version:4}])}));
  await page.route('**/rest/v1/weekly_food_items*',(route) => route.fulfill({contentType:'application/json',body:JSON.stringify(rows)}));
  let saved: any = null; let directMutations = 0;
  page.on('request',(request) => { if (/\/rest\/v1\/weekly_food_/.test(request.url()) && request.method() !== 'GET') directMutations+=1; });
  await page.route('**/api/meal-plans/save',async (route) => {
    saved = route.request().postDataJSON();
    expect(route.request().headers()['idempotency-key']).toBeTruthy();
    await route.fulfill({contentType:'application/json',body:JSON.stringify({data:{planId,version:5,items:saved.items.map((item:any) => ({id:item.id,day_of_week:item.day_of_week,order_index:item.order_index}))}})});
  });
  await page.goto('/diet-plan');
  await expect(page.getByTitle('Xóa món',{exact:true}).first()).toBeVisible();
  await page.getByTitle('Xóa món',{exact:true}).first().click();
  await expect.poll(() => saved?.expectedVersion).toBe(4);
  expect(saved.planId).toBe(planId);
  expect(saved.items).toHaveLength(6);
  expect(directMutations).toBe(0);
});

test('privacy revocation uses the server-timestamped consent RPC', async ({ page }) => {
  const fixture = await installFixtures(page); fixture.releaseAuxiliary();
  let revoked = false;
  await page.route('**/rest/v1/rpc/set_ai_data_consent',async (route) => {
    expect(route.request().postDataJSON()).toEqual({p_accept:false,p_version:1});
    revoked = true;
    await route.fulfill({contentType:'application/json',body:'null'});
  });
  await page.goto('/privacy');
  await page.getByRole('button',{name:'Thu hồi đồng ý sử dụng AI',exact:true}).click();
  await expect.poll(() => revoked).toBe(true);
  await expect(page.getByRole('status')).toContainText('Đã thu hồi');
});

test('a signed-in user can download their personal JSON export', async ({ page }) => {
  const fixture = await installFixtures(page); fixture.releaseAuxiliary();
  await page.route('**/api/account/export',(route) => route.fulfill({contentType:'application/json',body:JSON.stringify({formatVersion:1,profiles:[{id:userId}]})}));
  await page.goto('/profile');
  const download = page.waitForEvent('download');
  await page.getByRole('button',{name:'Tải dữ liệu cá nhân của tôi (JSON)',exact:true}).click();
  expect((await download).suggestedFilename()).toBe('fitly-personal-data.json');
});

test('an administrator can complete the second-factor challenge from Profile', async ({ page }) => {
  const fixture = await installFixtures(page,false,'2099-01-01T00:00:00Z',true); fixture.releaseAuxiliary();
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const verified = { ...fixture.session, access_token:`${part({alg:'HS256',typ:'JWT'})}.${part({sub:userId,exp:fixture.session.expires_at,role:'authenticated',aud:'authenticated',aal:'aal2'})}.test` };
  await page.route('**/auth/v1/factors/*/challenge',(route) => route.fulfill({contentType:'application/json',body:JSON.stringify({id:'challenge-fixture',expires_at:fixture.session.expires_at})}));
  await page.route('**/auth/v1/factors/*/verify',async (route) => {
    expect(route.request().postDataJSON().code).toBe('123456');
    await route.fulfill({contentType:'application/json',body:JSON.stringify(verified)});
  });
  await page.goto('/profile');
  await page.getByRole('textbox',{name:'Mã xác thực 6 chữ số'}).fill('123456');
  await page.getByRole('button',{name:'Xác minh phiên quản trị',exact:true}).click();
  await expect(page.getByText('Phiên hiện tại đã được xác minh.',{exact:true})).toBeVisible();
});
