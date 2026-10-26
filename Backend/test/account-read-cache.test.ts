import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateReadAccount, createAccountResource } from '../../Frontend/src/lib/accountResource';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

beforeEach(() => { activateReadAccount(null); activateReadAccount('account-a'); });
afterEach(() => { activateReadAccount(null); vi.useRealTimers(); });

describe('account-scoped read resources', () => {
  it('deduplicates simultaneous prefetch, Profile and Coach reads', async () => {
    const response = deferred<number>();
    const loader = vi.fn(() => response.promise);
    const resource = createAccountResource(loader);
    const first = resource.load('account-a');
    const second = resource.load('account-a');
    const third = resource.load('account-a', true);
    expect(second).toBe(first);
    expect(third).toBe(first);
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    response.resolve(764);
    await first;
    expect(resource.read('account-a').data).toBe(764);
  });

  it('provides a synchronous warm snapshot and refetches after the freshness window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T05:00:00Z'));
    const loader = vi.fn().mockResolvedValueOnce(764).mockResolvedValueOnce(763);
    const resource = createAccountResource<number>(loader, 30_000);
    await resource.load('account-a');
    expect(resource.read('account-a').data).toBe(764);
    await resource.load('account-a');
    expect(loader).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_001);
    await resource.load('account-a');
    expect(resource.read('account-a').data).toBe(763);
  });

  it('prevents an older quota GET from overwriting a confirmed chat response', async () => {
    const response = deferred<number>();
    const resource = createAccountResource(() => response.promise);
    const pending = resource.load('account-a');
    resource.publish('account-a', 763);
    response.resolve(764);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(resource.read('account-a').data).toBe(763);
  });

  it('does not cache late responses after logout or a switch away and back', async () => {
    const response = deferred<string>();
    let signal: AbortSignal | undefined;
    const resource = createAccountResource((_id, requestSignal) => { signal = requestSignal; return response.promise; });
    const pending = resource.load('account-a');
    await Promise.resolve();
    activateReadAccount('account-b');
    expect(signal?.aborted).toBe(true);
    activateReadAccount('account-a');
    response.resolve('old personal information');
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(resource.read('account-a').data).toBeNull();
  });

  it('never serves another account or starts a read for a signed-out account', async () => {
    const loader = vi.fn(async () => 'private');
    const resource = createAccountResource(loader);
    await resource.load('account-a');
    activateReadAccount('account-b');
    expect(resource.read('account-a').data).toBeNull();
    expect(resource.read('account-b').data).toBeNull();
    await expect(resource.load('account-a')).rejects.toThrow('Tài khoản đã thay đổi');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('keeps a last-confirmed count with an error state instead of inventing zero after a failed refresh', async () => {
    const resource = createAccountResource<number>(vi.fn().mockResolvedValueOnce(764).mockRejectedValueOnce(new Error('offline')));
    await resource.load('account-a');
    await expect(resource.load('account-a', true)).rejects.toThrow('offline');
    expect(resource.read('account-a')).toMatchObject({ data: 764, fetching: false });
    expect(resource.read('account-a').error?.message).toBe('offline');
  });

  it('invalidates fresh personal details after a save', async () => {
    const loader = vi.fn().mockResolvedValueOnce(60).mockResolvedValueOnce(61);
    const resource = createAccountResource<number>(loader);
    await resource.load('account-a');
    resource.invalidate('account-a');
    await resource.load('account-a');
    expect(loader).toHaveBeenCalledTimes(2);
    expect(resource.read('account-a').data).toBe(61);
  });
});
