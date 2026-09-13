import { PGlite } from '@electric-sql/pglite';
import { it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
it('enforces store ownership, privileged writes, ordering and deletion in isolated PostgreSQL', async () => {
const db = new PGlite();
try {
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated;
create table public.profiles(id uuid primary key);
insert into public.profiles values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');`);
await db.exec(await fs.readFile(path.resolve(__dirname, '../../supabase/migrations/20260912120000_store_entitlements_and_feedback.sql'),'utf8'));
await db.exec(`set role service_role;
select public.sync_store_entitlement('11111111-1111-4111-8111-111111111111','pro','2026-10-12','2026-09-12');
select public.sync_store_entitlement('11111111-1111-4111-8111-111111111111','free',null,'2026-09-11');
select public.sync_store_entitlement('22222222-2222-4222-8222-222222222222','plus','2026-10-12','2026-09-12');
insert into public.app_feedback(user_id,category,message) values ('11111111-1111-4111-8111-111111111111','support','A test report');
reset role;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';`);
const rows=(await db.query('select * from public.store_entitlements')).rows;
assert.equal(rows.length,1); assert.equal(rows[0].tier,'pro');
await db.exec("insert into public.ai_data_consents(user_id,version) values ('11111111-1111-4111-8111-111111111111',1)");
await assert.rejects(db.exec("insert into public.ai_data_consents(user_id,version) values ('22222222-2222-4222-8222-222222222222',1)"), /row-level security/);
await db.exec("set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222'; delete from public.ai_data_consents");
assert.equal((await db.query('select * from public.ai_data_consents')).rows.length,0);
await db.exec("set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111'");
assert.equal((await db.query('select * from public.ai_data_consents')).rows.length,1);
for (const sql of ["update public.store_entitlements set tier='pro'", "select public.sync_store_entitlement('11111111-1111-4111-8111-111111111111','pro','2026-10-12','2026-09-13')", "select * from public.app_feedback", "insert into public.app_feedback(user_id,category,message) values ('11111111-1111-4111-8111-111111111111','support','A test report')"]) {
  await assert.rejects(db.exec(sql), /permission denied/);
}
await db.exec('reset role; set role anon;');
await assert.rejects(db.exec('select * from public.store_entitlements'), /permission denied/);
await db.exec("reset role; delete from public.profiles where id='11111111-1111-4111-8111-111111111111'");
assert.equal((await db.query('select * from public.app_feedback')).rows.length,0);
assert.equal((await db.query('select * from public.ai_data_consents')).rows.length,0);
assert.equal((await db.query('select * from public.store_entitlements')).rows.length,1);
} finally { await db.close(); }
}, 30_000);
