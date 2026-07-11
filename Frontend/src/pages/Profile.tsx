import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  Copy,
  Dumbbell,
  Flame,
  HeartPulse,
  Loader2,
  Lock,
  LogOut,
  Mars,
  PencilLine,
  PowerOff,
  Ruler,
  Save,
  Scale,
  Send,
  Settings,
  Shield,
  Trash2,
  Trophy,
  TrendingUp,
  User,
  Users,
  Venus,
  Target,
  Wind,
  X,
  Zap,
  Apple,
} from 'lucide-react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { supabase } from '../lib/Supabase';
import { useAuth } from '../contexts/AuthContext';
import { SkeletonBlock } from '../components/PageSkeleton';
import { useToast } from '../components/ToastProvider';
import { getUserChallenges, type ChallengeSummary } from '../lib/Challenges';
import { API_BASE_URL } from '../lib/Api';

const emptyForm = {
  full_name: '',
  email: '',
  phone: '',
  gender: 'Nam',
  birthday: '',
  age: '',
  job: '',
  height: '',
  weight: '',
  target_weight: '',
  body_fat: '',
  health_condition: '',
  injuries: '',
  allergies: '',
  medications: 'Không sử dụng thuốc',
  fitness_goal: 'Giảm mỡ',
  diet_preference: 'Bình thường',
  budget_level: 'Trung bình',
};

const toInput = (value: unknown) => {
  if (value === null || value === undefined || value === 0) return '';
  return String(value);
};

const parseNumberOrNull = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const formatValue = (value: unknown, fallback = 'Chưa cập nhật') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const formatMetric = (value: unknown, suffix: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 'Chưa cập nhật';
  return `${parsed.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} ${suffix}`;
};

const formatDate = (value: string) => {
  if (!value) return 'Chưa cập nhật';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN');
};

const getAgeFromBirthday = (value: string) => {
  if (!value) return '';
  const birthDate = new Date(`${value}T00:00:00`);
  if (Number.isNaN(birthDate.getTime())) return '';

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const hasBirthdayPassed =
    today.getMonth() > birthDate.getMonth()
    || (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());
  if (!hasBirthdayPassed) age -= 1;

  return age > 0 && age < 130 ? String(age) : '';
};

const getBirthdayFromAge = (value: string) => {
  const age = Math.floor(Number(value));
  if (!Number.isFinite(age) || age <= 0 || age >= 130) return null;
  return `${new Date().getFullYear() - age}-01-01`;
};

const formatJoinMonth = (isoString: string) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric' });
};

const getBmiStatus = (bmi: number | null) => {
  if (!bmi) return 'Chưa đủ dữ liệu';
  if (bmi < 18.5) return 'Thiếu cân';
  if (bmi < 23) return 'Cân đối';
  if (bmi < 25) return 'Cần theo dõi';
  return 'Cao';
};

const membershipLabels = { free: 'Free', plus: 'Plus', pro: 'Pro' };

const AI_LIMIT = { free: 25, plus: 200, pro: 800 };
const AI_SWAP_LIMIT = { free: 5, plus: 30, pro: 100 };
const APP_URL = (import.meta.env.VITE_APP_URL || 'https://trend-fit.vercel.app').replace(/\/$/, '');
const FITNESS_GOAL_OPTIONS = ['Giảm mỡ', 'Tăng cơ', 'Sức mạnh', 'Sức bền', 'Dẻo dai', 'Phục hồi & Tái tạo'];
const FITNESS_GOAL_DESCRIPTIONS: Record<string, string> = {
  'Giảm mỡ': 'Đốt mỡ thừa, lấy lại vóc dáng tự tin.',
  'Tăng cơ': 'Cơ rắn chắc, thân hình thon gọn hơn mỗi tuần.',
  'Sức mạnh': 'Nâng nặng hơn mỗi tuần, cảm giác mạnh mẽ thật sự.',
  'Sức bền': 'Tim khỏe hơn, vận động lâu mà ít mệt.',
  'Dẻo dai': 'Khớp linh hoạt, giảm đau lưng và nguy cơ chấn thương.',
  'Phục hồi & Tái tạo': 'Lấy lại năng lượng, giảm căng thẳng và phục hồi tốt hơn.',
};
const FITNESS_GOAL_ICONS: Record<string, ReactNode> = {
  'Giảm mỡ': <Flame className="h-5 w-5" strokeWidth={2.4} />,
  'Tăng cơ': <Dumbbell className="h-5 w-5" strokeWidth={2.4} />,
  'Sức mạnh': <Zap className="h-5 w-5" strokeWidth={2.4} />,
  'Sức bền': <HeartPulse className="h-5 w-5" strokeWidth={2.4} />,
  'Dẻo dai': <Wind className="h-5 w-5" strokeWidth={2.4} />,
  'Phục hồi & Tái tạo': <Target className="h-5 w-5" strokeWidth={2.4} />,
};
const LEGACY_FITNESS_GOAL_MAP: Record<string, string> = {
  'Giảm cân': 'Giảm mỡ',
  'Tăng sức mạnh': 'Sức mạnh',
  'Cải thiện sức khỏe': 'Sức bền',
  'Giữ dáng': 'Dẻo dai',
};
const DIET_PREFERENCE_OPTIONS = ['Bình thường', 'Eat clean', 'Giàu protein', 'Ăn chay', 'Keto'];
const DIET_PREFERENCE_DESCRIPTIONS: Record<string, string> = {
  'Bình thường': 'Ăn đa dạng, dễ theo và phù hợp sinh hoạt hằng ngày.',
  'Eat clean': 'Ưu tiên thực phẩm tươi, ít chế biến và cân bằng dinh dưỡng.',
  'Giàu protein': 'Tăng đạm để hỗ trợ tăng cơ, no lâu và phục hồi tốt hơn.',
  'Ăn chay': 'Không dùng thịt cá, ưu tiên nguồn đạm thực vật phù hợp.',
  Keto: 'Giảm tinh bột, tăng chất béo tốt và kiểm soát năng lượng chặt hơn.',
};
const MEAL_BUDGET_OPTIONS = ['Tiết kiệm', 'Trung bình', 'Thoải mái'];
const MEAL_BUDGET_DESCRIPTIONS: Record<string, string> = {
  'Tiết kiệm': 'Ưu tiên nguyên liệu phổ biến, dễ mua và chi phí thấp.',
  'Trung bình': 'Cân bằng giữa chi phí, độ tiện lợi và chất lượng bữa ăn.',
  'Thoải mái': 'Linh hoạt hơn với nguyên liệu đa dạng và món ăn phong phú.',
};
const GENDER_OPTIONS = ['Nam', 'Nữ'];
const GENDER_ICONS: Record<string, ReactNode> = {
  Nam: <Mars className="h-6 w-6" strokeWidth={2.4} />,
  Nữ: <Venus className="h-6 w-6" strokeWidth={2.4} />,
};

const normalizeGender = (value: unknown) => (
  GENDER_OPTIONS.includes(String(value)) ? String(value) : 'Nam'
);

const normalizeFitnessGoal = (value: unknown) => {
  const goal = String(value || '').trim();
  const normalized = LEGACY_FITNESS_GOAL_MAP[goal] || goal;
  return FITNESS_GOAL_OPTIONS.includes(normalized) ? normalized : 'Giảm mỡ';
};

type ProfileOutletContext = {
  onPasswordClick?: () => void;
};

export default function Profile() {
  const { onPasswordClick } = useOutletContext<ProfileOutletContext>();
  const navigate = useNavigate();
  const location = useLocation();
  const isProfileEditPage = location.pathname === '/profile/edit';
  const { user, profile, membershipTier, isAdmin, openPremiumModal, refreshProfile, signOut } = useAuth();
  const toast = useToast();
  const [formData, setFormData] = useState(emptyForm);
  const [latestBodyCreatedAt, setLatestBodyCreatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(isProfileEditPage);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [fitnessGoal, setFitnessGoal] = useState('');
  const [streakCount, setStreakCount] = useState(0);
  const [totalActiveDays, setTotalActiveDays] = useState(0);
  const [totalExp, setTotalExp] = useState(0);
  const [dbLevel, setDbLevel] = useState(1);
  const [refCode, setRefCode] = useState('');
  const [referralCount, setReferralCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [completedChallenges, setCompletedChallenges] = useState<ChallengeSummary[]>([]);
  const [aiUsed, setAiUsed] = useState(0);
  const [aiSwapWorkout, setAiSwapWorkout] = useState(0);
  const [aiSwapMeal, setAiSwapMeal] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPollingTelegram, setIsPollingTelegram] = useState(false);
  const [isUnlinkingTelegram, setIsUnlinkingTelegram] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);

  // ── Load profile data ────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;
    const userEmail = user.email || '';
    const metadataFullName = user.user_metadata?.full_name || '';
    let cancelled = false;

    async function loadProfile() {
      setLoading(true);
      setError('');
      try {
        const [profileRes, bodyRes, healthRes, lifestyleRes, streakRes, aiRes] = await Promise.all([
          supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
          supabase
            .from('body_metrics')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase.from('health_conditions').select('*').eq('user_id', userId).maybeSingle(),
          supabase.from('lifestyle_settings').select('*').eq('user_id', userId).maybeSingle(),
          supabase
            .from('daily_progress_logs')
            .select('log_date', { count: 'exact', head: false })
            .eq('user_id', userId),
          supabase.from('ai_usage').select('*').eq('user_id', userId).maybeSingle(),
        ]);

        // Load challenges đã hoàn thành riêng — bỏ qua nếu lỗi
        try {
          const allChallenges = await getUserChallenges(userId);
          const done = allChallenges
            .filter((c) => c.status === 'completed')
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 4);
          if (!cancelled) setCompletedChallenges(done);
        } catch {
          // bỏ qua nếu chưa có dữ liệu challenge
        }

        const firstError = [profileRes.error, bodyRes.error, healthRes.error].find(Boolean);
        if (firstError) throw firstError;
        if (cancelled) return;

        const p = profileRes.data || {};
        const b = bodyRes.data || {};
        const h = healthRes.data || {};

        setFormData({
          full_name: p.full_name || metadataFullName || '',
          email: p.email || userEmail,
          phone: p.phone || '',
          gender: normalizeGender(p.gender),
          birthday: p.birthday || '',
          age: getAgeFromBirthday(p.birthday || ''),
          job: p.job || '',
          height: toInput(b.height),
          weight: toInput(b.weight),
          target_weight: toInput(b.target_weight),
          body_fat: toInput(b.body_fat || b.body_fat_percentage),
          health_condition: h.health_condition || '',
          injuries: h.injuries || '',
          allergies: h.medical_history || '',
          medications: h.medications || 'Không sử dụng thuốc',
          fitness_goal: normalizeFitnessGoal(lifestyleRes.data?.fitness_goal),
          diet_preference: lifestyleRes.data?.diet_preference || 'Bình thường',
          budget_level: lifestyleRes.data?.budget_level || 'Trung bình',
        });
        setLatestBodyCreatedAt(b.created_at || '');
        setAvatarUrl(p.avatar_url || null);
        setFitnessGoal(normalizeFitnessGoal(lifestyleRes.data?.fitness_goal));
        setTotalExp(p.exp ?? 0);
        setDbLevel(p.level ?? 1);
        setRefCode(p.ref_code || '');
        setReferralCount(p.referral_count ?? 0);


        const totalDays = streakRes.data?.length ?? 0;
        setTotalActiveDays(totalDays);

        if (streakRes.data && streakRes.data.length > 0) {
          const logDates = new Set(streakRes.data.map((r: any) => r.log_date as string));
          let streak = 0;
          const today = new Date();
          for (let i = 0; i < 365; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            if (logDates.has(key)) streak++;
            else if (i > 0) break;
          }
          setStreakCount(streak);
        }

        if (aiRes.data) {
          setAiUsed(aiRes.data.total_used ?? 0);
          setAiSwapWorkout(aiRes.data.swap_workout ?? 0);
          setAiSwapMeal(aiRes.data.swap_meal ?? 0);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Không thể tải thông tin cá nhân.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadProfile();
    return () => { cancelled = true; };
  }, [reloadKey, user?.id]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error, toast]);

  useEffect(() => {
    setIsEditing(isProfileEditPage);
  }, [isProfileEditPage]);

  useEffect(() => {
    if (!isSettingsOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(target)) {
        setIsSettingsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsSettingsOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSettingsOpen]);

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
        setReloadKey((value) => value + 1);
        toast.success('Đã kết nối Telegram thành công');
      }

      if (attempts >= maxAttempts) {
        window.clearInterval(interval);
        setIsPollingTelegram(false);
      }
    }, 3000);

    return () => window.clearInterval(interval);
  }, [isPollingTelegram, refreshProfile, toast, user?.id]);

  const notifyTelegramResult = (message: unknown) => {
    const text = String(message || '');
    if (/lỗi|loi|không tìm|khong tim|không thể|khong the|hết hạn|het han|chưa được|chua duoc/i.test(text)) {
      toast.error(text);
      return;
    }
    toast.success(text);
  };

  const handleUnlinkTelegram = async () => {
    if (!user?.id) return;
    if (!confirm('Bạn có chắc chắn muốn hủy liên kết với Telegram Bot không?')) return;

    setIsUnlinkingTelegram(true);
    try {
      const { error: unlinkError } = await supabase
        .from('profiles')
        .update({ telegram_chat_id: null })
        .eq('id', user.id);

      if (unlinkError) throw unlinkError;
      await refreshProfile();
      setReloadKey((value) => value + 1);
      toast.success('Đã hủy liên kết Telegram thành công');
    } catch (err: any) {
      toast.error(err?.message || 'Không thể hủy liên kết Telegram.');
    } finally {
      setIsUnlinkingTelegram(false);
    }
  };

  const handleConnectTelegram = async () => {
    if (!user?.id) {
      notifyTelegramResult('Lỗi: Không tìm thấy ID người dùng. Vui lòng đăng nhập lại.');
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
        notifyTelegramResult('Lỗi kết nối. Vui lòng thử lại.');
        return;
      }

      if (!profileExists) {
        notifyTelegramResult('Hồ sơ chưa được tạo. Vui lòng hoàn thành khảo sát lần đầu trước khi kết nối Telegram.');
        return;
      }

      const sessionRes = await supabase.auth.getSession();
      const accessToken = sessionRes.data.session?.access_token;
      if (!accessToken) {
        notifyTelegramResult('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
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

      window.open(String(payload.telegramLink), '_blank');
      setIsPollingTelegram(true);
    } catch (err: any) {
      notifyTelegramResult(`Lỗi: ${err?.message || 'Không thể kết nối Telegram.'}`);
    }
  };

  // ── Avatar upload ────────────────────────────────────────────────────────
  const handleAvatarChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;

    const maxMb = 5;
    if (file.size > maxMb * 1024 * 1024) {
      toast.error(`Ảnh quá lớn. Vui lòng chọn ảnh dưới ${maxMb}MB.`);
      return;
    }

    setAvatarUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const filePath = `${user.id}/avatar.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true, contentType: file.type });

      if (uploadErr) throw uploadErr;

      const { data: publicData } = supabase.storage.from('avatars').getPublicUrl(filePath);
      const publicUrl = `${publicData.publicUrl}?t=${Date.now()}`;

      const { error: updateErr } = await supabase
        .from('profiles')
        .upsert({ id: user.id, avatar_url: publicUrl, updated_at: new Date().toISOString() });

      if (updateErr) throw updateErr;

      setAvatarUrl(publicUrl);
      await refreshProfile();
      toast.success('Đã cập nhật ảnh đại diện!');
    } catch (err: any) {
      toast.error(err?.message || 'Không thể tải ảnh lên. Vui lòng thử lại.');
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  // ── BMI + completion ─────────────────────────────────────────────────────
  const bmi = useMemo(() => {
    const height = Number(formData.height);
    const weight = Number(formData.weight);
    if (!Number.isFinite(height) || !Number.isFinite(weight) || height <= 0 || weight <= 0) return null;
    return weight / ((height / 100) ** 2);
  }, [formData.height, formData.weight]);

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleCancel = () => {
    setIsEditing(false);
    setReloadKey((v) => v + 1);
    navigate('/profile');
  };

  const openProfileEditor = () => {
    setIsSettingsOpen(false);
    navigate('/profile/edit');
  };

  const handleDisableAccount = () => {
    setIsSettingsOpen(false);
    const confirmed = window.confirm('Vô hiệu hóa tài khoản sẽ cần khóa đăng nhập và bảo vệ dữ liệu của bạn. Bạn muốn tiếp tục?');
    if (!confirmed) return;

    toast.warning({
      title: 'Chưa thể vô hiệu hóa tự động',
      message: 'Hệ thống hiện chưa có backend/schema để khóa tài khoản an toàn. Cần thêm API vô hiệu hóa tài khoản trước khi thao tác này hoạt động thật.',
      duration: 6000,
    });
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!user?.id) return;
    setSaving(true);
    setError('');
    try {
      const [profileRes, bodyRes, healthRes, lifestyleRes] = await Promise.all([
        supabase.from('profiles').upsert({
          id: user.id,
          full_name: formData.full_name.trim(),
          email: formData.email || user.email,
          phone: formData.phone.trim(),
          gender: formData.gender,
          birthday: getBirthdayFromAge(formData.age),
          job: formData.job.trim(),
          updated_at: new Date().toISOString(),
        }),
        supabase.from('body_metrics').insert({
          user_id: user.id,
          height: parseNumberOrNull(formData.height),
          weight: parseNumberOrNull(formData.weight),
          target_weight: parseNumberOrNull(formData.target_weight),
          body_fat: parseNumberOrNull(formData.body_fat),
        }),
        supabase.from('health_conditions').upsert({
          user_id: user.id,
          health_condition: formData.health_condition.trim(),
          injuries: formData.injuries.trim(),
          medical_history: formData.allergies.trim(),
          medications: formData.medications.trim(),
          updated_at: new Date().toISOString(),
        }),
        supabase.from('lifestyle_settings').upsert({
          user_id: user.id,
          fitness_goal: formData.fitness_goal,
          diet_preference: formData.diet_preference,
          budget_level: formData.budget_level,
          updated_at: new Date().toISOString(),
        }),
      ]);

      const firstError = [profileRes.error, bodyRes.error, healthRes.error, lifestyleRes.error].find(Boolean);
      if (firstError) throw firstError;

      await refreshProfile();
      setLatestBodyCreatedAt(new Date().toISOString());
      setIsEditing(false);
      toast.success('Đã lưu thông tin hồ sơ!');
      navigate('/profile');
    } catch (err: any) {
      setError(err?.message || 'Không thể lưu thông tin cá nhân.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ProfileSkeleton />;

  const rawName = formData.full_name || profile?.full_name || user?.email?.split('@')[0] || 'Thành viên';
  const initial = rawName.trim().charAt(0).toUpperCase() || '?';
  const membershipLabel = membershipLabels[membershipTier] || 'Free';
  const bmiLabel = bmi ? bmi.toFixed(1) : '--';
  const bmiStatus = getBmiStatus(bmi);
  const joinedLabel = profile?.created_at ? `Thành viên từ tháng ${formatJoinMonth(profile.created_at)}` : '';
  const goalLabel = fitnessGoal || 'Chưa đặt mục tiêu';
  const aiLimit = AI_LIMIT[membershipTier] ?? 25;
  const aiSwapLimit = AI_SWAP_LIMIT[membershipTier] ?? 5;
  const referralLink = refCode ? `${APP_URL}/register?ref=${refCode}` : '';

  const level = dbLevel;
  const expInLevel = totalExp % 100;

  const CHALLENGE_ICONS: Record<string, ReactNode> = {
    workout: <Flame className="h-5 w-5" />,
    meal:    <Apple className="h-5 w-5" />,
    sleep:   <Zap className="h-5 w-5" />,
    water:   <Zap className="h-5 w-5" />,
    manual:  <Trophy className="h-5 w-5" />,
  };
  const CHALLENGE_COLORS = [
    'text-orange-400 bg-orange-400/15 border-orange-400/25',
    'text-yellow-400 bg-yellow-400/15 border-yellow-400/25',
    'text-accent bg-accent/15 border-accent/25',
    'text-emerald-400 bg-emerald-400/15 border-emerald-400/25',
  ];

  if (isProfileEditPage || isEditing) {
    return (
      <form onSubmit={handleSave} className="dashboard-page-shell pb-5 md:pb-7 space-y-4">
        <div className="flex items-start gap-3 px-1">
          <button
            type="button"
            onClick={handleCancel}
            disabled={saving}
            className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border-primary bg-bg-tertiary text-text-secondary transition-colors hover:text-text-primary disabled:opacity-60"
            title="Quay lại hồ sơ"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-black text-text-primary">Cập nhật hồ sơ</h1>
            <p className="mt-1 text-sm font-semibold text-text-secondary">Cập nhật hồ sơ, chỉ số cơ thể và các lưu ý sức khỏe.</p>
          </div>
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section id="thong-tin-ca-nhan" className="rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-[0_8px_24px_rgba(0,0,0,0.08)] md:p-6">
            <SectionTitle icon={<User className="h-4 w-4" />} title="Thông tin cá nhân" helper="Thông tin nhận diện cơ bản của bạn." />
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <ProfileField label="Họ và tên" name="full_name" value={formData.full_name} onChange={handleChange} editing icon={<User className="h-4 w-4" />} />
              <ProfileField label="Tuổi" name="age" value={formData.age} onChange={handleChange} editing type="number" suffix="tuổi" icon={<CalendarDays className="h-4 w-4" />} />
              <div className="md:col-span-2">
                <OptionButtonGroup
                  label="Giới tính"
                  value={formData.gender}
                  options={GENDER_OPTIONS}
                  onChange={(value) => setFormData((prev) => ({ ...prev, gender: value }))}
                  columns="sm:grid-cols-2"
                  icons={GENDER_ICONS}
                />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-[0_8px_24px_rgba(0,0,0,0.08)] md:p-6">
            <SectionTitle icon={<Trophy className="h-4 w-4" />} title="Mục tiêu chính" helper="Chọn một mục tiêu để Fitly cá nhân hóa bài tập, dinh dưỡng và nhịp phục hồi." />
            <div className="mt-5">
              <OptionButtonGroup
                label="Mục tiêu"
                value={formData.fitness_goal}
                options={FITNESS_GOAL_OPTIONS}
                onChange={(value) => setFormData((prev) => ({ ...prev, fitness_goal: value }))}
                columns="sm:grid-cols-2 xl:grid-cols-3"
                icons={FITNESS_GOAL_ICONS}
                descriptions={FITNESS_GOAL_DESCRIPTIONS}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-[0_8px_24px_rgba(0,0,0,0.08)] md:p-6">
            <SectionTitle icon={<Apple className="h-4 w-4" />} title="Thực đơn & ngân sách" helper="Các lựa chọn chính để Fitly gợi ý bữa ăn phù hợp hơn." />
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <OptionButtonGroup
                label="Kiểu ăn"
                value={formData.diet_preference}
                options={DIET_PREFERENCE_OPTIONS}
                onChange={(value) => setFormData((prev) => ({ ...prev, diet_preference: value }))}
                columns="sm:grid-cols-2 xl:grid-cols-3"
                descriptions={DIET_PREFERENCE_DESCRIPTIONS}
              />
              <div className="md:col-span-2">
                <OptionButtonGroup
                  label="Ngân sách bữa ăn"
                  value={formData.budget_level}
                  options={MEAL_BUDGET_OPTIONS}
                  onChange={(value) => setFormData((prev) => ({ ...prev, budget_level: value }))}
                  columns="sm:grid-cols-3"
                  descriptions={MEAL_BUDGET_DESCRIPTIONS}
                />
              </div>
              <div className="md:col-span-2">
                <ProfileTextArea label="Dị ứng / thực phẩm cần tránh" name="allergies" value={formData.allergies} onChange={handleChange} editing icon={<AlertCircle className="h-4 w-4" />} />
              </div>
            </div>
          </section>
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-2">
          <section id="chi-so-co-the" className="rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-[0_8px_24px_rgba(0,0,0,0.08)] md:p-6">
            <SectionTitle icon={<Ruler className="h-4 w-4" />} title="Chỉ số cơ thể" helper="Mỗi lần lưu sẽ tạo một mốc mới để theo dõi tiến độ." />
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <ProfileField label="Chiều cao" name="height" value={formData.height} onChange={handleChange} editing type="number" suffix="cm" viewValue={formatMetric(formData.height, 'cm')} icon={<Ruler className="h-4 w-4" />} />
              <ProfileField label="Cân nặng hiện tại" name="weight" value={formData.weight} onChange={handleChange} editing type="number" suffix="kg" viewValue={formatMetric(formData.weight, 'kg')} icon={<Scale className="h-4 w-4" />} />
              <ProfileField label="Cân nặng mục tiêu" name="target_weight" value={formData.target_weight} onChange={handleChange} editing type="number" suffix="kg" viewValue={formatMetric(formData.target_weight, 'kg')} icon={<BadgeCheck className="h-4 w-4" />} />
              <ProfileField label="Body fat" name="body_fat" value={formData.body_fat} onChange={handleChange} editing type="number" suffix="%" viewValue={formatMetric(formData.body_fat, '%')} icon={<Activity className="h-4 w-4" />} />
            </div>
          </section>

          <section id="suc-khoe" className="rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-[0_8px_24px_rgba(0,0,0,0.08)] md:p-6">
            <SectionTitle icon={<HeartPulse className="h-4 w-4" />} title="Sức khỏe cơ bản" helper="Chỉ giữ các lưu ý ảnh hưởng trực tiếp tới độ an toàn khi tập." />
            <div className="mt-5 grid gap-4">
              <ProfileTextArea label="Bệnh nền / lưu ý sức khỏe" name="health_condition" value={formData.health_condition} onChange={handleChange} editing icon={<HeartPulse className="h-4 w-4" />} />
              <ProfileTextArea label="Chấn thương" name="injuries" value={formData.injuries} onChange={handleChange} editing icon={<Activity className="h-4 w-4" />} />
            </div>
          </section>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleCancel}
            disabled={saving}
            className="inline-flex flex-1 h-12 items-center justify-center gap-2 rounded-xl border border-border-primary bg-bg-tertiary text-sm font-black text-text-secondary transition-colors hover:text-text-primary disabled:opacity-60"
          >
            <X className="h-4 w-4" /> Hủy
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex flex-1 h-12 items-center justify-center gap-2 rounded-xl bg-accent text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Lưu thay đổi
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handleSave} className="dashboard-page-shell pb-5 md:pb-7 space-y-4">
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAvatarChange}
      />

      <div className="flex items-center justify-between px-1">
        <h1 className="text-xl font-black text-text-primary">Hồ sơ</h1>
        <div ref={settingsMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setIsSettingsOpen((value) => !value)}
            className={`flex h-9 w-9 items-center justify-center rounded-xl border border-border-primary bg-bg-tertiary text-text-secondary transition-colors hover:text-text-primary ${isSettingsOpen ? 'text-accent' : ''}`}
            aria-label="Cài đặt hồ sơ"
            aria-expanded={isSettingsOpen}
            title="Cài đặt"
          >
            <Settings className="h-4 w-4" />
          </button>

          {isSettingsOpen && (
            <div className="absolute right-0 top-11 z-20 w-64 overflow-hidden rounded-xl border border-border-primary bg-bg-secondary p-2 shadow-2xl shadow-black/30">
              <button
                type="button"
                onClick={openProfileEditor}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
              >
                <PencilLine className="h-4 w-4 text-accent" />
                Cập nhật hồ sơ
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSettingsOpen(false);
                  onPasswordClick?.();
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
              >
                <Lock className="h-4 w-4 text-accent" />
                Đổi mật khẩu
              </button>
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsOpen(false);
                    navigate('/admin-panel');
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                >
                  <Shield className="h-4 w-4 text-danger" />
                  Quản trị viên
                </button>
              ) : null}
              <div className="my-1 h-px bg-border-primary" />
              <button
                type="button"
                onClick={handleDisableAccount}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-danger transition-colors hover:bg-danger/10"
              >
                <PowerOff className="h-4 w-4" />
                Vô hiệu hóa tài khoản
              </button>
            </div>
          )}
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border-primary bg-bg-secondary shadow-[0_20px_60px_rgba(0,0,0,0.15)]">
        <div className="p-5 md:p-6">

          <div className="flex items-start gap-4">
            <div className="relative shrink-0">
              <button
                type="button"
                disabled={avatarUploading}
                onClick={() => avatarInputRef.current?.click()}
                className="group relative flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent md:h-20 md:w-20"
                title="Đổi ảnh đại diện"
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={rawName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent to-accent/60 text-2xl font-black text-text-inverse md:text-3xl">
                    {initial}
                  </div>
                )}
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  {avatarUploading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-white" />
                  ) : (
                    <Camera className="h-5 w-5 text-white" />
                  )}
                </div>
              </button>
              <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-bg-secondary bg-accent">
                <Zap className="h-2.5 w-2.5 fill-current text-text-inverse" />
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-black text-text-primary leading-tight">{rawName}</span>
                <span className="inline-flex items-center rounded-full bg-accent/20 px-2 py-0.5 text-[11px] font-black text-accent border border-accent/30">
                  Lv.{level}
                </span>
              </div>
              <p className="mt-0.5 text-sm font-semibold text-text-secondary">
                Mục tiêu: <span className="text-accent">{goalLabel}</span>
                {' · '}
                <span className="text-text-tertiary">Người mới</span>
              </p>
              {joinedLabel && (
                <p className="mt-0.5 text-xs text-text-tertiary font-medium">{joinedLabel}</p>
              )}
            </div>

          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">EXP</span>
              <span className="text-[10px] font-black text-text-tertiary">{expInLevel} / 100</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-accent/70 transition-[width] duration-700"
                style={{ width: `${Math.min(100, expInLevel)}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-info/20 bg-bg-secondary shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="p-4 md:p-5">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-info/20 bg-info/10 text-info">
                <Send className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-black text-text-primary">Telegram Bot</h2>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${
                    profile?.telegram_chat_id
                      ? 'border-accent/25 bg-accent/10 text-accent'
                      : 'border-info/25 bg-info/10 text-info'
                  }`}>
                    {profile?.telegram_chat_id ? <Check className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                    {profile?.telegram_chat_id ? 'Đã kết nối' : 'Chưa kết nối'}
                  </span>
                </div>
                <p className="mt-1 text-sm font-semibold leading-6 text-text-secondary">
                  Bot nhận tín hiệu từ Fitly và gửi các nhắc nhở quan trọng vào Telegram, để bạn giữ nhịp tập luyện mà không cần mở web liên tục.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="flex min-w-0 items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-info" />
                <div className="min-w-0">
                  <p className="text-xs font-black text-text-primary">Nhắc đúng lúc</p>
                  <p className="mt-0.5 text-[11px] font-semibold leading-5 text-text-secondary">Nước, ngủ nghỉ và thói quen hằng ngày.</p>
                </div>
              </div>
              <div className="flex min-w-0 items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-info" />
                <div className="min-w-0">
                  <p className="text-xs font-black text-text-primary">Theo lịch tập</p>
                  <p className="mt-0.5 text-[11px] font-semibold leading-5 text-text-secondary">Nhận nhắc buổi tập và kế hoạch hôm nay.</p>
                </div>
              </div>
              <div className="flex min-w-0 items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-info" />
                <div className="min-w-0">
                  <p className="text-xs font-black text-text-primary">Thao tác nhanh</p>
                  <p className="mt-0.5 text-[11px] font-semibold leading-5 text-text-secondary">Theo dõi tiến độ ngay trong cuộc trò chuyện.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between gap-4 border-t border-border-primary bg-bg-tertiary/35 p-4 lg:border-l lg:border-t-0 md:p-5">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-text-tertiary">Trạng thái</p>
              <p className="mt-1 text-lg font-black text-text-primary">
                {profile?.telegram_chat_id ? 'Bot đang bật' : 'Sẵn sàng kích hoạt'}
              </p>
              <p className="mt-1 text-xs font-semibold leading-5 text-text-secondary">
                {profile?.telegram_chat_id
                  ? 'Bạn có thể hủy liên kết bất cứ lúc nào.'
                  : 'Mở Telegram để xác nhận liên kết an toàn.'}
              </p>
            </div>

            {profile?.telegram_chat_id ? (
              <button
                type="button"
                onClick={() => void handleUnlinkTelegram()}
                disabled={isUnlinkingTelegram}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-danger/25 bg-danger/10 px-3 text-xs font-black text-danger transition-colors hover:bg-danger/15 disabled:opacity-60"
              >
                {isUnlinkingTelegram ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Hủy liên kết
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleConnectTelegram()}
                disabled={isPollingTelegram}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-info px-4 text-xs font-black text-text-inverse transition-colors hover:bg-info/90 disabled:cursor-default disabled:opacity-70"
              >
                {isPollingTelegram ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {isPollingTelegram ? 'Đang chờ kết nối...' : 'Kết nối bot'}
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-3 rounded-2xl border border-border-primary bg-bg-secondary px-4 py-4 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-400/15 text-orange-400 border border-orange-400/20">
            <Flame className="h-5 w-5" />
          </span>
          <div>
            <p className="text-2xl font-black text-text-primary leading-none">{streakCount}</p>
            <p className="mt-1 text-xs font-semibold text-text-secondary">Chuỗi duy trì · ngày</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-border-primary bg-bg-secondary px-4 py-4 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent border border-accent/20">
            <CalendarDays className="h-5 w-5" />
          </span>
          <div>
            <p className="text-2xl font-black text-text-primary leading-none">{totalActiveDays}</p>
            <p className="mt-1 text-xs font-semibold text-text-secondary">Tổng ngày hoạt động</p>
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-border-primary bg-bg-secondary shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <h2 className="text-base font-black text-text-primary">Chỉ số cơ thể</h2>
          <button
            type="button"
            onClick={openProfileEditor}
            className="flex items-center gap-1.5 text-xs font-bold text-accent hover:text-accent/80 transition-colors"
          >
            <PencilLine className="h-3.5 w-3.5" />
            Cập nhật
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 px-4 pb-4 md:grid-cols-4">
          <BodyStatCard
            icon={<Scale className="h-4 w-4" />}
            value={formData.weight ? `${formData.weight}` : '--'}
            label="Cân nặng"
            color="text-accent bg-accent/15 border-accent/20"
          />
          <BodyStatCard
            icon={<Ruler className="h-4 w-4" />}
            value={formData.height ? `${formData.height}` : '--'}
            label="Chiều cao"
            color="text-green-400 bg-green-400/15 border-green-400/20"
          />
          <BodyStatCard
            icon={<TrendingUp className="h-4 w-4" />}
            value={formData.body_fat ? `${formData.body_fat}%` : '0%'}
            label="Tỷ lệ mỡ"
            color="text-violet-400 bg-violet-400/15 border-violet-400/20"
          />
          <BodyStatCard
            icon={<Activity className="h-4 w-4" />}
            value={bmiLabel}
            label="BMI"
            helper={bmiStatus}
            color="text-amber-400 bg-amber-400/15 border-amber-400/20"
          />
        </div>
      </section>

      <section className="rounded-2xl border border-border-primary bg-bg-secondary p-4 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
        <div className="flex items-center gap-3 mb-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/15 text-accent border border-accent/20">
            <Trophy className="h-4 w-4" />
          </span>
          <h2 className="text-base font-black text-text-primary">Mục tiêu hiện tại</h2>
        </div>
        <p className="text-lg font-black text-text-primary mb-1">{goalLabel}</p>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-text-secondary">Tiến độ EXP cấp độ</p>
          <span className="text-xs font-black text-accent">Lv.{level} → {level + 1}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-accent/70 transition-[width] duration-700"
            style={{ width: `${Math.min(100, expInLevel)}%` }}
          />
        </div>
      </section>

      {/* ── THÀNH TỰU ─────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-border-primary bg-bg-secondary p-4 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-black text-text-primary">Thành tựu</h2>
          <button type="button" className="flex items-center gap-1 text-xs font-bold text-text-secondary hover:text-text-primary transition-colors">
            Xem tất cả <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {completedChallenges.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border-primary bg-bg-tertiary text-text-tertiary">
              <Trophy className="h-5 w-5" />
            </span>
            <p className="text-xs font-semibold text-text-tertiary">Hoàn thành các thử thách để mở khóa thành tựu!</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {completedChallenges.map((c, i) => (
              <div key={c.id} className="flex flex-col items-center gap-2">
                <span className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${CHALLENGE_COLORS[i % 4]}`}>
                  {CHALLENGE_ICONS[(c.target as any)?.source_type] ?? <Trophy className="h-5 w-5" />}
                </span>
                <div className="text-center">
                  <p className="text-[11px] font-black text-text-primary leading-none line-clamp-2">{c.title}</p>
                  <p className="mt-0.5 text-[10px] font-semibold text-text-tertiary">{c.user_checkin_count} ngày</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>


      {/* ── GÓI AI ───────────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-border-primary bg-bg-secondary shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
        <div className="p-4 md:p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/15 text-accent border border-accent/20">
                <Zap className="h-4 w-4" />
              </span>
              <h2 className="text-base font-black text-text-primary">Gói AI</h2>
            </div>
            {membershipTier !== 'pro' && (
              <button type="button" onClick={openPremiumModal} className="flex items-center gap-1 text-xs font-bold text-accent hover:text-accent/80 transition-colors">
                <TrendingUp className="h-3.5 w-3.5" /> Nâng cấp
              </button>
            )}
          </div>

          {/* Badge */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border-primary bg-bg-tertiary px-3 py-1 text-xs font-black text-text-secondary">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            {membershipLabel.toUpperCase()}
          </span>

          {/* Total AI usage bar */}
          {aiLimit !== Infinity && (
            <div className="mt-3">
              <div className="flex justify-between mb-1.5">
                <p className="text-xs font-semibold text-text-secondary">Lượt AI đã dùng</p>
                <p className="text-xs font-black text-text-primary">{aiUsed} / {aiLimit}</p>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent to-accent/70 transition-[width]"
                  style={{ width: `${Math.min(100, (aiUsed / aiLimit) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Swap limits */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border-primary bg-bg-tertiary/50 p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Activity className="h-3.5 w-3.5 text-accent" />
                <p className="text-xs font-semibold text-text-secondary">Đổi bài tập</p>
              </div>
              <p className="text-lg font-black text-text-primary">{aiSwapWorkout}</p>
              <p className="text-[10px] text-text-tertiary font-semibold">/ {aiSwapLimit === Infinity ? '∞' : aiSwapLimit} lượt</p>
              {aiSwapLimit !== Infinity && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-bg-secondary">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (aiSwapWorkout / aiSwapLimit) * 100)}%` }} />
                </div>
              )}
            </div>
            <div className="rounded-xl border border-border-primary bg-bg-tertiary/50 p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Apple className="h-3.5 w-3.5 text-emerald-400" />
                <p className="text-xs font-semibold text-text-secondary">Đổi món ăn</p>
              </div>
              <p className="text-lg font-black text-text-primary">{aiSwapMeal}</p>
              <p className="text-[10px] text-text-tertiary font-semibold">/ {aiSwapLimit === Infinity ? '∞' : aiSwapLimit} lượt</p>
              {aiSwapLimit !== Infinity && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-bg-secondary">
                  <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.min(100, (aiSwapMeal / aiSwapLimit) * 100)}%` }} />
                </div>
              )}
            </div>
          </div>

          {/* Upgrade buttons */}
          {membershipTier !== 'pro' && (
            <div className="mt-3">
              <button
                type="button"
                onClick={openPremiumModal}
                className="inline-flex w-full h-10 items-center justify-center gap-1.5 rounded-xl bg-accent px-3 text-xs font-black text-text-inverse transition-colors hover:bg-accent-hover"
              >
                <Zap className="h-3.5 w-3.5" /> Mua gói PLUS / PRO
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ── MỜI BẠN BẾ ─────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-border-primary bg-bg-secondary shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
        <div className="p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/15 text-accent border border-accent/20">
              <Users className="h-4 w-4" />
            </span>
            <h2 className="text-base font-black text-text-primary">Mời bạn bè — nhận gói miễn phí</h2>
          </div>

          <p className="text-xs font-semibold text-text-secondary mb-3">
            Bạn bè đăng ký qua link của bạn → họ nhận ưu đãi, bạn được nâng cấp gói.
          </p>

          {/* Ref link + copy */}
          {refCode ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 overflow-hidden rounded-xl border border-border-primary bg-bg-tertiary px-3 py-2.5">
                <p className="truncate text-xs font-semibold text-text-secondary font-mono">
                  {referralLink}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(referralLink);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border-primary bg-bg-tertiary text-text-secondary transition-colors hover:border-accent hover:text-accent"
                title="Sao chép link"
              >
                {copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          ) : (
            <div className="h-10 animate-pulse rounded-xl bg-bg-tertiary" />
          )}

          {/* Số người đã mời */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border-primary bg-bg-tertiary/50 p-3 text-center">
              <p className="text-2xl font-black text-text-primary">{referralCount}</p>
              <p className="mt-0.5 text-[11px] font-semibold text-text-secondary">Đã mời</p>
            </div>
            <div className="rounded-xl border border-border-primary bg-bg-tertiary/50 p-3 text-center">
              <p className="text-2xl font-black text-text-primary">
                {referralCount < 5 ? 5 - referralCount : referralCount < 20 ? 20 - referralCount : 0}
              </p>
              <p className="mt-0.5 text-[11px] font-semibold text-text-secondary">
                {referralCount < 5 ? 'Còn đến PLUS' : referralCount < 20 ? 'Còn đến PRO' : 'Đã đạt PRO 🎉'}
              </p>
            </div>
          </div>

          {/* Progress PLUS */}
          {membershipTier !== 'pro' && (
            <div className="mt-3 space-y-2.5">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-[11px] font-bold text-text-secondary">
                    <span className="text-accent font-black">PLUS</span> — 200 credit/tháng
                  </span>
                  <span className="text-[11px] font-black text-text-tertiary">{Math.min(referralCount, 5)}/5</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-accent to-accent/70 transition-[width] duration-500"
                    style={{ width: `${Math.min(100, (referralCount / 5) * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] font-semibold text-text-tertiary">
                  Còn {Math.max(0, 5 - referralCount)} người nữa
                </p>
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-[11px] font-bold text-text-secondary">
                    <span className="text-amber-400 font-black">PRO</span> — 800 credit/tháng
                  </span>
                  <span className="text-[11px] font-black text-text-tertiary">{Math.min(referralCount, 20)}/20</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-300 transition-[width] duration-500"
                    style={{ width: `${Math.min(100, (referralCount / 20) * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] font-semibold text-text-tertiary">
                  Còn {Math.max(0, 20 - referralCount)} người nữa
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      <button
        type="button"
        onClick={() => void signOut()}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-danger/25 bg-danger/10 text-sm font-black text-danger transition-colors hover:bg-danger/15"
      >
        <LogOut className="h-4 w-4" />
        Đăng xuất
      </button>

    </form>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <div className="dashboard-page-shell flex flex-col gap-4 pb-4 md:gap-5 md:pb-6 lg:pb-7">
      <section className="rounded-2xl border border-border-primary bg-bg-secondary p-6">
        {SkeletonBlock('h-32 w-full rounded-xl')}
      </section>
      <div className="grid grid-cols-2 gap-3">
        {SkeletonBlock('h-20 rounded-xl')}
        {SkeletonBlock('h-20 rounded-xl')}
      </div>
      {SkeletonBlock('h-40 rounded-xl')}
      {SkeletonBlock('h-32 rounded-xl')}
    </div>
  );
}

function BodyStatCard({
  icon,
  value,
  label,
  helper,
  color,
}: {
  icon: ReactNode;
  value: string;
  label: string;
  helper?: string;
  color: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border-primary bg-bg-tertiary/40 p-3">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl border ${color}`}>
        {icon}
      </span>
      <div>
        <p className="text-xl font-black text-text-primary leading-none">{value}</p>
        <p className="mt-1 text-[11px] font-semibold text-text-secondary">{label}</p>
        {helper && <p className="text-[10px] font-semibold text-text-tertiary">{helper}</p>}
      </div>
    </div>
  );
}

function SectionTitle({ icon, title, helper }: { icon: ReactNode; title: string; helper: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-border-primary pb-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-black text-text-primary">{title}</h2>
        <p className="mt-1 text-sm font-semibold leading-6 text-text-secondary">{helper}</p>
      </div>
    </div>
  );
}

function ProfileField({
  label, name, value, onChange, editing, icon, type = 'text', suffix, viewValue,
}: {
  label: string; name: string; value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  editing: boolean; icon?: ReactNode; type?: string; suffix?: string; viewValue?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-[10px] font-black uppercase text-text-tertiary">{label}</span>
      {editing ? (
        <div className="relative mt-1.5">
          {icon ? <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-text-tertiary">{icon}</span> : null}
          <input
            name={name} type={type} value={value} onChange={onChange}
            step={type === 'number' ? '0.1' : undefined}
            className={`h-11 w-full rounded-xl border border-border-primary bg-bg-tertiary text-sm font-semibold text-text-primary outline-none transition-colors focus:border-accent ${icon ? 'pl-10' : 'pl-3'} ${suffix ? 'pr-10' : 'pr-3'}`}
          />
          {suffix ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black text-text-tertiary">{suffix}</span> : null}
        </div>
      ) : (
        <div className="mt-1.5 flex min-h-11 items-center gap-3 rounded-xl border border-border-primary bg-bg-tertiary/45 px-3 py-2.5">
          {icon ? <span className="shrink-0 text-text-tertiary">{icon}</span> : null}
          <p className="min-w-0 truncate text-sm font-black text-text-primary">{viewValue || formatValue(value)}</p>
        </div>
      )}
    </label>
  );
}

function OptionButtonGroup({
  label,
  value,
  options,
  onChange,
  columns = 'sm:grid-cols-3',
  icons,
  descriptions,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  columns?: string;
  icons?: Record<string, ReactNode>;
  descriptions?: Record<string, string>;
}) {
  return (
    <div>
      <span className="text-[10px] font-black uppercase text-text-tertiary">{label}</span>
      <div className={`mt-1.5 grid gap-2 ${columns}`}>
        {options.map((option) => {
          const selected = value === option;
          const icon = icons?.[option];
          const description = descriptions?.[option];
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={`rounded-xl border px-3 py-2 text-sm font-black transition-colors ${
                description
                  ? 'flex min-h-[112px] items-start gap-3 text-left'
                  : icon
                    ? 'flex min-h-12 items-center justify-center gap-2'
                    : 'min-h-11'
              } ${
                selected
                  ? 'border-accent/40 bg-accent/15 text-accent'
                  : 'border-border-primary bg-bg-tertiary text-text-secondary hover:text-text-primary'
              }`}
            >
              {icon ? (
                <span className={`${description ? 'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-secondary' : ''} ${selected ? 'text-accent' : 'text-text-primary'}`}>
                  {icon}
                </span>
              ) : null}
              {description ? (
                <span className="min-w-0">
                  <span className={`block text-sm font-black leading-tight ${selected ? 'text-accent' : 'text-text-primary'}`}>{option}</span>
                  <span className="mt-1.5 block text-xs font-semibold leading-5 text-text-tertiary">{description}</span>
                </span>
              ) : (
                option
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProfileTextArea({
  label, name, value, onChange, editing, icon,
}: {
  label: string; name: string; value: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  editing: boolean; icon?: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase text-text-tertiary">{label}</span>
      {editing ? (
        <div className="relative mt-1.5">
          {icon ? <span className="pointer-events-none absolute left-3 top-3.5 text-text-tertiary">{icon}</span> : null}
          <textarea
            name={name} value={value} onChange={onChange} rows={3}
            className={`w-full resize-none rounded-xl border border-border-primary bg-bg-tertiary py-3 pr-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-accent ${icon ? 'pl-10' : 'pl-3'}`}
          />
        </div>
      ) : (
        <div className="mt-1.5 flex min-h-[4.75rem] items-start gap-3 rounded-xl border border-border-primary bg-bg-tertiary/45 px-3 py-3">
          {icon ? <span className="mt-1 shrink-0 text-text-tertiary">{icon}</span> : null}
          <p className="whitespace-pre-line text-sm font-semibold leading-6 text-text-primary">{formatValue(value)}</p>
        </div>
      )}
    </label>
  );
}
