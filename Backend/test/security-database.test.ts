import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './database';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
let db: PGlite;
const value = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0];
const asUser = async (id: string) => {
  await db.exec('reset role; set local role authenticated');
  await db.query(`select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)`,[id]);
};
const asServer = async () => { await db.exec('reset role'); };
beforeAll(async () => { db = await createTestDatabase(); }, 60_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('begin');
  await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,'a@example.invalid',now()),($2,'b@example.invalid',now())`,[A,B]);
  await db.query(`insert into public.profiles(id,full_name,ref_code) values($1,'A','AAAAAA'),($2,'B','BBBBBB')`,[A,B]);
});
afterEach(async () => { await db.exec('rollback; reset role'); });

describe('production security migrations', () => {
  it('allows one verified referral claim and cannot reset or repeat the reward', async () => {
    await asUser(B);
    expect((await value(`select public.claim_referral('AAAAAA') ok`)).ok).toBe(true);
    expect((await value(`select public.claim_referral('AAAAAA') ok`)).ok).toBe(true);
    await asServer();
    expect((await value('select referral_count from profiles where id=$1',[A])).referral_count).toBe(1);
    expect((await value(`select count(*)::int n from referral_events`)).n).toBe(1);
    await asUser(B);
    await db.exec('savepoint forbidden');
    await expect(db.query('update public.profiles set referred_by=null where id=$1',[B])).rejects.toMatchObject({ code:'42501' });
    await db.exec('rollback to savepoint forbidden');
    expect((await value('select public.claim_referral($1) ok',['BBBBBB'])).ok).toBe(false);
  });

  it('denies entitlement, ledger, adjustment and meal-plan writes from clients', async () => {
    const rights = await value(`select
      has_column_privilege('authenticated','public.profiles','membership_tier','UPDATE') membership,
      has_column_privilege('authenticated','public.profiles','referred_by','UPDATE') referral,
      has_table_privilege('authenticated','public.ai_quota_usage_events','INSERT') ledger,
      has_table_privilege('authenticated','public.ai_plan_adjustments','DELETE') adjustment,
      has_table_privilege('authenticated','public.weekly_food_items','INSERT') meals,
      has_table_privilege('authenticated','public.weekly_food_plans','UPDATE') plans`);
    expect(Object.values(rights!)).toEqual([false,false,false,false,false,false]);
    await asUser(A);
    expect((await db.query('select id from public.profiles')).rows).toEqual([{ id:A }]);
  });

  it('reserves the last quota once and replays a completed request without charging twice', async () => {
    const start = async (key: string) => (await value(`select public.begin_api_operation($1,'chat',$2,$3,'chatMessages',1,now()-interval '1 day',null,8,100) result`,[A,key.repeat(64),'f'.repeat(64)])).result;
    const first = await start('a');
    expect(first.kind).toBe('started');
    expect((await start('b')).kind).toBe('busy');
    await db.query(`select public.finish_api_operation($1,200,'{"reply":"ok"}',true)`,[first.id]);
    expect((await start('a')).kind).toBe('replay');
    expect((await start('b')).kind).toBe('exhausted');
    expect((await value('select count(*)::int n from ai_quota_usage_events')).n).toBe(1);
  });

  it('refunds a failed operation once and binds each request key to its content', async () => {
    const args = [A,'a'.repeat(64),'b'.repeat(64)];
    const first = (await value(`select public.begin_api_operation($1,'chat',$2,$3,'chatMessages',1,now()-interval '1 day',null,8,100) result`,args)).result;
    await db.query(`select public.finish_api_operation($1,502,'{"error":"unavailable"}',false)`,[first.id]);
    expect((await value('select count(*)::int n from ai_quota_usage_events')).n).toBe(0);
    const conflict = (await value(`select public.begin_api_operation($1,'chat',$2,$3,null,null,null,null,8,100) result`,[A,args[1],'c'.repeat(64)])).result;
    expect(conflict.kind).toBe('conflict');
  });

  it('admits only one of 20 simultaneous requests for the final quota', async () => {
    const attempts = await Promise.all(Array.from({length:20},(_,index) => value(
      `select public.begin_api_operation($1,'chat',$2,$3,'chatMessages',1,now()-interval '1 day',null,8,100) result`,
      [A,index.toString(16).padStart(64,'0'),'e'.repeat(64)])));
    expect(attempts.filter((item) => item.result.kind === 'started')).toHaveLength(1);
    expect((await value('select count(*)::int n from ai_quota_usage_events')).n).toBe(1);
  });

  it('records consent and revocation using server time, idempotently', async () => {
    await asUser(A);
    await db.exec(`select public.set_ai_data_consent(true,1); select public.set_ai_data_consent(true,1)`);
    expect((await value('select count(*)::int n from ai_consent_events')).n).toBe(1);
    await db.exec(`select public.set_ai_data_consent(false,1); select public.set_ai_data_consent(false,1)`);
    expect((await value('select count(*)::int n from ai_consent_events')).n).toBe(2);
    expect((await value('select count(*)::int n from ai_data_consents')).n).toBe(0);
    await asUser(B);
    expect((await value('select count(*)::int n from ai_consent_events')).n).toBe(0);
  });

  it('keeps the last saved meal plan if any replacement item fails, and rejects stale versions', async () => {
    await db.exec(`insert into recipes(id,name,meal_type,calories,protein,carbs,fat) values('rice','Rice',array['lunch'],200,4,40,1)`);
    const profile = await value('select updated_at from profiles where id=$1',[A]);
    const recipe = await value(`select updated_at from recipes where id='rice'`);
    const rows = [{id:null,day_of_week:0,meal_type:'lunch',recipe_id:'rice',quantity:1,order_index:0,is_rest_day:false,recipe_updated_at:recipe.updated_at}];
    const save = async (id: string | null, version: number | null, items: unknown, key: string) => (await value(`select public.replace_meal_plan_atomically($1,$2,$3,'Plan','2026-10-26',$4,$5,null,null,$6,$7) result`,[A,id,version,JSON.stringify(items),profile.updated_at,key,key])).result;
    const saved = await save(null,null,rows,'first');
    expect(saved.items).toHaveLength(1);
    expect((await save(null,null,rows,'first')).planId).toBe(saved.planId);
    await db.exec('savepoint failing_meal');
    await expect(save(saved.planId,saved.version,[{...rows[0],recipe_id:'nonexistent'}],'broken')).rejects.toThrow();
    await db.exec('rollback to savepoint failing_meal');
    expect((await value('select count(*)::int n from weekly_food_items where food_plan_id=$1',[saved.planId])).n).toBe(1);
    const second = await save(saved.planId,saved.version,[{...rows[0],id:saved.items[0].id,quantity:2}],'second');
    expect(second.version).toBeGreaterThan(saved.version);
    expect(second.items[0].id).toBe(saved.items[0].id);
    await db.exec('savepoint stale');
    await expect(save(saved.planId,saved.version,rows,'stale')).rejects.toMatchObject({code:'40001'});
    await db.exec('rollback to savepoint stale');
    const owner = await value('select updated_at from profiles where id=$1',[B]);
    await db.exec('savepoint other_user');
    await expect(value(`select public.replace_meal_plan_atomically($1,$2,1,'Plan','2026-10-26','[]',$3,null,null,'cross','cross')`,[B,saved.planId,owner.updated_at])).rejects.toMatchObject({code:'42501'});
    await db.exec('rollback to savepoint other_user');
  });

  it('publishes a replacement workout atomically and retains the old active plan on failure', async () => {
    const firstId = '30000000-0000-4000-8000-000000000001';
    const nextId = '30000000-0000-4000-8000-000000000002';
    const publish = (id: string, rows: unknown) => db.query(`select public.publish_coach_plan_atomically($1,'2026-10-26',$2,'{"name":"Training"}',$3,null,null,null,'ai_coach_generate',jsonb_build_object('profile',(select updated_at from profiles where id=$1)))`,[A,id,JSON.stringify(rows)]);
    const rows = [{day_of_week:0,order_index:0,is_rest_day:true}];
    await publish(firstId,rows);
    await db.exec('savepoint failed_publication');
    await expect(publish(nextId,[{day_of_week:9,order_index:0}])).rejects.toThrow();
    await db.exec('rollback to savepoint failed_publication');
    expect((await value(`select id from weekly_plans where user_id=$1 and plan_status='active'`,[A])).id).toBe(firstId);
    await publish(nextId,rows);
    expect((await value(`select id from weekly_plans where user_id=$1 and plan_status='active'`,[A])).id).toBe(nextId);
    expect((await value(`select plan_status from weekly_plans where id=$1`,[firstId])).plan_status).toBe('adjusted');
  });

  it('publishes only the missing half of a weekly plan', async () => {
    const mealId = '40000000-0000-4000-8000-000000000001';
    const workoutId = '40000000-0000-4000-8000-000000000002';
    const mealRows = [{ day_of_week: 0, meal_type: 'breakfast', order_index: 0, is_rest_day: true }];
    const workoutRows = [{ day_of_week: 0, order_index: 0, is_rest_day: true }];
    const publish = (userId: string, workout: string | null, meal: string | null) => value(
      `select public.publish_coach_plan_atomically($1,'2026-10-26',$2,'{"name":"Training"}',$3,$4,'{"name":"Meals"}',$5,'premium_auto_generate',jsonb_build_object('profile',(select updated_at from profiles where id=$1)))`,
      [userId, workout, workout ? JSON.stringify(workoutRows) : null, meal, meal ? JSON.stringify(mealRows) : null],
    );
    await publish(A, null, mealId);
    await publish(A, workoutId, null);
    expect((await value(`select id from weekly_food_plans where user_id=$1 and plan_status='active'`, [A])).id).toBe(mealId);
    expect((await value(`select id from weekly_plans where user_id=$1 and plan_status='active'`, [A])).id).toBe(workoutId);

    await publish(B, workoutId.replace(/2$/, '3'), null);
    await publish(B, null, mealId.replace(/1$/, '4'));
    expect((await value(`select count(*)::int n from weekly_plans where user_id=$1 and plan_status='active'`, [B])).n).toBe(1);
    expect((await value(`select count(*)::int n from weekly_food_plans where user_id=$1 and plan_status='active'`, [B])).n).toBe(1);
  });

  it('saves a survey in one transaction and rejects attempts to supply system fields', async () => {
    await asUser(A);
    const profile = {full_name:'Updated',gender:'Nam',birthday:'1995-01-01'};
    const body = {height:175,weight:70,target_weight:72};
    const lifestyle = {weekly_workouts:3,meals_per_day:3};
    const health = {sleep_hours:7,allergies:[]};
    const save = (data: object) => db.query('select public.save_onboarding_survey($1,$2,$3,$4)',[JSON.stringify(profile),JSON.stringify(data),JSON.stringify(lifestyle),JSON.stringify(health)]);
    await db.exec('savepoint bad_survey');
    await expect(save({...body,user_id:B})).rejects.toMatchObject({code:'42501'});
    await db.exec('rollback to savepoint bad_survey');
    expect((await value('select full_name from profiles where id=$1',[A])).full_name).toBe('A');
    expect((await value('select count(*)::int n from body_metrics')).n).toBe(0);
    await save(body);
    expect((await value('select full_name from profiles where id=$1',[A])).full_name).toBe('Updated');
    expect((await value('select count(*)::int n from body_metrics')).n).toBe(1);
    expect((await value('select count(*)::int n from health_conditions')).n).toBe(1);
    expect((await value('select count(*)::int n from lifestyle_settings')).n).toBe(1);
  });

  it('rejects publishing a plan after its safety profile snapshot changes', async () => {
    const profile = await value('select updated_at from profiles where id=$1',[A]);
    await db.query(`update profiles set full_name='Changed while AI was working' where id=$1`,[A]);
    await db.exec('savepoint changed_safety');
    await expect(value(`select public.publish_coach_plan_atomically($1,'2026-10-26',$2,'{"name":"Training"}','[{"day_of_week":0,"order_index":0,"is_rest_day":true}]',null,null,null,'ai_coach_generate',$3)`,[
      A,'30000000-0000-4000-8000-000000000003',JSON.stringify({profile:profile.updated_at}),
    ])).rejects.toMatchObject({code:'40001'});
    await db.exec('rollback to savepoint changed_safety');
    expect((await value('select count(*)::int n from weekly_plans where user_id=$1',[A])).n).toBe(0);
  });

  it('commits meal adjustment contents and status together, and bumps the plan version', async () => {
    await db.exec(`insert into recipes(id,name,meal_type,calories) values('first','First',array['lunch'],200),('next','Next',array['lunch'],300)`);
    const plan = await value(`insert into weekly_food_plans(user_id,week_start_date) values($1,'2026-10-26') returning id,version`,[A]);
    const item = await value(`insert into weekly_food_items(food_plan_id,day_of_week,meal_type,recipe_id,order_index) values($1,0,'lunch','first',0) returning id`,[plan.id]);
    const adjustment = await value(`insert into ai_plan_adjustments(user_id,plan_type,status) values($1,'meal','proposed') returning id`,[A]);
    const profile = await value('select updated_at from profiles where id=$1',[A]);
    const recipe = await value(`select updated_at from recipes where id='next'`);
    const apply = (quantity: number) => value(`select public.apply_meal_adjustment_atomically($1,$2,'apply-key',$3,$4,'next',0,'lunch',$5,$6,null,null,$7) result`,[A,adjustment.id,plan.id,item.id,quantity,profile.updated_at,recipe.updated_at]);
    await db.exec('savepoint bad_adjustment');
    await expect(apply(999)).rejects.toThrow();
    await db.exec('rollback to savepoint bad_adjustment');
    expect((await value('select recipe_id from weekly_food_items where id=$1',[item.id])).recipe_id).toBe('first');
    expect((await value('select status from ai_plan_adjustments where id=$1',[adjustment.id])).status).toBe('proposed');
    await apply(2);
    expect((await apply(2)).result.already_applied).toBe(true);
    expect((await value('select recipe_id,calories from weekly_food_items where id=$1',[item.id])).recipe_id).toBe('next');
    expect(Number((await value('select version from weekly_food_plans where id=$1',[plan.id])).version)).toBe(1);
  });

  it('does not grant authenticated users access to privileged request/RPC internals', async () => {
    const rights = await value(`select
      has_table_privilege('authenticated','public.api_operations','SELECT') operations,
      has_table_privilege('authenticated','public.ai_provider_calls','INSERT') provider,
      has_function_privilege('authenticated','public.begin_api_operation(uuid,text,text,text,text,integer,timestamptz,timestamptz,integer,integer)','EXECUTE') admission,
      has_function_privilege('authenticated','public.publish_coach_plan_atomically(uuid,date,uuid,jsonb,jsonb,uuid,jsonb,jsonb,text,jsonb)','EXECUTE') publish`);
    expect(Object.values(rights!)).toEqual([false,false,false,false]);
  });

  it('removes inherited Supabase grants while preserving owner edits and signed-in RPCs', async () => {
    const rights = await value(`select
      has_table_privilege('authenticated','public.profiles','DELETE') delete_profile,
      has_table_privilege('authenticated','public.ai_quota_usage_events','SELECT') quota,
      has_table_privilege('anon','public.profiles','SELECT') anonymous_profile,
      has_function_privilege('authenticated','public.add_exp(uuid,integer)','EXECUTE') award_exp,
      has_function_privilege('anon','public.sync_challenge_checkin(text,uuid,jsonb)','EXECUTE') anonymous_checkin,
      has_function_privilege('authenticated','public.sync_challenge_checkin(text,uuid,jsonb)','EXECUTE') checkin,
      has_function_privilege('service_role','public.add_exp(uuid,integer)','EXECUTE') server_exp`);
    expect(Object.values(rights!)).toEqual([false,false,false,false,false,false,true]);
    await asUser(A);
    expect((await db.query(`update public.profiles set full_name='Owner edit' where id=$1 returning full_name`,[A])).rows)
      .toEqual([{full_name:'Owner edit'}]);
    expect((await db.query(`update public.profiles set full_name='Cross-user edit' where id=$1 returning id`,[B])).rows).toEqual([]);
    await db.exec('savepoint forbidden_delete');
    await expect(db.query('delete from public.profiles where id=$1',[B])).rejects.toMatchObject({code:'42501'});
    await db.exec('rollback to savepoint forbidden_delete');
    await asServer();
    await db.exec(`create table public.default_acl_probe(id integer); create function public.default_acl_probe() returns integer language sql as 'select 1'`);
    const defaults = await value(`select
      has_table_privilege('authenticated','public.default_acl_probe','SELECT') table_access,
      has_table_privilege('anon','public.default_acl_probe','SELECT') anon_table,
      has_function_privilege('authenticated','public.default_acl_probe()','EXECUTE') function_access,
      has_function_privilege('anon','public.default_acl_probe()','EXECUTE') anon_function`);
    expect(Object.values(defaults!)).toEqual([false,false,false,false]);
  });

  it('records challenge activity only after a matching completed action', async () => {
    const rights = await value(`select
      has_table_privilege('authenticated','public.challenges','UPDATE') edit_challenge,
      has_table_privilege('authenticated','public.challenges','DELETE') delete_challenge,
      has_table_privilege('authenticated','public.challenge_participants','INSERT') add_member,
      has_table_privilege('authenticated','public.challenge_checkins','INSERT') add_checkin`);
    expect(Object.values(rights!)).toEqual([false,false,false,false]);
    const today = (await value(`select (timezone('Asia/Ho_Chi_Minh', now()))::date::text today`)).today;
    const workout = await value(`insert into challenges(created_by,title,mode,start_date,end_date,target,max_members)
      values($1,'Workout','solo',$2,$2,'{"goal_key":"workout"}',1) returning id`,[A,today]);
    const water = await value(`insert into challenges(created_by,title,mode,start_date,end_date,target,max_members)
      values($1,'Water','solo',$2,$2,'{"goal_key":"water"}',1) returning id`,[A,today]);
    await db.query(`insert into challenge_participants(challenge_id,user_id,role) values($1,$3,'owner'),($2,$3,'owner')`,[workout.id,water.id,A]);
    const session = await value(`insert into daily_workout_sessions(user_id,log_date,status,started_at)
      values($1,$2,'in_progress',now()) returning id`,[A,today]);
    await db.query(`insert into daily_exercise_sessions(user_id,log_date,is_completed,completed_sets)
      values($1,$2,false,1)`,[A,today]);
    expect((await value(`select count(*)::int n from challenge_checkins where user_id=$1`,[A])).n).toBe(0);
    await db.query(`update daily_workout_sessions set status='completed',completed_at=now() where id=$1`,[session.id]);
    expect((await value(`select count(*)::int n from challenge_checkins where challenge_id=$1`,[workout.id])).n).toBe(1);
    expect((await value(`select count(*)::int n from challenge_checkins where challenge_id=$1`,[water.id])).n).toBe(0);
    await asUser(A);
    expect((await value(`select public.manual_challenge_checkin($1) checked`,[water.id])).checked).toBe(false);
    await asServer();
    await db.query(`insert into daily_progress_logs(user_id,log_date,water_intake_ml) values($1,$2,250)`,[A,today]);
    expect((await value(`select count(*)::int n from challenge_checkins where challenge_id=$1`,[water.id])).n).toBe(1);

    await asUser(A);
    await db.exec('savepoint forged_checkin');
    await expect(db.query(`insert into challenge_checkins(challenge_id,user_id,checkin_date,source_type)
      values($1,$2,$3,'workout')`,[water.id,A,today])).rejects.toMatchObject({code:'42501'});
    await db.exec('rollback to savepoint forged_checkin');
    await db.exec('savepoint forged_rpc');
    await expect(db.query(`select public.sync_challenge_checkin('workout',null,'{}')`)).rejects.toMatchObject({code:'42501'});
    await db.exec('rollback to savepoint forged_rpc');
  });

  it('lets only the owner cancel a challenge and keeps its history', async () => {
    const today = (await value(`select (timezone('Asia/Ho_Chi_Minh', now()))::date::text today`)).today;
    const group = await value(`insert into challenges(created_by,title,mode,start_date,end_date,target,max_members)
      values($1,'Crew','crew',$2,null,'{"goal_key":"any"}',5) returning id`,[A,today]);
    await db.query(`insert into challenge_participants(challenge_id,user_id,role)
      values($1,$2,'owner'),($1,$3,'member')`,[group.id,A,B]);
    await asUser(B);
    expect((await value(`select public.cancel_challenge($1) cancelled`,[group.id])).cancelled).toBe(false);
    await asUser(A);
    expect((await value(`select public.manual_challenge_checkin($1) checked`,[group.id])).checked).toBe(true);
    expect((await value(`select public.cancel_challenge($1) cancelled`,[group.id])).cancelled).toBe(true);
    expect((await value(`select public.cancel_challenge($1) cancelled`,[group.id])).cancelled).toBe(false);
    expect((await value(`select public.manual_challenge_checkin($1) checked`,[group.id])).checked).toBe(false);
    await asServer();
    expect((await value(`select status, target->>'cancelled_date' cancelled_date from challenges where id=$1`,[group.id]))).toMatchObject({status:'cancelled',cancelled_date:today});
    expect((await value(`select count(*)::int n from challenge_checkins where challenge_id=$1`,[group.id])).n).toBe(1);
  });

  it('rotates a crew invite atomically and rejects the old code', async () => {
    const today = (await value(`select (timezone('Asia/Ho_Chi_Minh', now()))::date::text today`)).today;
    const group = await value(`insert into challenges(created_by,title,mode,start_date,end_date,target,max_members,invite_code)
      values($1,'Crew','crew',$2,null,'{"goal_key":"any"}',5,'OLD12345') returning id`,[A,today]);
    await db.query(`insert into challenge_participants(challenge_id,user_id,role) values($1,$2,'owner')`,[group.id,A]);
    await asUser(B);
    await db.exec('savepoint non_owner');
    await expect(value(`select public.rotate_challenge_invite_code($1) code`,[group.id])).rejects.toThrow();
    await db.exec('rollback to savepoint non_owner');
    await asUser(A);
    const newCode = (await value(`select public.rotate_challenge_invite_code($1) code`,[group.id])).code;
    expect(newCode).toMatch(/^[A-F0-9]{8}$/);
    expect(newCode).not.toBe('OLD12345');
    await asUser(B);
    await db.exec('savepoint old_code');
    await expect(value(`select public.join_challenge_by_invite_code('OLD12345') id`)).rejects.toThrow();
    await db.exec('rollback to savepoint old_code');
    expect((await value(`select public.join_challenge_by_invite_code($1) id`,[newCode])).id).toBe(group.id);
  });

  it('writes each completed set once with consistent logs, snapshots and calories', async () => {
    const session = (await value(`insert into daily_exercise_sessions(user_id,log_date,sets,planned_sets,estimated_kcal,order_index) values($1,'2026-10-26',3,3,90,0) returning id`,[A])).id;
    await db.query(`insert into daily_workout_sessions(user_id,log_date) values($1,'2026-10-26')`,[A]);
    const record = (version: number, target: number, calories: number) => value(`select public.record_workout_progress_atomically($1,$2,$3,$4,$5,60,'set') result`,[A,session,version,target,calories]);
    await record(0,1,30);
    expect((await record(0,1,30)).result.already_recorded).toBe(true);
    expect((await value(`select completed_sets from daily_exercise_sessions where id=$1`,[session])).completed_sets).toBe(1);
    expect((await value(`select count(*)::int n from daily_exercise_set_logs where daily_exercise_session_id=$1`,[session])).n).toBe(1);
    expect((await value(`select calories_burned from daily_progress_logs where user_id=$1`,[A])).calories_burned).toBe(30);
    await record(1,2,60);
    expect((await value(`select completed_sets from daily_workout_session_exercises where daily_exercise_session_id=$1`,[session])).completed_sets).toBe(2);
    await db.exec('savepoint stale_set');
    await expect(record(0,3,90)).rejects.toMatchObject({code:'40001'});
    await db.exec('rollback to savepoint stale_set');
    expect((await value(`select calories_burned from daily_progress_logs where user_id=$1`,[A])).calories_burned).toBe(60);
  });

  it('budgets provider attempts across users and background jobs', async () => {
    const first = await value(`select public.reserve_ai_provider_call(100,10,150,8) id`);
    expect(first.id).toBeTruthy();
    expect((await value(`select public.reserve_ai_provider_call(100,10,150,8) id`)).id).toBeNull();
    await db.query('update ai_provider_calls set actual_tokens=20,active=false where id=$1',[first.id]);
    expect((await value(`select public.reserve_ai_provider_call(100,10,150,8) id`)).id).toBeTruthy();
  });

  it('claims a daily background job once across scheduler instances', async () => {
    expect((await value(`select public.claim_background_job('premium','2026-10-26') id`)).id).toBeTruthy();
    expect((await value(`select public.claim_background_job('premium','2026-10-26') id`)).id).toBeNull();
  });

  it('deleting an auth account cascades to operation records, quota and consent history', async () => {
    await db.query(`select public.begin_api_operation($1,'chat',$2,$3,'chatMessages',1,now()-interval '1 day',null,8,100)`,[A,'a'.repeat(64),'b'.repeat(64)]);
    await asUser(A);
    await db.exec('select public.set_ai_data_consent(true,1)');
    await asServer();
    await db.query('delete from auth.users where id=$1',[A]);
    expect((await value('select count(*)::int n from api_operations where user_id=$1',[A])).n).toBe(0);
    expect((await value('select count(*)::int n from ai_quota_usage_events where user_id=$1',[A])).n).toBe(0);
    expect((await value('select count(*)::int n from ai_consent_events where user_id=$1',[A])).n).toBe(0);
  });
});
