import React, { createContext, useContext, useState, ReactNode, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/Supabase';
import { User } from '@supabase/supabase-js';
import AuthModal from '../components/AuthModal';
import LoadingScreen from '../components/LoadingScreen';
import { useNavigate } from 'react-router';

import { resolveMembership, type MembershipState, type MembershipTier, type StoreMembership } from '../../../shared/membership';
export type { MembershipTier } from '../../../shared/membership';

interface AuthContextType {
  isLoggedIn: boolean;
  user: User | null;
  profile: any | null;
  hasProfile: boolean;
  isCheckingProfile: boolean;
  userRole: string | null;
  membershipTier: MembershipTier;
  membership: MembershipState;
  isPremium: boolean;
  isAdmin: boolean;
  signOut: () => Promise<void>;
  openAuthModal: (mode?: 'login' | 'signup') => void;
  closeAuthModal: () => void;
  openPremiumModal: () => void;
  closePremiumModal: () => void;
  refreshProfile: () => Promise<void>;
  refreshTick: number;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const getSupabaseAuthType = () => {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));

  return searchParams.get('type') || hashParams.get('type');
};

const moveRecoveryLinkToResetPage = () => {
  if (window.location.pathname === '/reset-password') return false;

  window.location.replace(`/reset-password${window.location.search}${window.location.hash}`);
  return true;
};

const normalizeVerifiedEmailRedirect = () => {
  const verifiedLoginPath = '/login?verified=1';

  if (
    window.location.pathname === '/login' &&
    window.location.search === '?verified=1' &&
    !window.location.hash
  ) {
    return false;
  }

  window.location.replace(verifiedLoginPath);
  return true;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [hasProfile, setHasProfile] = useState(false);
  const [isCheckingProfile, setIsCheckingProfile] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [storeMembership, setStoreMembership] = useState<StoreMembership | null>(null);
  const [membershipNow, setMembershipNow] = useState(Date.now);
  const membership = useMemo(() => resolveMembership(profile, storeMembership, membershipNow), [profile, storeMembership, membershipNow]);
  const membershipTier = membership.tier;
  const profileRequestId = useRef(0);
  const [loading, setLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [refreshTick, setRefreshTick] = useState(0);

  const checkProfile = async (userId: string) => {
    const requestId = ++profileRequestId.current;
    setIsCheckingProfile(true);
    try {
      const [profileResult, lifestyleResult, storeResult] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
        supabase.from('lifestyle_settings').select('user_id').eq('user_id', userId).maybeSingle(),
        // Owner-only RLS exposes the verified subscription, never store credentials.
        supabase.from('store_entitlements').select('tier, expires_at').eq('user_id', userId).maybeSingle(),
      ]);
      if (requestId !== profileRequestId.current) return;
      if (profileResult.error) throw profileResult.error;
      const profileData = profileResult.data;
      const lifestyleData = lifestyleResult.data;

      setProfile(profileData || null);
      // hasProfile chỉ là true khi ĐÃ CÓ profile và ĐÃ HOÀN THÀNH survey
      setHasProfile(!!profileData && !!lifestyleData);
      setUserRole(profileData?.role || 'user');
      setStoreMembership(storeResult.error ? null : storeResult.data);
      setMembershipNow(Date.now());
    } catch (error) {
      if (requestId !== profileRequestId.current) return;
      console.error('Error checking profile/survey status:', error);
      setProfile(null);
      setHasProfile(false);
      setStoreMembership(null);
    } finally {
      if (requestId === profileRequestId.current) setIsCheckingProfile(false);
    }
  };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const updateClock = () => {
      const now = Date.now();
      setMembershipNow(now);
      const expiresAt = Date.parse(membership.expiresAt || '');
      if (expiresAt > now) timer = setTimeout(updateClock, Math.min(expiresAt - now + 10, 2_147_483_647));
    };
    const onFocus = () => setMembershipNow(Date.now());
    updateClock();
    window.addEventListener('focus', onFocus);
    return () => { clearTimeout(timer); window.removeEventListener('focus', onFocus); };
  }, [membership.expiresAt]);

  useEffect(() => {
    const handleInitialAuthUrl = async () => {
      const searchParams = new URLSearchParams(window.location.search);
      const authType = getSupabaseAuthType();

      if (authType === 'recovery') {
        return moveRecoveryLinkToResetPage() ? 'redirected' : 'default';
      }

      if (window.location.pathname === '/reset-password') {
        return 'default';
      }

      const isEmailConfirmation =
        searchParams.get('verified') === '1' ||
        authType === 'signup' ||
        authType === 'email_verification' ||
        authType === 'email';

      if (isEmailConfirmation) {
        await supabase.auth.signOut();
        const redirected = normalizeVerifiedEmailRedirect();
        return redirected ? 'redirected' : 'signed-out';
      }

      return 'default';
    };

    let mounted = true;

    const initializeAuth = async () => {
      const initialAction = await handleInitialAuthUrl();
      if (initialAction === 'redirected') return;

      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;

      const currentUser = session?.user ?? null;
      setUser(currentUser);
      if (currentUser) {
        checkProfile(currentUser.id).finally(() => setLoading(false));
      } else {
        profileRequestId.current += 1;
        setLoading(false);
        setIsCheckingProfile(false);
      }
    };

    void initializeAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        moveRecoveryLinkToResetPage();
      }

      const currentUser = session?.user ?? null;
      setUser(currentUser);
      if (currentUser) {
        checkProfile(currentUser.id);
        setIsAuthModalOpen(false);
      } else {
        profileRequestId.current += 1;
        setProfile(null);
        setHasProfile(false);
        setUserRole(null);
        setStoreMembership(null);
        setIsCheckingProfile(false);
        setRefreshTick(0);
      }
    });

    let realtimeChannel: any = null;
    
    const setupRealtime = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user || realtimeChannel) return;

        const channelTopic = `realtime_sync_${session.user.id}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        realtimeChannel = supabase.channel(channelTopic)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${session.user.id}` }, () => {
            void checkProfile(session.user.id);
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'store_entitlements', filter: `user_id=eq.${session.user.id}` }, () => {
            void checkProfile(session.user.id);
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_progress_logs', filter: `user_id=eq.${session.user.id}` }, () => {
            setRefreshTick(prev => prev + 1);
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_exercise_sessions', filter: `user_id=eq.${session.user.id}` }, () => {
            setRefreshTick(prev => prev + 1);
          })
          .subscribe((status) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              if (realtimeChannel) {
                void supabase.removeChannel(realtimeChannel);
                realtimeChannel = null;
              }
            }
          });
      } catch {
        realtimeChannel = null;
      }
    }
    
    setupRealtime();

    return () => {
      mounted = false;
      profileRequestId.current += 1;
      subscription.unsubscribe();
      if (realtimeChannel) supabase.removeChannel(realtimeChannel);
    };
  }, []);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Error during signOut:', error);
    } finally {
      profileRequestId.current += 1;
      setUser(null);
      setProfile(null);
      setHasProfile(false);
      setUserRole(null);
      setStoreMembership(null);
      setRefreshTick(0);
      
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (e) {
        console.error('Error clearing storage:', e);
      }
      
      window.location.href = '/';
    }
  };

  const openAuthModal = (mode: 'login' | 'signup' = 'login') => {
    setAuthMode(mode);
    setIsAuthModalOpen(true);
  };
  const closeAuthModal = () => setIsAuthModalOpen(false);
  const openPremiumModal = () => {
    navigate('/premium');
  };
  const closePremiumModal = () => undefined;
  const refreshProfile = async () => {
    if (user) {
      await checkProfile(user.id);
      setRefreshTick(prev => prev + 1);
    }
  };

  return (
    <AuthContext.Provider value={{
      isLoggedIn: !!user,
      user,
      profile,
      hasProfile,
      isCheckingProfile,
      userRole,
      membershipTier,
      membership,
      isPremium: membershipTier === 'pro',
      isAdmin: userRole === 'admin',
      signOut,
      openAuthModal,
      closeAuthModal,
      openPremiumModal,
      closePremiumModal,
      refreshProfile,
      refreshTick
    }}>
      {loading ? <LoadingScreen fullScreen /> : children}
      <AuthModal isOpen={isAuthModalOpen} initialMode={authMode} onClose={closeAuthModal} />
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
