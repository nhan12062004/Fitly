import { getBoundedTimeoutMs } from '../config/runtime';
import { aiOperationContext } from './aiExecutionContext';

/** Bound both response headers and body; compose with caller cancellation. */
export const boundedFetch: typeof fetch = async (input, init = {}) => {
  const timeout = AbortSignal.timeout(getBoundedTimeoutMs(process.env.DATABASE_TIMEOUT_MS, 12_000, 1000, 60_000));
  const execution = aiOperationContext.getStore();
  const originalSignal = init.signal || (input instanceof Request ? input.signal : undefined);
  const method = init.method || (input instanceof Request ? input.method : 'GET');
  const signal = AbortSignal.any([timeout,...(originalSignal?[originalSignal]:[]),...(execution?[execution.signal]:[])]);
  const target = String(input instanceof Request ? input.url : input);
  const businessMutation = !['GET','HEAD'].includes(method.toUpperCase())
    && /\/rest\/v1\/(?:rpc\/(?:publish_coach_plan_atomically|replace_meal_plan_atomically|apply_workout_adjustment_atomically|apply_meal_adjustment_atomically)|(?:weekly_plans|weekly_food_plans|weekly_plan_exercises|weekly_food_items|daily_exercise_sessions|daily_workout_sessions|daily_progress_logs|ai_chat_messages)(?:\?|$))/.test(target);
  if (execution && businessMutation) { execution.mutationAttempts += 1; execution.mutationMayHaveCommitted = true; }
  const response = await fetch(input, { ...init, signal });
  const body = await response.arrayBuffer();
  // A complete 4xx database response confirms this statement rolled back.
  // Timeouts and 5xx responses have an unknown outcome and retain the charge.
  if (execution && businessMutation && response.status >= 400 && response.status < 500) {
    execution.mutationAttempts -= 1;
    execution.mutationMayHaveCommitted = execution.mutationAttempts > 0;
  }
  return new Response([204,205,304].includes(response.status) || method.toUpperCase() === 'HEAD' ? null : body, {
    status: response.status, statusText: response.statusText, headers: response.headers,
  });
};
