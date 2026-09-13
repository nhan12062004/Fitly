import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useIsFocused } from 'expo-router';
import { onlineManager, useQuery } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-cache';
import { useAuth } from '@/providers/auth-provider';
import { useTodayKey } from '@/providers/data-provider';

export function useResource<T>(domain: string, loader: () => Promise<T>, params: readonly unknown[] = [], staleTime = 180_000) {
  const { session } = useAuth();
  const isFocused = useIsFocused();
  const today = useTodayKey();
  const paramsKey = JSON.stringify(params);
  const key = useMemo(() => ['fitly', session?.user.id, domain, today, ...JSON.parse(paramsKey)], [session?.user.id, domain, today, paramsKey]);
  const query = useQuery({ queryKey: key, queryFn: loader, enabled: Boolean(session) && isFocused, staleTime });
  const { refetch, isStale } = query;
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(useCallback(() => {
    if (session && isStale) void refetch({ cancelRefetch: false });
  }, [session, isStale, refetch]));

  const load = useCallback(() => onlineManager.isOnline() ? refetch({ cancelRefetch: false }) : Promise.resolve({ data: queryClient.getQueryData<T>(key), error: new Error('Bạn đang ngoại tuyến. Hãy kết nối mạng để làm mới.') }), [refetch, key]);
  const setData = useCallback((updater: T | ((previous: T | undefined) => T | undefined)) => {
    queryClient.setQueryData<T>(key, updater);
  }, [key]);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);
  return {
    ...query,
    state: query.data !== undefined ? 'ready' as const : query.isError || query.fetchStatus === 'paused' ? 'error' as const : 'loading' as const,
    errorMessage: query.error?.message ?? (query.fetchStatus === 'paused' ? 'Chưa có dữ liệu đã tải cho màn hình này. Hãy kết nối mạng rồi thử lại.' : null),
    load, refresh, refreshing, setData,
  };
}
