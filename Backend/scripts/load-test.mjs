import { parse } from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

if (process.argv.includes('--help')) {
  console.log('Staging only: LOAD_API_URL, LOAD_SUPABASE_URL, LOAD_SUPABASE_KEY, LOAD_FIXTURES_FILE; optional LOAD_VUS=10,50,100 LOAD_PHASE_SECONDS=600 LOAD_REPORT_FILE=/tmp/fitly-load-report.json. No AI provider calls.');
  process.exit(0);
}
const required = (name) => { if (!process.env[name]) throw new Error(`Missing ${name}`); return process.env[name]; };
const api = new URL(required('LOAD_API_URL'));
const database = new URL(required('LOAD_SUPABASE_URL'));
if (process.env.LOAD_CONFIRM_STAGING !== 'FITLY_STAGING_ONLY') throw new Error('Set LOAD_CONFIRM_STAGING=FITLY_STAGING_ONLY after verifying both staging URLs');
if (['trendfit.onrender.com','trend-fit.vercel.app'].includes(api.hostname)) throw new Error('Production load testing is disabled');
if (![api,database].every((url) => url.protocol === 'https:' || ['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('Use HTTPS for remote staging');
try {
  const production = parse(await readFile('.env','utf8')).SUPABASE_URL;
  if (production && new URL(production).origin === database.origin) throw new Error('Refusing to load test the project in Backend/.env');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const actors = JSON.parse(await readFile(required('LOAD_FIXTURES_FILE'),'utf8'));
const key = required('LOAD_SUPABASE_KEY');
const levels = (process.env.LOAD_VUS || '10,50,100').split(',').map(Number);
const seconds = Number(process.env.LOAD_PHASE_SECONDS || 600);
if (!levels.length || levels.some((n) => !Number.isInteger(n) || n < 1 || n > 1000) || !Number.isFinite(seconds) || seconds < 1 || seconds > 3600) throw new Error('Invalid load parameters');
if (actors.length < Math.max(...levels)) throw new Error('Provide one distinct account per virtual user');
if (new Set(actors.map((actor) => actor.userId)).size !== actors.length) throw new Error('Duplicate users in fixture file');
for (const actor of actors) {
  const claims = JSON.parse(Buffer.from(actor.accessToken.split('.')[1],'base64url').toString('utf8'));
  if (claims.sub !== actor.userId || new URL(claims.iss).origin !== database.origin) throw new Error('Fixture belongs to another user/project');
  if (claims.exp * 1000 < Date.now() + levels.length * seconds * 1000 + 60_000) throw new Error('Create fresh sessions or shorten the run before tokens expire');
}
const percentile = (rows,p) => rows.length ? rows[Math.max(0,Math.ceil(rows.length*p)-1)] : null;
const report = { startedAt:new Date().toISOString(), stages:[], containsRealAiCalls:false };
for (const users of levels) {
  const stop = performance.now()+seconds*1000;
  const samples = []; const statusCounts = {}; let errors = 0;
  await Promise.all(actors.slice(0,users).map(async (actor) => {
    while (performance.now() < stop) {
      const draw = Math.random();
      let url; let init = {};
      const headers = { Authorization:`Bearer ${actor.accessToken}` };
      if (draw < 0.25) url = new URL('/api/profile',api);
      else if (draw < 0.35) url = new URL('/api/ai/quota',api);
      else {
        url = new URL('/rest/v1/daily_progress_logs',database);
        headers.apikey = key;
        if (draw < 0.45) {
          init = { method:'POST',body:JSON.stringify({user_id:actor.userId,log_date:new Date().toISOString().slice(0,10),water_intake_ml:Math.floor(Math.random()*8)*250}) };
          headers['Content-Type'] = 'application/json'; headers.Prefer = 'resolution=merge-duplicates,return=minimal';
          url.searchParams.set('on_conflict','user_id,log_date');
        } else {
          url.searchParams.set('user_id',`eq.${actor.userId}`); url.searchParams.set('select','log_date,water_intake_ml,sleep_hours,calories_burned');
          url.searchParams.set('order','log_date.desc'); url.searchParams.set('limit','90');
        }
      }
      const start = performance.now();
      try {
        const response = await fetch(url,{...init,headers,signal:AbortSignal.timeout(10_000)});
        await response.arrayBuffer();
        statusCounts[response.status] = (statusCounts[response.status] || 0)+1;
        if (response.status >= 500) errors += 1;
      } catch { errors += 1; statusCounts.network = (statusCounts.network || 0)+1; }
      samples.push(performance.now()-start);
      await new Promise((resolve) => setTimeout(resolve,1500+Math.random()*1500));
    }
  }));
  samples.sort((a,b) => a-b);
  const stage = { users,seconds,requests:samples.length,p50Ms:percentile(samples,0.5),p95Ms:percentile(samples,0.95),p99Ms:percentile(samples,0.99),serverOrNetworkErrorRate:errors/Math.max(1,samples.length),statusCounts };
  report.stages.push(stage);
  // No URLs, JWTs, user IDs, health payloads or response bodies in reports/logs.
  console.log(JSON.stringify(stage));
}
report.completedAt = new Date().toISOString();
await writeFile(process.env.LOAD_REPORT_FILE || '/tmp/fitly-load-report.json',JSON.stringify(report,null,2),{mode:0o600});
if (report.stages.some((stage) => stage.serverOrNetworkErrorRate >= 0.01 || Object.keys(stage.statusCounts).some((status) => Number(status)>=400))) process.exitCode = 1;
