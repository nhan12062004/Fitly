import { Search, Moon, Sun, Bell, Menu, Dumbbell, Utensils, Home, Timer, Blocks, Brain, ChevronRight, X, Loader2, Flame, Sparkles, TrendingUp, Shield, CheckCircle2, CalendarCheck, Droplet, MessageSquare, CheckCheck } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/Supabase';
import {
  ensureActionableNotifications,
  fetchUserNotifications,
  markAllUserNotificationsRead,
  markNotificationRead,
  recordWaterFromNotification,
  type NotificationTone,
  type UserNotification,
} from '../lib/Notifications';

function normalizeViet(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  type: 'exercise' | 'diet' | 'page' | 'workout';
  href: string;
}

type PageIcon = 'home' | 'brain' | 'dumbbell' | 'utensils' | 'timer' | 'blocks' | 'sparkles' | 'trendingUp' | 'shield' | 'bell';

const BASE_QUICK_ACCESS_PAGES: (SearchResult & { pageIcon: PageIcon; badge?: string; badgeColor?: string })[] = [
  { id: 'overview', title: 'Tổng quan', subtitle: 'Trang chủ & thống kê', type: 'page', href: '/overview', pageIcon: 'home' },
  { id: 'smart-planner', title: 'Trợ lý cá nhân', subtitle: 'Lên kế hoạch tập và ăn uống', type: 'page', href: '/smart-planner', pageIcon: 'sparkles' },
  { id: 'exercises', title: 'Bài tập', subtitle: 'Lịch tập và thư viện', type: 'page', href: '/exercises', pageIcon: 'dumbbell' },
  { id: 'diet-plan', title: 'Thực đơn', subtitle: 'Bữa ăn và calories', type: 'page', href: '/diet-plan', pageIcon: 'utensils' },
  { id: 'progress', title: 'Tiến độ', subtitle: 'Theo dõi thay đổi', type: 'page', href: '/progress', pageIcon: 'trendingUp' },
  { id: 'notifications', title: 'Thông báo', subtitle: 'Lịch tập, dinh dưỡng và AI Coach', type: 'page', href: '/notifications', pageIcon: 'bell' },
];

const PAGE_ICON_MAP: Record<PageIcon, { Icon: React.ElementType; bg: string; color: string }> = {
  home:      { Icon: Home,     bg: 'bg-info/10', color: 'text-info' },
  brain:     { Icon: Brain,    bg: 'bg-warning/10', color: 'text-warning' },
  dumbbell:  { Icon: Dumbbell, bg: 'bg-accent/10', color: 'text-accent' },
  utensils:  { Icon: Utensils, bg: 'bg-info/10', color: 'text-info' },
  timer:     { Icon: Timer,    bg: 'bg-warning/10', color: 'text-warning' },
  blocks:    { Icon: Blocks,   bg: 'bg-ai/10', color: 'text-ai' },
  sparkles:  { Icon: Sparkles, bg: 'bg-ai/10', color: 'text-ai' },
  trendingUp: { Icon: TrendingUp, bg: 'bg-warning/10', color: 'text-warning' },
  shield:    { Icon: Shield,   bg: 'bg-danger/10', color: 'text-danger' },
  bell:      { Icon: Bell,     bg: 'bg-accent/10', color: 'text-accent' },
};

const NOTIFICATION_TONE_MAP: Record<NotificationTone, { Icon: React.ElementType; bg: string; color: string }> = {
  workout: { Icon: CalendarCheck, bg: 'bg-accent/10', color: 'text-accent' },
  nutrition: { Icon: Droplet, bg: 'bg-info/10', color: 'text-info' },
  coach: { Icon: MessageSquare, bg: 'bg-ai/10', color: 'text-ai' },
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

function ResultIcon({ type, pageIcon }: { type: string; pageIcon?: PageIcon }) {
  const base = 'w-8 h-8 rounded-xl flex items-center justify-center shrink-0';

  if (type === 'exercise') return <div className={`${base} bg-accent/10`}><Dumbbell className="w-4 h-4 text-accent" /></div>;
  if (type === 'diet')     return <div className={`${base} bg-info/10`}><Utensils className="w-4 h-4 text-info" /></div>;

  if (pageIcon && PAGE_ICON_MAP[pageIcon]) {
    const { Icon, bg, color } = PAGE_ICON_MAP[pageIcon];
    return <div className={`${base} ${bg}`}><Icon className={`w-4 h-4 ${color}`} /></div>;
  }
  return <div className={`${base} bg-bg-tertiary`}><Home className="w-4 h-4 text-text-secondary" /></div>;
}

export default function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const [isLightMode, setIsLightMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('theme') === 'light';
  });
  const { user, profile, isAdmin, membershipTier, isPremium, openPremiumModal, refreshTick } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isNotificationsPage = location.pathname === '/notifications';
  const quickAccessPages = isAdmin
    ? [
        ...BASE_QUICK_ACCESS_PAGES,
        { id: 'admin-panel', title: 'Quản trị viên', subtitle: 'Cấu hình và kiểm soát', type: 'page' as const, href: '/admin-panel', pageIcon: 'shield' as const }
      ]
    : BASE_QUICK_ACCESS_PAGES;

  const rawName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || "Thành viên";
  const nameParts = rawName.trim().split(/\s+/);
  const userName = nameParts.length > 1
    ? `${nameParts[nameParts.length - 1]} ${nameParts[0]}`
    : rawName;
  const userInitial = nameParts[nameParts.length - 1]?.charAt(0).toUpperCase() || rawName.charAt(0).toUpperCase() || '?';
  const membershipLabel = isPremium ? 'PREMIUM MEMBER' : 'FREE MEMBER';
  const membershipClassName = isPremium ? 'text-amber-300' : 'text-accent';


  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [recordingWaterId, setRecordingWaterId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRegionRef = useRef<HTMLDivElement>(null);
  const notificationRegionRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const unreadCount = notifications.filter((item) => !item.read_at).length;

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
    const handler = (e: MouseEvent) => {
      if (searchRegionRef.current && !searchRegionRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (notificationRegionRef.current && !notificationRegionRef.current.contains(e.target as Node)) {
        setIsNotificationsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsNotificationsOpen(false);
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

  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setIsSearching(true);
    setIsOpen(true);
    setActiveIndex(-1);

    try {
      const lower = normalizeViet(trimmed);

      // 1. Static pages (hỗ trợ tìm không dấu)
      const pageResults = quickAccessPages.filter(p =>
        normalizeViet(p.title).includes(lower) ||
        normalizeViet(p.subtitle).includes(lower)
      );

      // 2. Exercises from DB
      const { data: exercises } = await supabase
        .from('exercises')
        .select('id, name, target_muscle, body_part')
        .ilike('name', `%${trimmed}%`)
        .limit(6);

      const exerciseResults: SearchResult[] = (exercises || []).map((ex: any) => ({
        id: `ex-${ex.id}`,
        title: ex.name,
        subtitle: [ex.target_muscle, ex.body_part].filter(Boolean).join(' • '),
        type: 'exercise' as const,
        href: '/exercises',
      }));

      setResults([...pageResults, ...exerciseResults]);
    } catch (e) {
      console.error('Search error:', e);
    } finally {
      setIsSearching(false);
    }
  }, [quickAccessPages]);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(debounceRef.current);
    if (!val.trim()) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => doSearch(val), 280);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = results[activeIndex] ?? results[0];
      if (item) navigateToResult(item);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  const navigateToResult = (item: SearchResult) => {
    setIsOpen(false);
    setQuery('');
    setResults([]);
    navigate(item.href);
  };

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const openSearchPanel = () => {
    setIsOpen(true);
    setIsNotificationsOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 20);
  };

  const toggleNotifications = () => {
    setIsNotificationsOpen((value) => !value);
    setIsOpen(false);
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
    try {
      await recordWaterFromNotification(user.id);
      await loadNotifications(true);
    } catch (error) {
      console.error('Notification water record error:', error);
      await loadNotifications(false);
    } finally {
      setRecordingWaterId(null);
    }
  };

  const searchDropdown = (
    <div
      className="topbar-search-dropdown rounded-2xl border border-border-primary bg-bg-secondary shadow-2xl shadow-black/40 overflow-hidden"
      style={{ backdropFilter: 'blur(12px)' }}
    >
      {query.trim() ? (
        results.length > 0 ? (
          <div className="py-2 max-h-80 overflow-y-auto custom-scrollbar">

            {results.filter(r => r.type === 'page').length > 0 && (
              <>
                <p className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-text-tertiary">Trang</p>
                {results.filter(r => r.type === 'page').map((item) => {
                  const globalIdx = results.indexOf(item);
                  return (
                    <button
                      key={item.id}
                      onClick={() => navigateToResult(item)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-bg-tertiary transition-colors group ${activeIndex === globalIdx ? 'bg-bg-tertiary' : ''}`}
                    >
                      <ResultIcon type={item.type} pageIcon={(item as any).pageIcon} />
                      <div className="flex-1 text-left min-w-0">
                        <p className="text-sm font-semibold text-text-primary truncate group-hover:text-accent transition-colors">{item.title}</p>
                        <p className="text-xs text-text-tertiary truncate">{item.subtitle}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </button>
                  );
                })}
              </>
            )}

            {results.filter(r => r.type === 'exercise').length > 0 && (
              <>
                <p className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-text-tertiary border-t border-border-primary mt-1">Bài tập</p>
                {results.filter(r => r.type === 'exercise').map((item) => {
                  const globalIdx = results.indexOf(item);
                  return (
                    <button
                      key={item.id}
                      onClick={() => navigateToResult(item)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-bg-tertiary transition-colors group ${activeIndex === globalIdx ? 'bg-bg-tertiary' : ''}`}
                    >
                      <ResultIcon type={item.type} />
                      <div className="flex-1 text-left min-w-0">
                        <p className="text-sm font-semibold text-text-primary truncate group-hover:text-accent transition-colors">{item.title}</p>
                        <p className="text-xs text-text-tertiary truncate">{item.subtitle}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </button>
                  );
                })}
              </>
            )}
          </div>
        ) : !isSearching ? (
          <div className="py-8 text-center">
            <Search className="w-8 h-8 text-text-tertiary mx-auto mb-2" />
            <p className="text-sm text-text-tertiary">Không tìm thấy kết quả cho "<span className="text-text-secondary font-medium">{query}</span>"</p>
          </div>
        ) : null
      ) : (
        <div className="p-3">
          <div className="p-0">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-text-tertiary">Truy cập nhanh</p>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {quickAccessPages.slice(0, 2).map((item) => (
                <button
                  key={item.id}
                  onClick={() => navigateToResult(item)}
                  className="group rounded-2xl border border-border-primary bg-bg-secondary/80 p-4 text-left transition-all hover:border-accent/30 hover:bg-bg-tertiary"
                >
                  <div className="flex items-start justify-between gap-3">
                    <ResultIcon type={item.type} pageIcon={item.pageIcon} />
                    {item.badge && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-black ${item.badgeColor || 'bg-orange-500 text-white'}`}>{item.badge}</span>
                    )}
                  </div>
                  <p className="mt-4 text-sm font-semibold text-text-primary group-hover:text-accent transition-colors">{item.title}</p>
                  <p className="mt-1 text-xs leading-5 text-text-tertiary">{item.subtitle}</p>
                </button>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {quickAccessPages.slice(2).map((item) => (
                <button
                  key={item.id}
                  onClick={() => navigateToResult(item)}
                  className="group flex items-center gap-3 rounded-2xl border border-transparent bg-bg-secondary/45 px-3 py-3 text-left transition-all hover:border-border-primary hover:bg-bg-tertiary"
                >
                  <ResultIcon type={item.type} pageIcon={item.pageIcon} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-text-primary group-hover:text-accent transition-colors">{item.title}</p>
                    <p className="truncate text-xs text-text-tertiary">{item.subtitle}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const notificationDropdown = (
    <div className="topbar-notification-dropdown topbar-search-dropdown overflow-hidden rounded-2xl border border-border-primary bg-bg-secondary shadow-2xl shadow-black/40 backdrop-blur-xl">
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
            <p className="mt-1 text-xs text-text-tertiary">Khi có lịch tập, nước uống hoặc cập nhật AI, chúng sẽ xuất hiện ở đây.</p>
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

              {isWaterNotification(item) && (
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
    <header className="topbar-shell h-[72px] md:h-20 px-4 md:px-8 flex items-center justify-between border-b border-border-primary bg-bg-secondary sticky top-0 z-30 shrink-0">
      <div className="flex items-center gap-4 flex-1">
        <button className="topbar-menu-button lg:hidden text-text-secondary hover:text-text-primary transition-colors" onClick={onMenuClick}>
          <Menu className="w-6 h-6" />
        </button>

        <div ref={searchRegionRef} className="topbar-search-wrap relative flex-1">
          <button
            onClick={openSearchPanel}
            className="topbar-action sm:hidden flex h-10 w-10 items-center justify-center rounded-full border border-border-primary bg-bg-secondary text-text-secondary transition-colors hover:[&_svg]:text-accent"
          >
            <Search className="w-5 h-5 transition-colors" />
          </button>

          <div className="relative hidden sm:block w-full max-w-[30rem] md:max-w-[34rem]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-tertiary pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Tìm kiếm bài tập, thực đơn,..."
            value={query}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (query.trim() && results.length > 0) setIsOpen(true);
              else if (!query.trim()) setIsOpen(true);
            }}
            className="topbar-search-input w-full bg-bg-secondary border border-border-primary rounded-full py-3 pl-12 pr-10 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent transition-colors"
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary animate-spin" />
          )}
          {!isSearching && query && (
            <button
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          {isOpen && (
            <div className="absolute top-full mt-2 left-0 right-0 z-50">
              {searchDropdown}
            </div>
          )}
          </div>

          {isOpen && (
            <div className="absolute top-full left-0 right-0 mt-2 z-50 sm:hidden">
              <div className="rounded-[28px] border border-border-primary bg-bg-secondary/96 p-3 shadow-[0_24px_70px_rgba(0,0,0,0.38)] backdrop-blur-xl">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-tertiary pointer-events-none" />
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder="Tìm kiếm nhanh..."
                    value={query}
                    onChange={handleInput}
                    onKeyDown={handleKeyDown}
                    className="topbar-search-input w-full rounded-full border border-border-primary bg-bg-secondary py-3 pl-12 pr-10 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent transition-colors"
                  />
                  <button
                    onClick={() => {
                      if (query) clearSearch();
                      else setIsOpen(false);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary transition-colors"
                  >
                    {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                  </button>
                </div>
                <div className="mt-3">
                  {searchDropdown}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 md:gap-4">

        <button
          onClick={() => setIsLightMode(!isLightMode)}
          className="topbar-action topbar-action-icon-only hidden md:flex h-10 w-10 items-center justify-center rounded-full border border-border-primary bg-bg-secondary text-text-secondary transition-colors hover:[&_svg]:text-accent"
        >
          {isLightMode ? <Sun className="w-5 h-5 transition-colors" /> : <Moon className="w-5 h-5 transition-colors" />}
        </button>


        <div ref={notificationRegionRef} className="relative">
          <button
            type="button"
            onClick={toggleNotifications}
            className={`topbar-action topbar-action-icon-only relative flex h-10 w-10 items-center justify-center rounded-full border border-border-primary bg-bg-secondary text-text-secondary transition-colors hover:[&_svg]:text-accent ${isNotificationsOpen ? '[&_svg]:text-accent' : ''}`}
            aria-label={`Thông báo${unreadCount > 0 ? `, ${unreadCount} chưa đọc` : ''}`}
            aria-expanded={isNotificationsOpen}
          >
            <Bell className="w-5 h-5 transition-colors" />
            {unreadCount > 0 && (
              <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-accent shadow-[0_0_0_2px_var(--bg-secondary)]" />
            )}
          </button>

          {isNotificationsOpen && (
            <div className="fixed left-4 right-4 top-[76px] z-50 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-3 sm:w-[28rem] sm:translate-x-10 md:translate-x-14">
              {notificationDropdown}
            </div>
          )}
        </div>

        <span className="hidden md:block h-8 w-px bg-border-primary"></span>

        <div className="topbar-user flex items-center gap-3 rounded-full px-1.5 py-1">
          <div className="topbar-user-meta hidden md:flex flex-col items-end">
            <span className="text-sm font-semibold text-text-primary leading-tight">{userName}</span>
            {isPremium ? (
              <span className={`mt-0.5 text-[9px] font-black uppercase tracking-wider ${membershipClassName}`}>
                {membershipLabel}
              </span>
            ) : (
              <span className={`mt-0.5 text-[9px] font-black uppercase tracking-wider ${membershipClassName}`}>
                {membershipLabel}
              </span>
            )}
          </div>
          <div className="topbar-avatar w-9 h-9 rounded-full bg-accent flex items-center justify-center text-text-inverse font-bold text-sm transition-transform">
            {userInitial}
          </div>
        </div>
      </div>
    </header>
  );
}
