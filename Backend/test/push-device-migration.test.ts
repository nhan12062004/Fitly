import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';

it('allows unregistering only the current account device', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table public.mobile_push_devices(user_id uuid, expo_push_token text, enabled boolean default true, disabled_at timestamptz, updated_at timestamptz);
      insert into public.mobile_push_devices(user_id,expo_push_token) values
        ('11111111-1111-4111-8111-111111111111','own-device'),('22222222-2222-4222-8222-222222222222','other-device');`);
    await db.exec(await readFile(path.resolve(__dirname, '../../supabase/migrations/20260913100000_unregister_push_device.sql'), 'utf8'));
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
      select public.unregister_mobile_push_device('other-device'); select public.unregister_mobile_push_device('own-device'); reset role;`);
    expect((await db.query('select expo_push_token,enabled from public.mobile_push_devices order by expo_push_token')).rows).toEqual([
      { expo_push_token: 'other-device', enabled: true }, { expo_push_token: 'own-device', enabled: false },
    ]);
    await db.exec('set role anon');
    await expect(db.exec("select public.unregister_mobile_push_device('own-device')")).rejects.toThrow(/permission denied/);
  } finally { await db.close(); }
}, 30_000);
