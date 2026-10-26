import { afterEach, expect, it, vi } from 'vitest';
import { boundedFetch } from '../src/lib/network';
import { aiOperationContext, type AiExecution } from '../src/lib/aiExecutionContext';

afterEach(() => vi.unstubAllGlobals());
const context = (): AiExecution => ({ id:'test',userId:'user',quotaKey:'chatMessages',signal:new AbortController().signal,mutationAttempts:0,mutationMayHaveCommitted:false });
const url = 'https://example.invalid/rest/v1/rpc/publish_coach_plan_atomically';
it('keeps an uncertain write charged when a concurrent write receives a confirmed rollback', async () => {
  let rollback!: (response: Response) => void;
  vi.stubGlobal('fetch',vi.fn().mockImplementationOnce(() => new Promise((resolve) => { rollback=resolve; }))
    .mockResolvedValueOnce(new Response('{}',{status:200})));
  const execution = context();
  await aiOperationContext.run(execution,async () => {
    const failed = boundedFetch(url,{method:'POST'});
    await boundedFetch(url,{method:'POST'});
    rollback(new Response('{}',{status:400}));
    await failed;
  });
  expect(execution.mutationMayHaveCommitted).toBe(true);
  expect(execution.mutationAttempts).toBe(1);
});
it('distinguishes a confirmed rollback from a network failure with unknown commit status', async () => {
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('{}',{status:409})).mockRejectedValueOnce(new Error('Connection lost')));
  const execution = context();
  await aiOperationContext.run(execution,async () => {
    await boundedFetch(url,{method:'POST'});
    expect(execution.mutationMayHaveCommitted).toBe(false);
    await expect(boundedFetch(url,{method:'POST'})).rejects.toThrow('Connection lost');
  });
  expect(execution.mutationMayHaveCommitted).toBe(true);
});
it('preserves caller cancellation in addition to server deadlines', async () => {
  vi.stubGlobal('fetch',vi.fn((_input,init) => new Promise((_resolve,reject) => init.signal.addEventListener('abort',() => reject(init.signal.reason),{once:true}))));
  const controller = new AbortController();
  const pending = boundedFetch('https://example.invalid',{signal:controller.signal});
  controller.abort();
  await expect(pending).rejects.toMatchObject({name:'AbortError'});
});
