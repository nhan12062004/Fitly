import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 3 * 60_000,
      gcTime: 30 * 60_000,
      retry: (count, error) => count < 1 && (!('status' in error) || Number(error.status) >= 500),
      retryDelay: 1000,
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});

/** Read caches live only in memory and are scoped to the authenticated account. */
export const invalidateResources = (...domains: string[]) => queryClient.invalidateQueries({
  predicate: (query) => query.queryKey[0] === 'fitly' && (domains.length === 0 || domains.includes(String(query.queryKey[2]))),
});
