import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';

it('enforces blocking, group separation, filtering and privileged moderation in PostgreSQL', async () => {
  const db = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111';
  const member = '22222222-2222-4222-8222-222222222222';
  const group = '33333333-3333-4333-8333-333333333333';
  const report = '44444444-4444-4444-8444-444444444444';
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
      create table public.profiles(id uuid primary key, full_name text, avatar_url text);
      create table public.challenges(id uuid primary key, created_by uuid, title text, description text, status text);
      create table public.challenge_participants(challenge_id uuid, user_id uuid, role text, primary key(challenge_id,user_id));
      create table public.challenge_checkins(challenge_id uuid, user_id uuid);
      insert into public.profiles(id,full_name) values ('${owner}','Owner'),('${member}','Member');
      insert into public.challenges values ('${group}','${owner}','Test crew','Test description','active');
      insert into public.challenge_participants values ('${group}','${owner}','owner'),('${group}','${member}','member');
      insert into public.challenge_checkins values ('${group}','${member}');
    `);
    for (const file of ['20260912120000_store_entitlements_and_feedback.sql', '20260913090000_community_controls.sql']) {
      await db.exec(await readFile(path.resolve(__dirname, '../../supabase/migrations', file), 'utf8'));
    }
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${owner}';`);
    await expect(db.exec(`insert into public.user_blocks(blocker_id,blocked_id) values ('${member}','${owner}')`)).rejects.toThrow(/row-level security/);
    await db.exec(`insert into public.user_blocks(blocker_id,blocked_id) values ('${owner}','${member}')`);
    expect((await db.query('select * from public.get_blocked_users()')).rows).toEqual([{ user_id: member, display_name: 'Member' }]);
    await expect(db.exec(`select public.remove_reported_content('${report}')`)).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
    expect((await db.query('select user_id from public.challenge_participants')).rows).toEqual([{ user_id: owner }]);
    expect((await db.query('select * from public.challenge_checkins')).rows).toHaveLength(0);
    await expect(db.exec(`insert into public.challenge_participants values ('${group}','${member}','member')`)).rejects.toThrow(/chặn thành viên/);
    await expect(db.exec(`update public.challenges set title='fuck you' where id='${group}'`)).rejects.toThrow(/quấy rối/);
    await expect(db.exec(`update public.profiles set full_name='kill yourself' where id='${owner}'`)).rejects.toThrow(/quấy rối/);
    await db.exec(`insert into public.app_feedback(id,user_id,category,message,target_type,target_id) values ('${report}','${owner}','challenge_report','A report to review','challenge','${group}'); set role service_role; select public.remove_reported_content('${report}'); reset role;`);
    expect((await db.query('select title,description,status from public.challenges')).rows).toEqual([{ title: 'Nội dung đã được gỡ', description: null, status: 'cancelled' }]);
    expect((await db.query('select status from public.app_feedback')).rows).toEqual([{ status: 'resolved' }]);

    // A member blocking the owner leaves the group, rather than removing its owner.
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${owner}'; delete from public.user_blocks; reset role;
      insert into public.challenge_participants values ('${group}','${member}','member');
      set role authenticated; set request.jwt.claim.sub = '${member}';
      insert into public.user_blocks(blocker_id,blocked_id) values ('${member}','${owner}'); reset role;`);
    expect((await db.query('select user_id from public.challenge_participants')).rows).toEqual([{ user_id: owner }]);
  } finally { await db.close(); }
}, 30_000);
