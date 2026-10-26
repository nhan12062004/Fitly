import { createClient } from '@supabase/supabase-js';
import { parse } from 'dotenv';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

if (process.argv.includes('--help')) {
  console.log('Creates synthetic staging accounts/history only. Set LOAD_CONFIRM_STAGING=FITLY_STAGING_ONLY, LOAD_SUPABASE_URL, LOAD_SUPABASE_SERVICE_ROLE_KEY, LOAD_SUPABASE_KEY. Optional LOAD_USERS=1000 LOAD_SESSION_COUNT=100; --cleanup deletes users listed in load-fixtures/manifest.json.');
  process.exit(0);
}
const required = (name) => { if (!process.env[name]) throw new Error(`Missing ${name}`); return process.env[name]; };
const url = new URL(required('LOAD_SUPABASE_URL'));
if (process.env.LOAD_CONFIRM_STAGING !== 'FITLY_STAGING_ONLY') throw new Error('Explicit staging acknowledgement is required');
try {
  const production = parse(await readFile(path.resolve('.env'),'utf8')).SUPABASE_URL;
  if (production && new URL(production).origin === url.origin) throw new Error('Refusing to seed the project in Backend/.env');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const admin = createClient(url.origin,required('LOAD_SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init) => fetch(input,{...init,signal:AbortSignal.timeout(30_000)})}});
const directory = path.resolve('load-fixtures'); await mkdir(directory,{recursive:true,mode:0o700});
const manifestPath = path.join(directory,'manifest.json');
if (process.argv.includes('--cleanup')) {
  const manifest = JSON.parse(await readFile(manifestPath,'utf8'));
  if (manifest.project !== url.origin) throw new Error('Manifest/project mismatch');
  for (const id of manifest.userIds) {
    const {error} = await admin.auth.admin.deleteUser(id); if (error) throw new Error('Staging cleanup failed');
  }
  console.log(`Deleted ${manifest.userIds.length} synthetic accounts`); process.exit(0);
}
try { await readFile(manifestPath); throw new Error('Clean up or move the existing staging fixture manifest before reseeding'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const count = Number(process.env.LOAD_USERS || 1000);
const sessions = Number(process.env.LOAD_SESSION_COUNT || 100);
if (![count,sessions].every((n) => Number.isInteger(n) && n>=1 && n<=1000) || sessions > count) throw new Error('Invalid seed size');
const runId = randomBytes(6).toString('hex');
const password = `Load-${randomBytes(24).toString('base64url')}aA1`;
const manifest = {project:url.origin,userIds:[]}; const actors = [];
const insert = async (table,rows) => {
  for (let offset=0;offset<rows.length;offset+=250) {
    const {error} = await admin.from(table).insert(rows.slice(offset,offset+250));
    if (error) throw new Error(`Synthetic insert failed for ${table}; clean up via the manifest before retrying`);
  }
};
for (let index=0;index<count;index+=1) {
  const email = `fitly-load-${runId}-${index}@example.invalid`;
  const {data,error} = await admin.auth.admin.createUser({email,password,email_confirm:true});
  if (error || !data.user) throw new Error('Staging Auth creation failed; no credentials are logged');
  const id = data.user.id; manifest.userIds.push(id);
  await writeFile(manifestPath,JSON.stringify(manifest),{mode:0o600});
  const profile = await admin.from('profiles').upsert({id,email,full_name:`Synthetic user ${index}`,membership_tier:'pro'});
  if (profile.error) throw new Error('Synthetic profile insert failed');
  const progress = []; const metrics = []; const workouts = [];
  for (let day=0;day<90;day+=1) {
    const date = new Date(Date.now()-day*86400000).toISOString().slice(0,10);
    progress.push({user_id:id,log_date:date,water_intake_ml:1500,sleep_hours:7,calories_burned:day%2===0?90:0});
    metrics.push({user_id:id,height:170,weight:70+(day%5)/10,target_weight:68,created_at:`${date}T05:00:00Z`});
    if (day%2===0) workouts.push({user_id:id,log_date:date,order_index:0,sets:3,completed_sets:3,is_completed:true,actual_kcal_estimated:90});
  }
  await insert('daily_progress_logs',progress); await insert('body_metrics',metrics); await insert('daily_exercise_sessions',workouts);
  if (index<sessions) actors.push({userId:id,email});
  if ((index+1)%50===0) console.log(`Prepared ${index+1}/${count} synthetic accounts`);
}
const fixtures = [];
for (const actor of actors) {
  const auth = createClient(url.origin,required('LOAD_SUPABASE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error} = await auth.auth.signInWithPassword({email:actor.email,password});
  if (error || !data.session) throw new Error('Staging sign-in failed; verify staging-only Auth rate limits');
  fixtures.push({userId:actor.userId,accessToken:data.session.access_token});
}
await writeFile(path.join(directory,'sessions.json'),JSON.stringify(fixtures),{mode:0o600});
console.log(`Prepared ${count} synthetic accounts with 90 days of history and ${sessions} load sessions. Private files are in the ignored load-fixtures directory.`);
