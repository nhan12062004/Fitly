import { runPremiumMondayAutoPlanner } from './app';
import { runBackgroundJob, runPrivacyMaintenance, privacyRunKey } from './services/backgroundJobService';
import { logOperational } from './lib/operationalLogger';

async function main() {
  const name = process.argv[2];
  if (!['premium','privacy'].includes(name)) throw new Error('Use premium or privacy');
  await runBackgroundJob(name === 'premium' ? 'premium_auto_planner' : 'privacy_maintenance', async () => {
    if (name === 'privacy') await runPrivacyMaintenance();
    else {
      if (process.env.AI_ENABLED === 'false') throw new Error('AI disabled');
      const result = await runPremiumMondayAutoPlanner();
      if (result.failed) throw new Error('Premium planner had failed items');
    }
  },name === 'privacy' ? privacyRunKey() : undefined);
}
void main().catch((error) => {
  logOperational({ level:'error',event:'background_job_failed',errorCode:'JOB_FAILED',message:error });
  process.exitCode = 1;
});
