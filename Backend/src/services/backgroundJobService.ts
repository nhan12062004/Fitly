import { adminSupabase } from '../config/Supabase';
import { performAccountDeletion } from './accountDeletionService';
import { logOperational } from '../lib/operationalLogger';

export const vietnamRunKey = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Ho_Chi_Minh', year:'numeric',month:'2-digit',day:'2-digit' }).format(date);
export const privacyRunKey = () => `${vietnamRunKey()}-${new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',hourCycle:'h23'}).format(new Date())}`;

export async function runBackgroundJob(name: string, task: () => Promise<void>, key = vietnamRunKey()) {
  const claimed = await adminSupabase.rpc('claim_background_job', { p_job_name:name,p_run_key:key });
  if (claimed.error) throw claimed.error;
  if (!claimed.data) return false;
  try {
    await task();
    const saved = await adminSupabase.from('background_job_runs').update({ state:'completed',finished_at:new Date().toISOString() }).eq('id',claimed.data);
    if (saved.error) throw saved.error;
    return true;
  } catch (error) {
    await adminSupabase.from('background_job_runs').update({ state:'failed',finished_at:new Date().toISOString() }).eq('id',claimed.data);
    throw error;
  }
}

export async function runPrivacyMaintenance() {
  const pruned = await adminSupabase.rpc('prune_runtime_data');
  if (pruned.error) throw pruned.error;
  const pending = await adminSupabase.from('account_deletion_requests').select('user_id').order('requested_at').limit(100);
  if (pending.error) throw pending.error;
  let failures = 0;
  let consecutiveFailures = 0;
  for (const row of pending.data || []) {
    try { await performAccountDeletion(row.user_id); consecutiveFailures = 0; }
    catch {
      failures += 1; consecutiveFailures += 1;
      logOperational({ level:'error',event:'account_deletion_retry_failed',errorCode:'ACCOUNT_DELETION_FAILED' });
      if (consecutiveFailures >= 5) break;
    }
  }
  if (failures) throw new Error('Account deletion retries failed');
}
