import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { AppState, NativeModules, Platform } from 'react-native';
import { focusManager, onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-cache';
import { getVietnamDateKey } from '@/lib/fitness-read-model';

const DateContext = createContext(getVietnamDateKey());
const OnlineContext = createContext(true);
export const useTodayKey = () => useContext(DateContext);
export const useOnline = () => useContext(OnlineContext);

export function DataProvider({ children }: PropsWithChildren) {
  const [today, setToday] = useState(getVietnamDateKey);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let unsubscribeNetwork: (() => void) | undefined;
    let disposed = false;
    if (Platform.OS === 'web' || NativeModules.RNCNetInfo) {
      void import('@react-native-community/netinfo').then(({ default: NetInfo }) => {
        if (disposed) return;
        unsubscribeNetwork = NetInfo.addEventListener((state) => {
          const connected = state.isConnected !== false && state.isInternetReachable !== false;
          setOnline(connected);
          onlineManager.setOnline(connected);
        });
      }).catch(() => undefined);
    }
    const update = () => setToday(getVietnamDateKey());
    const subscription = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
      if (state === 'active') update();
    });
    const timer = setInterval(update, 60_000);
    return () => { disposed = true; unsubscribeNetwork?.(); subscription.remove(); clearInterval(timer); };
  }, []);
  return <QueryClientProvider client={queryClient}><DateContext.Provider value={today}><OnlineContext.Provider value={online}>{children}</OnlineContext.Provider></DateContext.Provider></QueryClientProvider>;
}
