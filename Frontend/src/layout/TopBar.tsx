import { Search, Moon, Sun, Bell, Menu, Dumbbell, Utensils, Home, Timer, Blocks, Brain, ChevronRight, X, Loader2, Flame, Sparkles, TrendingUp, Shield } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/Supabase';

function normalizeViet(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';

const getDatePartsInTimeZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value || '1970';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  return { year, month, day };
};

const getVietnamDateKey = (date = new Date()): string => {
  const { year, month, day } = getDatePartsInTimeZone(date, VIETNAM_TIMEZONE);
  return `${year}-${month}-${day}`;
};

const addDaysToDateKey = (dateKey: string, days: number): string => {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return getVietnamDateKey(d);
};

const calculateWorkoutStreak = (completedDateKeys: string[], todayKey: string): number => {
  const completedSet = new Set(completedDateKeys);
  let streak = 0;
  let cursor = todayKey;

  if (!completedSet.has(cursor)) {
    cursor = addDaysToDateKey(cursor, -1);
  }

  while (completedSet.has(cursor)) {
    streak += 1;
    cursor = addDaysToDateKey(cursor, -1);
  }

  return streak;
};

interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  type: 'exercise' | 'diet' | 'page' | 'workout';
  href: string;
}

type PageIcon = 'home' | 'brain' | 'dumbbell' | 'utensils' | 'timer' | 'blocks' | 'sparkles' | 'trendingUp' | 'shield';

const BASE_QUICK_ACCESS_PAGES: (SearchResult & { pageIcon: PageIcon; badge?: string; badgeColor?: string })[] = [
  { id: 'overview', title: 'Tổng quan', subtitle: 'Trang chủ & thống kê', type: 'page', href: '/overview', pageIcon: 'home' },
  { id: 'smart-planner', title: 'Trợ lý cá nhân', subtitle: 'Lên kế hoạch tập và ăn uống', type: 'page', href: '/smart-planner', pageIcon: 'sparkles' },
  { id: 'exercises', title: 'Bài tập', subtitle: 'Lịch tập và thư viện', type: 'page', href: '/exercises', pageIcon: 'dumbbell' },
  { id: 'diet-plan', title: 'Thực đơn', subtitle: 'Bữa ăn và calories', type: 'page', href: '/diet-plan', pageIcon: 'utensils' },
  { id: 'progress', title: 'Tiến độ', subtitle: 'Theo dõi thay đổi', type: 'page', href: '/progress', pageIcon: 'trendingUp' },
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

export default function TopBar({ onMenuClick, onProfileClick }: { onMenuClick?: () => void, onProfileClick?: () => void }) {
  const [isLightMode, setIsLightMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('theme') === 'light';
  });
  const { user, profile, isAdmin, membershipTier, isPremium, openPremiumModal } = useAuth();
  const navigate = useNavigate();
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
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRegionRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
    window.setTimeout(() => inputRef.current?.focus(), 20);
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


        <button className="topbar-action topbar-action-icon-only relative hidden sm:flex h-10 w-10 items-center justify-center rounded-full border border-border-primary bg-bg-secondary text-text-secondary transition-colors hover:[&_svg]:text-accent">
          <Bell className="w-5 h-5 transition-colors" />
          <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-accent rounded-full"></span>
        </button>

        <span className="hidden md:block h-8 w-px bg-border-primary"></span>

        <div className="topbar-user flex items-center gap-3">
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
