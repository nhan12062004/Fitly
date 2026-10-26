import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { aiQuotaResource } from '../lib/accountReads';

export function useAiQuota(userId: string | null | undefined, revision = 0) {
  const getSnapshot = useCallback(() => aiQuotaResource.read(userId), [userId]);
  const state = useSyncExternalStore(aiQuotaResource.subscribe, getSnapshot, getSnapshot);
  const previous = useRef({ userId, revision });
  const refresh = useCallback(() => {
    if (userId) void aiQuotaResource.load(userId, true).catch(() => undefined);
  }, [userId]);

  useEffect(() => {
    const changed = previous.current.userId === userId && previous.current.revision !== revision;
    previous.current = { userId, revision };
    if (userId) void aiQuotaResource.load(userId, changed).catch(() => undefined);
  }, [userId, revision]);

  useEffect(() => {
    const onFocus = () => {
      if (userId && document.visibilityState === 'visible') void aiQuotaResource.load(userId).catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [userId]);

  return { ...state, loading: !state.data && !state.error, refresh };
}
