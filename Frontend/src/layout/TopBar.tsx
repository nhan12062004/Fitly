import {
  Bell,
  CalendarCheck,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Droplet,
  Dumbbell,
  Flame,
  Home,
  Loader2,
  Moon,
  Shield,
  Sparkles,
  Sun,
  TrendingUp,
  User,
  Users,
  Utensils,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ElementType } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
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

export default function TopBar() {
  const [isLightMode, setIsLightMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('theme') === 'light';
  });
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [recordingWaterId, setRecordingWaterId] = useState<string | null>(null);

  const {
    user,
    membershipTier,
    profile,
    refreshTick,
  } = useAuth();
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const isNotificationsPage = location.pathname === '/notifications';
  const primaryMenuItems = NAV_ITEMS.filter((item) => !item.adminOnly);
  const notificationRegionRef = useRef<HTMLDivElement>(null);
  const unreadCount = notifications.filter((item) => !item.read_at).length;

  const rawName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Thành viên';
  const nameParts = rawName.trim().split(/\s+/);
  const userName = nameParts.length > 1 ? `${nameParts[nameParts.length - 1]} ${nameParts[0]}` : rawName;
  const userInitial = nameParts[nameParts.length - 1]?.charAt(0).toUpperCase() || rawName.charAt(0).toUpperCase() || '?';
  const avatarUrl = typeof profile?.avatar_url === 'string' ? profile.avatar_url.trim() : '';
  const shouldShowAvatar = !!avatarUrl && !avatarLoadFailed;
  const membershipLabel = `${membershipTier.toUpperCase()} MEMBER`;
  const membershipClassName = membershipTier === 'pro' ? 'text-amber-300' : membershipTier === 'plus' ? 'text-ai' : 'text-accent';

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [avatarUrl]);

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
      if (notificationRegionRef.current && !notificationRegionRef.current.contains(target)) {
        setIsNotificationsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsNotificationsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

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

  const toggleNotifications = () => {
    setIsNotificationsOpen((value) => !value);
    if (!isNotificationsOpen) void loadNotifications(true);
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
    } catch (error) {
      console.error('Notification water record error:', error);
      await loadNotifications(false);
    } finally {
      setRecordingWaterId(null);
    }
  };

  const navLinkClassName = ({ isActive }: { isActive: boolean }) =>
    `topbar-nav-item group inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full px-3 text-sm transition-all ${
      isActive
        ? 'topbar-nav-item-active text-text-primary font-semibold'
        : 'text-text-secondary hover:text-text-primary'
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

        <nav className="topbar-nav flex min-w-0 max-w-full items-center gap-1 overflow-x-auto custom-scrollbar" aria-label="Điều hướng chính">
          {primaryMenuItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.path} to={item.path} className={navLinkClassName} title={item.label}>
                <Icon className={`h-4 w-4 shrink-0 ${item.iconClass}`} />
                <span className="topbar-nav-label whitespace-nowrap">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
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

        <button
          type="button"
          onClick={() => navigate('/profile')}
          className="topbar-user flex cursor-pointer shrink-0 items-center gap-2 px-1.5 py-1"
          aria-label="Mở hồ sơ"
          title="Hồ sơ"
        >
          <div className="topbar-user-meta hidden flex-col items-end lg:flex">
            <span className="text-sm font-semibold leading-tight text-text-primary">{userName}</span>
            <span className={`mt-0.5 text-[9px] font-black uppercase tracking-wider ${membershipClassName}`}>
              {membershipLabel}
            </span>
          </div>
          <div className="topbar-avatar flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-accent text-sm font-bold text-text-inverse transition-transform">
            {shouldShowAvatar ? (
              <img
                src={avatarUrl}
                alt={rawName}
                className="h-full w-full object-cover"
                onError={() => setAvatarLoadFailed(true)}
              />
            ) : (
              userInitial
            )}
          </div>
        </button>
      </div>
    </header>
  );
}
