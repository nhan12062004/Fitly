import {
  Bell,
  CalendarCheck,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Droplet,
  Dumbbell,
  Flame,
  GlassWater,
  Home,
  Loader2,
  Lock,
  LogOut,
  Menu,
  Moon,
  Send,
  Shield,
  Sparkles,
  Sun,
  Trash2,
  TrendingUp,
  User,
  Users,
  Utensils,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ElementType } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE_URL } from '../lib/Api';
import {
  archiveNotification,
  ensureActionableNotifications,
  fetchUserNotifications,
  markAllUserNotificationsRead,
  markNotificationRead,
  recordWaterFromNotification,
  type NotificationTone,
  type UserNotification,
} from '../lib/Notifications';
import { supabase } from '../lib/Supabase';

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';

type TopBarProps = {
  onProfileClick?: () => void;
  onPasswordClick?: () => void;
};

type NavMenuItem = {
  icon: ElementType;
  label: string;
  path: string;
  iconClass: string;
  adminOnly?: boolean;
};

const NAV_ITEMS: NavMenuItem[] = [
  { icon: Home, label: 'Hôm nay', path: '/overview', iconClass: 'text-text-tertiary group-hover:text-text-primary' },
  { icon: Sparkles, label: 'AI Coach', path: '/smart-planner', iconClass: 'text-ai' },
  { icon: Dumbbell, label: 'Bài tập', path: '/exercises', iconClass: 'text-accent' },
  { icon: Utensils, label: 'Thực đơn', path: '/diet-plan', iconClass: 'text-info' },
  { icon: TrendingUp, label: 'Tiến độ', path: '/progress', iconClass: 'text-warning' },
  { icon: Users, label: 'Thử thách', path: '/challenges', iconClass: 'text-ai' },
  { icon: Shield, label: 'Quản trị', path: '/admin-panel', iconClass: 'text-danger', adminOnly: true },
];

const NOTIFICATION_TONE_MAP: Record<NotificationTone, { Icon: ElementType; bg: string; color: string }> = {
  workout: { Icon: CalendarCheck, bg: 'bg-accent/10', color: 'text-accent' },
  nutrition: { Icon: Droplet, bg: 'bg-info/10', color: 'text-info' },
  coach: { Icon: Sparkles, bg: 'bg-ai/10', color: 'text-ai' },
  progress: { Icon: Flame, bg: 'bg-warning/10', color: 'text-warning' },
  system: { Icon: CheckCircle2, bg: 'bg-bg-tertiary', color: 'text-text-secondary' },
};

const getDatePartsInTimeZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value || '1970';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';
  return { year, month, day };
};

const getVietnamDateKey = (date = new Date()): string => {
  const { year, month, day } = getDatePartsInTimeZone(date, VIETNAM_TIMEZONE);
  return `${year}-${month}-${day}`;
};

const formatNotificationTime = (isoDate: string): string => {
  const then = new Date(isoDate).getTime();
  const diffMs = Date.now() - then;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (!Number.isFinite(then)) return 'Vừa xong';
  if (diffMs < minute) return 'Vừa xong';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} phút trước`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} giờ trước`;
  if (diffMs < day * 2) return 'Hôm qua';
  return `${Math.floor(diffMs / day)} ngày trước`;
};

const isWaterNotification = (item: UserNotification): boolean => {
  return item.tone === 'nutrition' && item.dedupe_key.startsWith('water:');
};

export default function TopBar({ onProfileClick, onPasswordClick }: TopBarProps) {
  const [isLightMode, setIsLightMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('theme') === 'light';
  });
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [recordingWaterId, setRecordingWaterId] = useState<string | null>(null);
  const [waterIntake, setWaterIntake] = useState(0);
  const [waterGoal, setWaterGoal] = useState(2.5);
  const [isPollingTelegram, setIsPollingTelegram] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);

  const {
    signOut,
    user,
    isAdmin,
    membershipTier,
    profile,
    refreshProfile,
    refreshTick,
  } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const isNotificationsPage = location.pathname === '/notifications';
  const primaryMenuItems = NAV_ITEMS.filter((item) => !item.adminOnly);
  const mobileMenuItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);
  const adminMenuItem = NAV_ITEMS.find((item) => item.adminOnly);
  const mobileNavRegionRef = useRef<HTMLDivElement>(null);
  const notificationRegionRef = useRef<HTMLDivElement>(null);
  const avatarMenuRegionRef = useRef<HTMLDivElement>(null);
  const unreadCount = notifications.filter((item) => !item.read_at).length;

  const rawName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Thành viên';
  const nameParts = rawName.trim().split(/\s+/);
  const userName = nameParts.length > 1 ? `${nameParts[nameParts.length - 1]} ${nameParts[0]}` : rawName;
  const userInitial = nameParts[nameParts.length - 1]?.charAt(0).toUpperCase() || rawName.charAt(0).toUpperCase() || '?';
  const membershipLabel = `${membershipTier.toUpperCase()} MEMBER`;
  const membershipClassName = membershipTier === 'pro' ? 'text-amber-300' : membershipTier === 'plus' ? 'text-ai' : 'text-accent';

  const notify = useCallback((message: unknown) => {
    const text = String(message || '');
    if (/lỗi|loi|không tìm|khong tim|không thể|khong the|hết hạn|het han|chưa được|chua duoc/i.test(text)) {
      toast.error(text);
      return;
    }
    toast.success(text);
  }, [toast]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('theme-changing');
    if (isLightMode) {
      root.classList.add('light');
      localStorage.setItem('theme', 'light');
    } else {
      root.classList.remove('light');
      localStorage.setItem('theme', 'dark');
    }

    const raf = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => root.classList.remove('theme-changing'));
    });
    return () => window.cancelAnimationFrame(raf);
  }, [isLightMode]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (mobileNavRegionRef.current && !mobileNavRegionRef.current.contains(target)) {
        setIsMobileNavOpen(false);
      }
      if (notificationRegionRef.current && !notificationRegionRef.current.contains(target)) {
        setIsNotificationsOpen(false);
      }
      if (avatarMenuRegionRef.current && !avatarMenuRegionRef.current.contains(target)) {
        setIsAvatarMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileNavOpen(false);
        setIsNotificationsOpen(false);
        setIsAvatarMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const fetchWater = useCallback(async () => {
    if (!user?.id) {
      setWaterIntake(0);
      setWaterGoal(2.5);
      return;
    }

    const today = getVietnamDateKey();
    const [{ data: log }, { data: lifestyle }] = await Promise.all([
      supabase
        .from('daily_progress_logs')
        .select('water_intake_ml')
        .eq('user_id', user.id)
        .eq('log_date', today)
        .maybeSingle(),
      supabase
        .from('lifestyle_settings')
        .select('daily_water_goal')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

    setWaterIntake((log?.water_intake_ml || 0) / 1000);
    setWaterGoal(lifestyle?.daily_water_goal || 2.5);
  }, [user?.id]);

  useEffect(() => {
    void fetchWater();
  }, [fetchWater, refreshTick]);

  useEffect(() => {
    if (!isPollingTelegram || !user?.id) return;

    let attempts = 0;
    const maxAttempts = 40;
    const interval = window.setInterval(async () => {
      attempts += 1;
      const { data: updatedProfile } = await supabase
        .from('profiles')
        .select('telegram_chat_id')
        .eq('id', user.id)
        .maybeSingle();

      if (updatedProfile?.telegram_chat_id) {
        window.clearInterval(interval);
        setIsPollingTelegram(false);
        await refreshProfile();
      }

      if (attempts >= maxAttempts) {
        window.clearInterval(interval);
        setIsPollingTelegram(false);
      }
    }, 3000);

    return () => window.clearInterval(interval);
  }, [isPollingTelegram, refreshProfile, user?.id]);

  const loadNotifications = useCallback(async (syncActionable = false) => {
    if (!user?.id) {
      setNotifications([]);
      return;
    }

    setIsLoadingNotifications(true);
    try {
      if (syncActionable) {
        await ensureActionableNotifications(user.id);
      }
      const items = await fetchUserNotifications(user.id);
      setNotifications(items);
    } catch (error) {
      console.error('Notification load error:', error);
    } finally {
      setIsLoadingNotifications(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadNotifications(true);
  }, [loadNotifications, refreshTick]);

  useEffect(() => {
    if (!user?.id) return;
    const intervalId = window.setInterval(() => {
      void loadNotifications(true);
    }, 60000);
    return () => window.clearInterval(intervalId);
  }, [loadNotifications, user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`topbar_notifications_${user.id}_${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${user.id}` }, () => {
        void loadNotifications(false);
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadNotifications, user?.id]);

  const toggleMobileNav = () => {
    setIsMobileNavOpen((value) => !value);
    setIsNotificationsOpen(false);
    setIsAvatarMenuOpen(false);
  };

  const toggleNotifications = () => {
    setIsNotificationsOpen((value) => !value);
    setIsMobileNavOpen(false);
    setIsAvatarMenuOpen(false);
    if (!isNotificationsOpen) void loadNotifications(true);
  };

  const toggleAvatarMenu = () => {
    setIsAvatarMenuOpen((value) => !value);
    setIsMobileNavOpen(false);
    setIsNotificationsOpen(false);
  };

  const markAllNotificationsRead = async () => {
    if (!user?.id || unreadCount === 0) return;
    const readAt = new Date().toISOString();
    setNotifications((items) => items.map((item) => ({ ...item, read_at: item.read_at || readAt })));
    try {
      await markAllUserNotificationsRead(user.id);
      await loadNotifications(false);
    } catch (error) {
      console.error('Notification mark all read error:', error);
      await loadNotifications(false);
    }
  };

  const openNotification = async (item: UserNotification) => {
    if (user?.id && !item.read_at) {
      const readAt = new Date().toISOString();
      setNotifications((items) => items.map((notification) => (
        notification.id === item.id ? { ...notification, read_at: readAt } : notification
      )));
      try {
        await markNotificationRead(user.id, item.id);
      } catch (error) {
        console.error('Notification mark read error:', error);
      }
    }
    setIsNotificationsOpen(false);
    navigate(item.href);
  };

  const recordWater = async (item: UserNotification) => {
    if (!user?.id || recordingWaterId) return;
    setRecordingWaterId(item.id);
    setNotifications((items) => items.filter((notification) => notification.id !== item.id));
    try {
      await recordWaterFromNotification(user.id);
      await archiveNotification(user.id, item.id);
      await fetchWater();
    } catch (error) {
      console.error('Notification water record error:', error);
      await loadNotifications(false);
    } finally {
      setRecordingWaterId(null);
    }
  };

  const updateWaterIntake = async (amount: number) => {
    if (!user?.id) return;
    const today = getVietnamDateKey();
    const { error } = await supabase
      .from('daily_progress_logs')
      .upsert({
        user_id: user.id,
        log_date: today,
        water_intake_ml: Math.round(amount * 1000),
      }, { onConflict: 'user_id,log_date' });

    if (!error) {
      setWaterIntake(amount);
      window.dispatchEvent(new CustomEvent('fitly:water-updated', {
        detail: { waterIntake: amount },
      }));
    }
  };

  const handleUnlinkTelegram = async () => {
    if (!confirm('Bạn có chắc chắn muốn hủy liên kết với Telegram Bot không?')) return;

    setIsUnlinking(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ telegram_chat_id: null })
        .eq('id', user?.id);

      if (error) throw error;
      await refreshProfile();
      notify('Đã hủy liên kết Telegram thành công');
    } catch (err: any) {
      notify(`Lỗi: ${err.message}`);
    } finally {
      setIsUnlinking(false);
      setIsAvatarMenuOpen(false);
    }
  };

  const handleConnectTelegram = async () => {
    if (!user?.id) {
      notify('Lỗi: Không tìm thấy ID người dùng. Vui lòng đăng nhập lại.');
      return;
    }

    try {
      const { data: profileExists, error: checkError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle();

      if (checkError) {
        console.error('Profile check error:', checkError);
        notify('Lỗi kết nối. Vui lòng thử lại.');
        return;
      }

      if (!profileExists) {
        notify('Hồ sơ chưa được tạo. Vui lòng hoàn thành khảo sát lần đầu trước khi kết nối Telegram.');
        return;
      }

      const sessionRes = await supabase.auth.getSession();
      const accessToken = sessionRes.data.session?.access_token;
      if (!accessToken) {
        notify('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        return;
      }

      const linkRes = await fetch(`${API_BASE_URL}/api/telegram/link-token`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const payload = await linkRes.json().catch(() => ({}));
      if (!linkRes.ok || !payload?.telegramLink) {
        throw new Error(payload?.error || 'Không thể tạo liên kết Telegram an toàn.');
      }

      setIsAvatarMenuOpen(false);
      window.open(String(payload.telegramLink), '_blank');
      setIsPollingTelegram(true);
    } catch (err: any) {
      notify(`Lỗi: ${err.message || 'Không thể kết nối Telegram.'}`);
    }
  };

  const navLinkClassName = ({ isActive }: { isActive: boolean }) =>
    `topbar-nav-item group inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-3 text-sm transition-all ${
      isActive
        ? 'topbar-nav-item-active text-text-primary font-semibold'
        : 'text-text-secondary hover:text-text-primary'
    }`;

  const mobileNavLinkClassName = ({ isActive }: { isActive: boolean }) =>
    `group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-all ${
      isActive
        ? 'topbar-nav-item-active text-text-primary font-semibold'
        : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
    }`;

  const floatingPanelStyle = { top: 'calc(var(--layout-topbar-height, 5rem) + 0.75rem)' };

  const notificationDropdown = (
    <div className="topbar-menu-panel topbar-notification-dropdown overflow-hidden rounded-2xl border border-border-primary bg-bg-secondary shadow-2xl shadow-black/40 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3 border-b border-border-primary px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary">Thông báo</p>
          <p className="text-xs text-text-tertiary">
            {unreadCount > 0 ? `${unreadCount} thông báo chưa đọc` : 'Bạn đã xem hết thông báo mới'}
          </p>
        </div>
        <button
          type="button"
          onClick={markAllNotificationsRead}
          disabled={unreadCount === 0}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-primary bg-bg-secondary text-text-secondary transition-colors hover:text-accent disabled:cursor-default disabled:opacity-45"
          aria-label="Đánh dấu tất cả đã đọc"
          title="Đánh dấu tất cả đã đọc"
        >
          <CheckCheck className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-[22rem] overflow-y-auto py-2 custom-scrollbar">
        {isLoadingNotifications && notifications.length === 0 ? (
          <div className="py-8 text-center">
            <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-text-tertiary" />
            <p className="text-sm text-text-tertiary">Đang tải thông báo...</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="py-8 text-center">
            <Bell className="mx-auto mb-2 h-7 w-7 text-text-tertiary" />
            <p className="text-sm font-semibold text-text-primary">Chưa có thông báo</p>
            <p className="mt-1 px-8 text-xs text-text-tertiary">Khi có lịch tập, nước uống hoặc cập nhật AI, chúng sẽ xuất hiện ở đây.</p>
          </div>
        ) : notifications.map((item) => {
          const { Icon, bg, color } = NOTIFICATION_TONE_MAP[item.tone];
          const isRead = Boolean(item.read_at);

          return (
            <div
              key={item.id}
              className={`group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-tertiary ${isRead ? 'opacity-75' : 'bg-bg-tertiary/45'}`}
            >
              <button
                type="button"
                onClick={() => openNotification(item)}
                className="flex min-w-0 flex-1 items-start gap-3 text-left"
              >
                <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${bg}`}>
                  <Icon className={`h-4 w-4 ${color}`} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-3">
                    <span className="line-clamp-1 text-sm font-semibold text-text-primary group-hover:text-accent">{item.title}</span>
                    {!isRead && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                  </span>
                  <span className="mt-1 line-clamp-2 text-xs leading-5 text-text-secondary">{item.message}</span>
                  <span className="mt-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">{formatNotificationTime(item.updated_at || item.created_at)}</span>
                </span>
              </button>

              {isWaterNotification(item) && !isRead && (
                <button
                  type="button"
                  onClick={() => recordWater(item)}
                  disabled={recordingWaterId === item.id}
                  className="mt-0.5 inline-flex h-8 shrink-0 items-center justify-center rounded-full bg-info/10 px-3 text-[11px] font-semibold text-info transition-colors hover:bg-info/15 disabled:cursor-default disabled:opacity-60"
                >
                  {recordingWaterId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Đã uống'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-border-primary px-4 py-3">
        <button
          type="button"
          onClick={() => {
            if (isNotificationsPage) {
              void loadNotifications(true);
            } else {
              setIsNotificationsOpen(false);
              navigate('/notifications');
            }
          }}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-border-primary bg-bg-secondary px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-accent/30 hover:text-accent"
        >
          {isNotificationsPage ? 'Cập nhật thông báo' : 'Xem tất cả thông báo'}
          {isNotificationsPage && isLoadingNotifications ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );

  const avatarDropdown = (
    <div className="topbar-menu-panel topbar-avatar-menu overflow-hidden rounded-2xl border border-border-primary shadow-2xl shadow-black/40">
      <div className="border-b border-border-primary p-3">
        <div className="topbar-water-card rounded-xl bg-bg-tertiary p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Droplet className="h-4 w-4 text-info" />
              <span className="text-sm font-medium text-text-secondary">Nước uống</span>
            </div>
            <span className="text-xs font-semibold text-text-tertiary">{waterIntake.toFixed(1)} / {waterGoal.toFixed(1)}L</span>
          </div>
          <div className="flex items-center gap-2">
            {Array.from({ length: 5 }).map((_, index) => {
              const cupIndex = index + 1;
              const cupSize = waterGoal / 5;
              const isFilled = waterIntake >= cupIndex * cupSize;
              const isPartial = !isFilled && waterIntake > index * cupSize;

              return (
                <button
                  key={cupIndex}
                  type="button"
                  onClick={() => void updateWaterIntake(cupIndex * cupSize)}
                  className="flex flex-1 justify-center rounded-lg py-1 transition-transform hover:scale-110 active:scale-95"
                  title={`${(cupSize * 1000).toFixed(0)}ml`}
                >
                  <GlassWater
                    className={`h-7 w-7 transition-all ${
                      isFilled
                        ? 'text-info fill-info/30 drop-shadow-[0_0_6px_rgb(var(--info-rgb)_/_0.35)]'
                        : isPartial
                          ? 'text-info/50 fill-info/12'
                          : 'text-gray-600/30 fill-transparent'
                    }`}
                    strokeWidth={1.5}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="p-2">
        <button
          type="button"
          onClick={() => {
            setIsAvatarMenuOpen(false);
            onProfileClick?.();
          }}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
        >
          <User className="h-4 w-4" />
          Thông tin cá nhân
        </button>
        <button
          type="button"
          onClick={() => {
            setIsAvatarMenuOpen(false);
            onPasswordClick?.();
          }}
          className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
        >
          <Lock className="h-4 w-4" />
          Đổi mật khẩu
        </button>

        {profile?.telegram_chat_id ? (
          <div className="mt-1 flex items-center justify-between rounded-xl bg-accent/10 px-3 py-2.5 group/tg">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-4 w-4 text-accent" />
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase text-accent">Telegram</span>
                <span className="text-[9px] text-text-tertiary">Đã kết nối</span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleUnlinkTelegram}
              disabled={isUnlinking}
              className="rounded-lg p-1.5 text-text-tertiary opacity-100 transition-all hover:bg-danger/10 hover:text-danger sm:opacity-0 sm:group-hover/tg:opacity-100"
              title="Hủy liên kết"
            >
              {isUnlinking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={isPollingTelegram}
            onClick={() => void handleConnectTelegram()}
            className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-text-secondary transition-colors hover:bg-info/5 hover:text-info disabled:cursor-default disabled:opacity-70"
          >
            {isPollingTelegram ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-info" />
                <span className="font-medium text-info">Đang chờ kết nối...</span>
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Kết nối Telegram Bot
              </>
            )}
          </button>
        )}

        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-danger transition-colors hover:bg-danger/10"
        >
          <LogOut className="h-4 w-4" />
          Đăng xuất
        </button>
      </div>
    </div>
  );

  return (
    <header className="topbar-shell sticky top-0 z-30 flex h-[72px] shrink-0 items-center justify-between gap-3 bg-bg-secondary px-4 md:h-20 md:gap-4 md:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <NavLink to="/overview" className="topbar-brand flex min-w-0 shrink-0 items-center gap-2 rounded-full pr-2 text-text-primary">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center">
            <img src="/logo.png" alt="Fitly" className="h-full w-full object-contain" />
          </span>
          <span className="hidden min-w-0 flex-col leading-tight sm:flex">
            <span className="truncate text-lg font-bold">Fitly</span>
            <span className="truncate text-[10px] font-semibold uppercase tracking-widest text-accent">Trợ lý cá nhân</span>
          </span>
        </NavLink>

        <nav className="topbar-nav hidden min-w-0 max-w-full items-center gap-1 overflow-x-auto custom-scrollbar xl:flex" aria-label="Điều hướng chính">
          {primaryMenuItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.path} to={item.path} className={navLinkClassName}>
                <Icon className={`h-4 w-4 shrink-0 ${item.iconClass}`} />
                <span className="whitespace-nowrap">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div ref={mobileNavRegionRef} className="relative xl:hidden">
          <button
            type="button"
            className={`topbar-menu-button inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border-primary text-text-secondary transition-colors hover:text-text-primary ${isMobileNavOpen ? 'text-accent' : ''}`}
            onClick={toggleMobileNav}
            aria-label="Mở menu điều hướng"
            aria-expanded={isMobileNavOpen}
          >
            {isMobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          {isMobileNavOpen && (
            <div
              className="fixed left-3 right-3 z-50 sm:left-[var(--layout-gutter)] sm:right-auto sm:w-[23rem]"
              style={floatingPanelStyle}
            >
              <div className="topbar-menu-panel topbar-nav-dropdown rounded-2xl border border-border-primary bg-bg-secondary p-2 shadow-2xl shadow-black/40 backdrop-blur-xl">
                {mobileMenuItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={() => setIsMobileNavOpen(false)}
                      className={mobileNavLinkClassName}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <Icon className={`h-4 w-4 shrink-0 ${item.iconClass}`} />
                        <span className="truncate">{item.label}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-text-tertiary" />
                    </NavLink>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {isAdmin && adminMenuItem && (
          <button
            type="button"
            onClick={() => navigate(adminMenuItem.path)}
            className={`topbar-action topbar-action-icon-only hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border-primary bg-bg-secondary text-text-secondary transition-colors hover:[&_svg]:text-accent sm:flex ${location.pathname === adminMenuItem.path ? '[&_svg]:text-accent text-accent' : ''}`}
            aria-label="Quản trị"
            title="Quản trị"
          >
            <Shield className="h-5 w-5 transition-colors" />
          </button>
        )}

        <button
          type="button"
          onClick={() => setIsLightMode(!isLightMode)}
          className="topbar-action topbar-action-icon-only flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border-primary bg-bg-secondary text-text-secondary transition-colors hover:[&_svg]:text-accent"
          aria-label={isLightMode ? 'Chuyển sang giao diện tối' : 'Chuyển sang giao diện sáng'}
          title={isLightMode ? 'Giao diện tối' : 'Giao diện sáng'}
        >
          {isLightMode ? <Sun className="h-5 w-5 transition-colors" /> : <Moon className="h-5 w-5 transition-colors" />}
        </button>

        <div ref={notificationRegionRef} className="relative">
          <button
            type="button"
            onClick={toggleNotifications}
            className={`topbar-action topbar-action-icon-only relative flex h-10 w-10 items-center justify-center rounded-full border border-border-primary bg-bg-secondary text-text-secondary transition-colors hover:[&_svg]:text-accent ${isNotificationsOpen ? '[&_svg]:text-accent' : ''}`}
            aria-label={`Thông báo${unreadCount > 0 ? `, ${unreadCount} chưa đọc` : ''}`}
            aria-expanded={isNotificationsOpen}
            title="Thông báo"
          >
            <Bell className="h-5 w-5 transition-colors" />
            {unreadCount > 0 && (
              <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-accent shadow-[0_0_0_2px_var(--bg-secondary)]" />
            )}
          </button>

          {isNotificationsOpen && (
            <div
              className="fixed left-3 right-3 z-50 sm:left-auto sm:right-[var(--layout-gutter)] sm:w-[28rem]"
              style={floatingPanelStyle}
            >
              {notificationDropdown}
            </div>
          )}
        </div>

        <span className="hidden h-8 w-px shrink-0 bg-border-primary lg:block"></span>

        <div ref={avatarMenuRegionRef} className="relative">
          <button
            type="button"
            onClick={toggleAvatarMenu}
            className={`topbar-user flex cursor-pointer shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-bg-tertiary ${isAvatarMenuOpen ? 'bg-bg-tertiary' : ''}`}
            aria-label="Mở cài đặt tài khoản"
            aria-expanded={isAvatarMenuOpen}
          >
            <div className="topbar-user-meta hidden flex-col items-end lg:flex">
              <span className="text-sm font-semibold leading-tight text-text-primary">{userName}</span>
              <span className={`mt-0.5 text-[9px] font-black uppercase tracking-wider ${membershipClassName}`}>
                {membershipLabel}
              </span>
            </div>
            <div className="topbar-avatar flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-bold text-text-inverse transition-transform">
              {userInitial}
            </div>
          </button>

          {isAvatarMenuOpen && (
            <div
              className="fixed left-3 right-3 z-50 sm:left-auto sm:right-[var(--layout-gutter)] sm:w-[23rem]"
              style={floatingPanelStyle}
            >
              {avatarDropdown}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
