import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import type { Server } from 'node:http';

async function main() {
  const status = JSON.parse(await readFile(process.env.SUPABASE_LOCAL_STATUS_FILE || '/tmp/fitly-supabase-local.json','utf8'));
  const url = new URL(status.API_URL);
  if (!['127.0.0.1','localhost'].includes(url.hostname)) throw new Error('Integration tests require a local Supabase project');
  Object.assign(process.env, {
    NODE_ENV:'test',SUPABASE_URL:url.origin,SUPABASE_SERVICE_ROLE_KEY:status.SERVICE_ROLE_KEY,
    SUPABASE_PUBLISHABLE_KEY:status.ANON_KEY,ENABLE_JOBS:'false',AI_ENABLED:'false',
    REVENUECAT_SECRET_API_KEY:'',GROQ_API_KEY:'',SENTRY_DSN:'',
  });
  const admin = createClient(url.origin,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const users: string[] = [];
  let server: Server | undefined;
  try {
    const actors = [];
    for (const name of ['a','b']) {
      const email = `security-${name}-${Date.now()}@example.invalid`;
      const password = 'Local-integration-Password-42';
      const created = await admin.auth.admin.createUser({email,password,email_confirm:true});
      assert.ifError(created.error); assert.ok(created.data.user);
      const id = created.data.user.id; users.push(id);
      const profile = await admin.from('profiles').upsert({id,email,full_name:`Test ${name}`}); assert.ifError(profile.error);
      const client = createClient(url.origin,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
      const login = await client.auth.signInWithPassword({email,password}); assert.ifError(login.error); assert.ok(login.data.session);
      actors.push({id,client,token:login.data.session.access_token});
    }
    const [a,b] = actors;
    const profiles = await a.client.from('profiles').select('id'); assert.ifError(profiles.error); assert.deepEqual(profiles.data,[{id:a.id}]);
    assert.ok((await a.client.from('profiles').update({membership_tier:'pro'}).eq('id',a.id)).error);
    assert.ok((await a.client.from('profiles').update({referred_by:'anything'}).eq('id',a.id)).error);
    assert.ok((await a.client.from('ai_plan_adjustments').insert({user_id:a.id,status:'applied'})).error);
    assert.ok((await a.client.rpc('begin_api_operation',{p_user_id:a.id,p_action:'chat',p_key_hash:'a'.repeat(64),p_request_hash:'b'.repeat(64),p_quota_key:null,p_limit:null,p_starts_at:null,p_ends_at:null})).error);
    const consent = await a.client.rpc('set_ai_data_consent',{p_accept:true,p_version:1}); assert.ifError(consent.error);
    const otherConsents = await b.client.from('ai_consent_events').select('id'); assert.ifError(otherConsents.error); assert.equal(otherConsents.data?.length,0);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVv8AAAAASUVORK5CYII=','base64');
    assert.ifError((await b.client.storage.from('avatars').upload(`${b.id}/avatar.png`,png,{contentType:'image/png',upsert:true})).error);
    assert.ok((await a.client.storage.from('avatars').upload(`${b.id}/avatar.png`,png,{contentType:'image/png',upsert:true})).error);
    assert.ok((await a.client.storage.from('avatars').upload(`${a.id}/unbounded-name.png`,png,{contentType:'image/png'})).error);
    const { app } = await import('../src/app');
    server = app.listen(0,'127.0.0.1');
    await new Promise<void>((resolve) => server!.once('listening',resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const request = (path: string, token?: string, init: RequestInit = {}) => fetch(base+path,{...init,headers:{...(token?{Authorization:`Bearer ${token}`}:{}) ,...init.headers},signal:AbortSignal.timeout(30_000)});
    assert.equal((await request('/api/profile')).status,401);
    assert.equal((await request('/api/admin/users',a.token)).status,403);
    assert.equal((await request('/ready')).status,200);
    const profile = await request('/api/profile',a.token); assert.equal(profile.status,200); assert.equal((await profile.json()).data.id,a.id);
    const exported = await request('/api/account/export',a.token); assert.equal(exported.status,200);
    assert.equal(exported.headers.get('cache-control'),'private, no-store');
    const data = await exported.json(); assert.equal(data.profiles.length,1); assert.equal(data.profiles[0].id,a.id);
    assert.ok(!JSON.stringify(data).includes(b.id));
    const deleted = await request('/api/account',a.token,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmation:'DELETE'})});
    assert.equal(deleted.status,200);
    assert.equal((await admin.from('profiles').select('id').eq('id',a.id)).data?.length,0);
    console.log('Local Auth/PostgREST/Storage/API ownership and account lifecycle checks passed');
  } finally {
    if (server) await new Promise<void>((resolve,reject) => server!.close((error) => error?reject(error):resolve()));
    for (const id of users) {
      await admin.storage.from('avatars').remove([`${id}/avatar.png`]);
      await admin.auth.admin.deleteUser(id);
    }
  }
}
void main().catch(() => { console.error('Local integration check failed; inspect local service logs without exposing request data or keys'); process.exitCode=1; });
