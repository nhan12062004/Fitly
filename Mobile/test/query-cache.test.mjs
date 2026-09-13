import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { queryClient, invalidateResources } from '../src/lib/query-cache.ts';

queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, gcTime: Infinity } });

afterEach(() => queryClient.clear());
const key = (user = 'alice', domain = 'workout', day = '2026-09-12') => ['fitly', user, domain, day];

test('returning to a fresh screen uses the same data without another request', async () => {
  let calls = 0;
  const options = { queryKey: key(), queryFn: async () => { calls++; return ['squat']; } };
  await queryClient.fetchQuery(options);
  assert.deepEqual(await queryClient.fetchQuery(options), ['squat']);
  assert.equal(calls, 1);
});
test('simultaneous list and detail reads share one in-flight request', async () => {
  let calls = 0;
  const options = { queryKey: key(), queryFn: async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return ['squat']; } };
  await Promise.all([queryClient.fetchQuery(options), queryClient.fetchQuery(options)]);
  assert.equal(calls, 1);
});
test('refresh failure retains previously loaded data', async () => {
  queryClient.setQueryData(key(), ['saved']);
  await assert.rejects(queryClient.fetchQuery({ queryKey: key(), staleTime: 0, retry: false, queryFn: async () => { throw new Error('offline'); } }));
  assert.deepEqual(queryClient.getQueryData(key()), ['saved']);
});
test('a workout mutation invalidates workout data without expiring recipes', async () => {
  queryClient.setQueryData(key(), ['old']);
  queryClient.setQueryData(key('alice', 'recipe'), ['recipe']);
  await invalidateResources('workout');
  assert.equal(queryClient.getQueryState(key())?.isInvalidated, true);
  assert.equal(queryClient.getQueryState(key('alice', 'recipe'))?.isInvalidated, false);
});
test('another account and another date cannot reuse the previous snapshot', () => {
  queryClient.setQueryData(key(), ['private']);
  assert.equal(queryClient.getQueryData(key('bob')), undefined);
  assert.equal(queryClient.getQueryData(key('alice', 'workout', '2026-09-13')), undefined);
});
test('logout cancels reads so late responses cannot repopulate the cache', async () => {
  let finish;
  const read = queryClient.fetchQuery({ queryKey: key(), queryFn: () => new Promise((resolve) => { finish = resolve; }) }).catch(() => undefined);
  queryClient.clear();
  finish(['private']);
  await read;
  assert.equal(queryClient.getQueryData(key()), undefined);
});
