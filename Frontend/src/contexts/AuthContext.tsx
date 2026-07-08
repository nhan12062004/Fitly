import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { supabase } from '../lib/Supabase';
import { User } from '@supabase/supabase-js';
import AuthModal from '../components/AuthModal';
import LoadingScreen from '../components/LoadingScreen';
import PremiumCheckout from '../pages/PremiumCheckout';

interface AuthContextType {
  isLoggedIn: boolean;
  user: User | null;
  profile: any | null;
  hasProfile: boolean;
  isCheckingProfile: boolean;
  userRole: string | null;
  membershipTier: 'free' | 'premium';
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

const normalizeMembershipTier = (value: unknown): 'free' | 'premium' => {
  return value === 'premium' ? 'premium' : 'free';
};

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
    return;
  }

  window.history.replaceState(null, '', verifiedLoginPath);
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [hasProfile, setHasProfile] = useState(false);
  const [isCheckingProfile, setIsCheckingProfile] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [membershipTier, setMembershipTier] = useState<'free' | 'premium'>('free');
  const [loading, setLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [isPremiumModalOpen, setIsPremiumModalOpen] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const checkProfile = async (userId: string) => {
    setIsCheckingProfile(true);
    try {
      // 1. Lấy thông tin cơ bản từ profiles
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      // 2. Kiểm tra xem đã hoàn thành survey chưa (lifestyle_settings tồn tại)
      const { data: lifestyleData } = await supabase
        .from('lifestyle_settings')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle();

      setProfile(profileData || null);
      // hasProfile chỉ là true khi ĐÃ CÓ profile và ĐÃ HOÀN THÀNH survey
      setHasProfile(!!profileData && !!lifestyleData);
      setUserRole(profileData?.role || 'user');
      setMembershipTier(normalizeMembershipTier(profileData?.membership_tier));
    } catch (error) {
      console.error('Error checking profile/survey status:', error);
      setProfile(null);
      setHasProfile(false);
      setMembershipTier('free');
    } finally {
      setIsCheckingProfile(false);
    }
  };

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

      if (searchParams.get('verified') === '1' || authType === 'signup') {
        normalizeVerifiedEmailRedirect();
        await supabase.auth.signOut();
        return 'signed-out';
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
        setProfile(null);
        setHasProfile(false);
        setUserRole(null);
        setMembershipTier('free');
        setIsCheckingProfile(false);
        setIsPremiumModalOpen(false);
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
      setUser(null);
      setProfile(null);
      setHasProfile(false);
      setUserRole(null);
      setMembershipTier('free');
      setIsPremiumModalOpen(false);
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
  const openPremiumModal = () => setIsPremiumModalOpen(true);
  const closePremiumModal = () => setIsPremiumModalOpen(false);
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
      isPremium: membershipTier === 'premium',
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
      <PremiumCheckout isOpen={isPremiumModalOpen} onClose={closePremiumModal} />
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
