import type { Session } from '@supabase/supabase-js';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { supabase } from '@/lib/supabase';

type AuthContextValue = {
  isLoading: boolean;
  session: Session | null;
  isPasswordRecovery: boolean;
  recoveryStatus: 'idle' | 'processing' | 'ready' | 'error';
  recoveryError: string | null;
  clearPasswordRecovery: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readDeepLinkParams(url: string) {
  const query = url.split('?')[1]?.split('#')[0] ?? '';
  const hash = url.split('#')[1] ?? '';
  return new URLSearchParams([query, hash].filter(Boolean).join('&'));
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState<AuthContextValue['recoveryStatus']>('idle');
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const consumeRecoveryLink = async (url: string | null) => {
      if (!url?.startsWith('fitly:')) return;

      const params = readDeepLinkParams(url);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const code = params.get('code');
      const redirectError = params.get('error_description') ?? params.get('error');
      const isRecoveryLink = params.get('type') === 'recovery' || Boolean(code) || Boolean(accessToken) || Boolean(redirectError);
      if (!isRecoveryLink) return;

      if (mounted) {
        setRecoveryStatus('processing');
        setRecoveryError(null);
      }
      try {
        if (redirectError) throw new Error(redirectError);
        const result = code
          ? await supabase.auth.exchangeCodeForSession(code)
          : accessToken && refreshToken
            ? await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
            : { data: { session: null }, error: new Error('Recovery link has no valid token.') };
        if (result.error || !result.data.session) throw result.error ?? new Error('Could not verify the recovery link.');

        if (mounted) {
          setSession(result.data.session);
          setIsPasswordRecovery(true);
          setRecoveryStatus('ready');
        }
      } catch (error) {
        if (mounted) {
          setIsPasswordRecovery(false);
          setRecoveryStatus('error');
          setRecoveryError(error instanceof Error ? error.message : 'Recovery link is invalid or expired.');
        }
      }
    };
    const initialize = async () => {
      await consumeRecoveryLink(await Linking.getInitialURL());
      let nextSession: Session | null = null;
      try {
        const { data } = await Promise.race([
          supabase.auth.getSession(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Auth session initialization timed out.')), 8000);
          }),
        ]);
        nextSession = data.session;
      } catch {
        // Do not leave the splash screen mounted forever when storage/network is unavailable.
        nextSession = null;
      }
      if (mounted) {
        setSession(nextSession);
        setIsLoading(false);
        await SplashScreen.hideAsync();
      }
    };
    void initialize();

    const { data: authSubscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setIsLoading(false);
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
        setRecoveryStatus('ready');
      }
    });
    const linkingSubscription = Linking.addEventListener('url', ({ url }) => {
      void consumeRecoveryLink(url);
    });
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });

    return () => {
      mounted = false;
      authSubscription.subscription.unsubscribe();
      linkingSubscription.remove();
      appStateSubscription.remove();
    };
  }, []);

  const value = useMemo(() => ({
    isLoading,
    session,
    isPasswordRecovery,
    recoveryStatus,
    recoveryError,
    clearPasswordRecovery: () => {
      setIsPasswordRecovery(false);
      setRecoveryStatus('idle');
      setRecoveryError(null);
    },
  }), [isLoading, session, isPasswordRecovery, recoveryStatus, recoveryError]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
};
