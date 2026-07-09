import { Home, Utensils, Timer, Settings, Dumbbell, Droplet, Flame, Shield, X, Blocks, Brain, LogOut, User, Send, CheckCircle2, Trash2, Loader2, GlassWater, Sparkles, TrendingUp, Lock, Crown, Users } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useState, useEffect } from 'react';
import type { ElementType } from 'react';
import { API_BASE_URL } from '../lib/Api';
import { supabase } from '../lib/Supabase';
import { useToast } from '../components/ToastProvider';

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';

type SidebarMenuItem = {
  icon: ElementType;
  label: string;
  path: string;
  iconClass: string;
  badge?: string;
  badgeColor?: string;
  adminOnly?: boolean;
};

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

export default function Sidebar({ onClose, onProfileClick, onPasswordClick }: { 
  onClose?: () => void, 
  onProfileClick?: () => void,
  onPasswordClick?: () => void 
}) {
  const { signOut, user, openPremiumModal, isAdmin, isPremium, profile, refreshProfile, refreshTick } = useAuth();
  const toast = useToast();
  const alert = (message: unknown) => {
    const text = String(message || '');
    if (/lỗi|loi|không tìm|khong tim|không thể|khong the|hết hạn|het han|chưa được|chua duoc/i.test(text)) {
      toast.error(text);
      return;
    }
    toast.success(text);
  };
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [waterIntake, setWaterIntake] = useState(0);
  const [waterGoal, setWaterGoal] = useState(2.5);
  const [isPollingTelegram, setIsPollingTelegram] = useState(false);

  const fetchWater = async () => {
    if (!user) return;
    const today = getVietnamDateKey();
    const { data: log } = await supabase
      .from('daily_progress_logs')
      .select('water_intake_ml')
      .eq('user_id', user.id)
      .eq('log_date', today)
      .maybeSingle();

    const { data: lifestyle } = await supabase
      .from('lifestyle_settings')
      .select('daily_water_goal')
      .eq('user_id', user.id)
      .maybeSingle();

    if (log) setWaterIntake((log.water_intake_ml || 0) / 1000);
    if (lifestyle) setWaterGoal(lifestyle.daily_water_goal || 2.5);
  };

  useEffect(() => {
    if (!user) {
      setWaterIntake(0);
      setWaterGoal(2.5);
      return;
    }

    fetchWater();
  }, [user, refreshTick]);

  useEffect(() => {
    if (!isPollingTelegram || !user) return;

    let attempts = 0;
    const maxAttempts = 40; // 40 * 3s = 120s (2 minutes)

    const interval = setInterval(async () => {
      attempts++;
      const { data: updatedProfile } = await supabase
        .from('profiles')
        .select('telegram_chat_id')
        .eq('id', user.id)
        .maybeSingle();

      if (updatedProfile?.telegram_chat_id) {
        clearInterval(interval);
        setIsPollingTelegram(false);
        await refreshProfile();
      }

      if (attempts >= maxAttempts) {
        clearInterval(interval);
        setIsPollingTelegram(false);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isPollingTelegram, user]);

  const menuItems: SidebarMenuItem[] = [
    { icon: Home, label: "Hôm nay", path: '/overview', iconClass: 'text-text-tertiary group-hover:text-text-primary' },
    { icon: Sparkles, label: "AI Coach", path: '/smart-planner', iconClass: 'text-ai' },
    { icon: Dumbbell, label: "Bài tập", path: '/exercises', iconClass: 'text-accent' },
    { icon: Utensils, label: "Thực đơn", path: '/diet-plan', iconClass: 'text-info' },
    { icon: TrendingUp, label: "Tiến độ", path: '/progress', iconClass: 'text-warning' },
    { icon: Users, label: "Thử thách", path: '/challenges', iconClass: 'text-ai' },
    { icon: Shield, label: "Quản trị viên", path: '/admin-panel', iconClass: 'text-danger', adminOnly: true },
  ];

  const handleUnlinkTelegram = async () => {
    if (!confirm("Bạn có chắc chắn muốn hủy liên kết với Telegram Bot không?")) return;
    
    setIsUnlinking(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ telegram_chat_id: null })
        .eq('id', user?.id);

      if (error) throw error;
      await refreshProfile();
      alert("Đã hủy liên kết Telegram thành công");
    } catch (err: any) {
      alert("Lỗi: " + err.message);
    } finally {
      setIsUnlinking(false);
      setIsSettingsOpen(false);
    }
  };

  const filteredMenuItems = menuItems.filter(item => !item.adminOnly || isAdmin);

  const rawName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || "Thành viên";
  const nameParts = rawName.trim().split(/\s+/);
  const userName = nameParts.length > 1 
    ? `${nameParts[nameParts.length - 1]} ${nameParts[0]}` 
    : rawName;
  const userInitial = nameParts[nameParts.length - 1]?.charAt(0).toUpperCase() || rawName.charAt(0).toUpperCase() || '?';

  return (
    <aside className="sidebar-shell w-[min(20rem,86vw)] sm:w-80 lg:w-64 shrink-0 bg-bg-secondary border-r border-border-primary flex flex-col h-full relative">
      <div className="sidebar-brand h-[72px] md:h-20 px-4 sm:px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="sidebar-logo flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11">
            <img src="/logo.png" alt="Logo Fitly - Trợ lý cá nhân" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-text-primary leading-tight">Fitly</h1>
            <p className="text-[10px] text-accent font-semibold tracking-widest uppercase">{"Trợ lý cá nhân"}</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="lg:hidden rounded-full border border-border-primary bg-bg-secondary/70 p-2 text-text-secondary transition-colors hover:text-text-primary">
            <X className="w-6 h-6" />
          </button>
        )}
      </div>

      <nav className="sidebar-nav flex flex-1 flex-col overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 custom-scrollbar">
        <div className="space-y-1">
          {filteredMenuItems.map((item, index) => (
            <NavLink
              key={index}
              to={item.path}
              onClick={onClose}
              className={({ isActive }) =>
                `sidebar-nav-item flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-300 ${
                  isActive
                    ? 'sidebar-nav-item-active bg-white/[0.055] text-text-primary font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                }`
              }
            >
              <div className="flex items-center gap-3">
                <item.icon className={`w-5 h-5 ${item.iconClass}`} />
                <span className="text-sm">{item.label}</span>
              </div>
              {item.badge && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${item.badgeColor || 'bg-[#ff5e00] text-white'}`}>
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}
        </div>

        {!isPremium && (
          <div className="mt-auto pt-4 pb-2">
          <button
            onClick={openPremiumModal}
            className="sidebar-premium w-full overflow-hidden rounded-2xl border border-amber-300/30 bg-[linear-gradient(145deg,rgba(245,158,11,0.24),rgba(39,31,18,0.92)_48%,rgba(14,17,22,0.96))] p-3.5 sm:p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
          >
            <div className="sidebar-premium-body">
              <div className="flex items-center gap-2">
                <Crown className="sidebar-premium-icon h-5 w-5 shrink-0 text-amber-300 fill-amber-300/25" />
                <p className="sidebar-premium-title text-sm font-bold text-amber-100">
                  Nâng cấp Plus / Pro
                </p>
              </div>
              <p className="sidebar-premium-copy mt-2 text-xs leading-relaxed text-amber-100/65">
                Thêm lượt đổi AI hoặc mở khóa Pro không giới hạn.
              </p>
              <span className="sidebar-premium-cta mt-3 inline-flex rounded-md border border-amber-200/35 bg-amber-400/15 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-amber-50 transition-colors hover:border-amber-200 hover:bg-amber-400 hover:text-text-inverse">
                Đăng ký ngay
              </span>
            </div>
          </button>
          </div>
        )}
      </nav>

      <div className="sidebar-footer p-3 sm:p-4 border-t border-border-primary text-text-tertiary">
        <div 
          className="sidebar-water-card bg-bg-tertiary rounded-xl p-3.5 sm:p-4 mb-3 sm:mb-4 transition-colors group"
        >
          <div className="flex items-center mb-2">
            <div className="flex items-center gap-2">
              <Droplet className="w-4 h-4 text-info" />
              <span className="text-sm font-medium text-text-secondary">{"Lượng nước uống"}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 mb-2">
            {Array.from({ length: 5 }).map((_, idx) => {
              const i = idx + 1;
              const cupSize = waterGoal / 5;
              const isFilled = waterIntake >= i * cupSize;
              const isPartial = !isFilled && waterIntake > (i - 1) * cupSize;
              const fillPercent = isPartial ? ((waterIntake - (i - 1) * cupSize) / cupSize) * 100 : 0;
              
              return (
                <div 
                  key={i} 
                  onClick={async () => {
                    if (!user) return;
                    const newIntake = i * cupSize;
                    const today = getVietnamDateKey();
                    const { error } = await supabase
                      .from('daily_progress_logs')
                      .upsert({ 
                        user_id: user.id, 
                        log_date: today, 
                        water_intake_ml: Math.round(newIntake * 1000) 
                      }, { onConflict: 'user_id,log_date' });
                    
                    if (!error) {
                      setWaterIntake(newIntake);
                      window.dispatchEvent(new CustomEvent('fitly:water-updated', {
                        detail: { waterIntake: newIntake }
                      }));
                    }
                  }}
                  className="flex-1 cursor-pointer transition-all duration-300 hover:scale-110 active:scale-95"
                  title={`${(cupSize * 1000).toFixed(0)}ml`}
                >
                  <GlassWater 
                    className={`w-7 h-7 transition-all duration-300 ${
                      isFilled 
                        ? 'text-info fill-info/30 drop-shadow-[0_0_6px_rgb(var(--info-rgb)_/_0.35)]' 
                        : isPartial 
                          ? 'text-info/50 fill-info/12' 
                          : 'text-gray-600/30 fill-transparent'
                    }`}
                    strokeWidth={1.5}
                  />
                </div>
              );
            })}
          </div>

        </div>

        <div className="relative">
            {/* Settings Popover */}
            {isSettingsOpen && (
              <>
                <div 
                  className="fixed inset-0 z-10" 
                  onClick={() => setIsSettingsOpen(false)}
                />
                <div className="sidebar-settings-popover absolute bottom-full left-0 w-full mb-2 bg-bg-tertiary border border-border-primary rounded-2xl shadow-2xl p-2 z-20 animate-in slide-in-from-bottom-2 duration-200">
                  <button 
                    onClick={() => {
                      setIsSettingsOpen(false);
                      onClose?.();
                      onProfileClick?.();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-quaternary rounded-xl transition-colors"
                  >
                    <User className="w-4 h-4" />
                    {"Thông tin cá nhân"}
                  </button>
                  <button 
                    onClick={() => {
                      setIsSettingsOpen(false);
                      onClose?.();
                      onPasswordClick?.();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-quaternary rounded-xl transition-colors mt-1"
                  >
                    <Lock className="w-4 h-4" />
                    {"Đổi mật khẩu"}
                  </button>
                  {profile?.telegram_chat_id ? (
                    <div className="flex items-center justify-between px-3 py-2 mt-1 bg-accent/10 rounded-xl group/tg">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-4 h-4 text-accent" />
                        <div className="flex flex-col">
                          <span className="text-[10px] text-accent font-bold uppercase">Telegram</span>
                          <span className="text-[9px] text-text-tertiary">{"Đã kết nối"}</span>
                        </div>
                      </div>
                      <button 
                        onClick={handleUnlinkTelegram}
                        disabled={isUnlinking}
                        className="p-1.5 hover:bg-danger/10 text-text-tertiary hover:text-danger rounded-lg transition-all opacity-0 group-hover/tg:opacity-100"
                        title={"Hủy liên kết"}
                      >
                        {isUnlinking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  ) : (
                    <button 
                      disabled={isPollingTelegram}
                      onClick={async () => {
                        if (!user?.id) {
                          alert('❌ Lỗi: Không tìm thấy ID người dùng. Vui lòng đăng nhập lại.');
                          return;
                        }
                        
                        // Kiểm tra xem profile đã được tạo trong database chưa
                        const { data: profileExists, error: checkError } = await supabase
                          .from('profiles')
                          .select('id')
                          .eq('id', user.id)
                          .maybeSingle();
                        
                        if (checkError) {
                          alert('⚠️ Lỗi kết nối. Vui lòng thử lại.');
                          console.error('Profile check error:', checkError);
                          return;
                        }
                        
                        if (!profileExists) {
                          alert('❌ Hồ sơ chưa được tạo.\n\nVui lòng hoàn thành Khảo sát lần đầu để tạo hồ sơ (truy cập tab Khảo sát hoặc Tổng quan), sau đó mới có thể kết nối Telegram.');
                          return;
                        }
                        
                        const sessionRes = await supabase.auth.getSession();
                        const accessToken = sessionRes.data.session?.access_token;
                        if (!accessToken) {
                          alert('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
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

                        setIsSettingsOpen(false);
                        window.open(String(payload.telegramLink), '_blank');
                        setIsPollingTelegram(true); // Bắt đầu lắng nghe trạng thái kết nối
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-text-secondary hover:text-info hover:bg-info/5 rounded-xl transition-colors mt-1"
                    >
                      {isPollingTelegram ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-info" />
                          <span className="text-info font-medium">Đang chờ kết nối...</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          {"Kết nối Telegram Bot"}
                        </>
                      )}
                    </button>
                  )}
                  <button 
                    onClick={() => signOut()}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-danger hover:bg-danger/10 rounded-xl transition-colors mt-1"
                  >
                    <LogOut className="w-4 h-4" />
                    {"Đăng xuất"}
                  </button>
                </div>
              </>
            )}

            <button 
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className={`sidebar-settings-trigger w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 ${
                isSettingsOpen 
                  ? 'sidebar-settings-trigger-active bg-white/[0.055] text-text-primary font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
              }`}
            >
              <Settings className="w-5 h-5" />
              <span className="text-sm font-medium">{"Cài đặt"}</span>
            </button>
          </div>
      </div>
    </aside>
  );
}

