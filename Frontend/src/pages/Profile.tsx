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
  Ruler,
  Save,
  Scale,
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
import { useLocation, useNavigate, useOutletContext } from 'react-router';
import { supabase } from '../lib/Supabase';
import { useAuth } from '../contexts/AuthContext';
import { SkeletonBlock } from '../components/PageSkeleton';
import { useToast } from '../components/ToastProvider';
import { getUserChallenges, type ChallengeSummary } from '../lib/Challenges';
import { fetchWithAuth } from '../lib/Api';
import AiPlanCard from '../components/AiPlanCard';
import { profileDetailsResource } from '../lib/accountReads';
import {
  EQUIPMENT_TYPES,
  TRAINING_LOCATIONS,
  experienceLevelToMonths,
  normalizeTrainingLocation,
  parseAvailableEquipment,
  type Equipment,
  type TrainingLocation,
} from '../lib/exerciseCatalog';
import {
  ALLERGENS,
  normalizeAllergies,
  normalizeBudgetLevel,
  normalizeDietaryRestrictions,
  normalizeDietStyles,
} from '../lib/dietaryPreferences';

const emptyForm = {
  full_name: '',
  email: '',
  gender: 'Nam',
  birthday: '',
  age: '',
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
  dietary_restrictions: [] as string[],
  diet_styles: ['balanced'] as string[],
  budget_level: 'medium',
  workout_location: 'home',
  equipment_available: 'none',
  experience_level: 'absolute_beginner',
};

const toInput = (value: unknown) => {
  if (value === null || value === undefined || value === 0) return '';
  return String(value);
};

const getApiErrorMessage = (value: unknown, fallback: string) => {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object') {
    const record = value as { message?: unknown; error?: unknown };
    if (typeof record.message === 'string' && record.message.trim()) return record.message;
    if (typeof record.error === 'string' && record.error.trim()) return record.error;
  }
  return fallback;
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
const MEAL_BUDGET_OPTIONS = ['low', 'medium', 'high'];
const MEAL_BUDGET_LABELS: Record<string, string> = { low: 'Tiết kiệm', medium: 'Bình thường', high: 'Thoải mái' };
const MEAL_BUDGET_DESCRIPTIONS: Record<string, string> = {
  low: 'Ưu tiên nguyên liệu phổ biến, dễ mua và chi phí thấp.',
  medium: 'Cân bằng giữa chi phí, độ tiện lợi và chất lượng bữa ăn.',
  high: 'Linh hoạt hơn với nguyên liệu đa dạng và món ăn phong phú.',
};
const DIETARY_RESTRICTION_OPTIONS = ['vegetarian', 'vegan'];
const DIET_STYLE_OPTIONS = ['clean', 'high_protein', 'low_carb', 'balanced'];
const DIETARY_RESTRICTION_LABELS: Record<string, string> = { vegetarian: 'Ăn chay', vegan: 'Thuần chay' };
const DIET_STYLE_LABELS: Record<string, string> = { clean: 'Eat clean', high_protein: 'Giàu protein', low_carb: 'Low carb', balanced: 'Cân bằng' };
const GENDER_OPTIONS = ['Nam', 'Nữ'];
const ALLERGEN_LABELS: Record<string, string> = { peanut: 'Đậu phộng', tree_nuts: 'Hạt cây', milk: 'Sữa', egg: 'Trứng', soy: 'Đậu nành', wheat: 'Lúa mì', fish: 'Cá', shellfish: 'Giáp xác', sesame: 'Mè' };
const GENDER_ICONS: Record<string, ReactNode> = {
  Nam: <Mars className="h-6 w-6" strokeWidth={2.4} />,
  Nữ: <Venus className="h-6 w-6" strokeWidth={2.4} />,
};

const TRAINING_LOCATION_LABELS: Record<TrainingLocation, string> = {
  home: 'Tập tại nhà',
  gym: 'Phòng gym',
};

const TRAINING_LOCATION_DESCRIPTIONS: Record<TrainingLocation, string> = {
  home: 'Ưu tiên những bài phù hợp với không gian tại nhà.',
  gym: 'Chọn bài phù hợp với điều kiện ở phòng gym.',
};

const LEGACY_WORKOUT_LOCATION_VALUES: Record<string, TrainingLocation> = {
  'Phòng Gym chuyên nghiệp': 'gym',
};

const EQUIPMENT_LABELS: Record<Equipment, string> = {
  none: 'Không có dụng cụ',
  chair: 'Ghế',
  bench: 'Ghế tập',
  resistance_band: 'Dây kháng lực',
  dumbbell: 'Tạ đơn',
  kettlebell: 'Tạ ấm',
  barbell: 'Tạ đòn',
  cable: 'Cáp tập',
  machine: 'Máy tập',
  pull_up_bar: 'Xà đơn',
  stability_ball: 'Bóng tập',
  foam_roller: 'Con lăn',
};

const EXPERIENCE_LEVEL_OPTIONS = [
  {
    value: 'absolute_beginner',
    label: 'Người mới hoàn toàn',
    description: 'Chưa tập hoặc mới bắt đầu làm quen với các động tác cơ bản.',
  },
  {
    value: 'beginner',
    label: 'Dưới 3 tháng',
    description: 'Đang xây nền tảng kỹ thuật và thói quen tập đều.',
  },
  {
    value: 'beginner_plus',
    label: '3–6 tháng',
    description: 'Đã quen động tác cơ bản và có thể tăng dần độ khó.',
  },
  {
    value: 'intermediate',
    label: '6–12 tháng',
    description: 'Tập đều, có thể theo chương trình với cấu trúc rõ ràng.',
  },
  {
    value: 'advanced',
    label: 'Trên 1 năm',
    description: 'Có nhiều kinh nghiệm tập luyện và kiểm soát kỹ thuật tốt.',
  },
] as const;

type WorkoutExperienceLevel = typeof EXPERIENCE_LEVEL_OPTIONS[number]['value'];

const EXPERIENCE_LEVEL_LABELS = Object.fromEntries(
  EXPERIENCE_LEVEL_OPTIONS.map((option) => [option.value, option.label]),
) as Record<WorkoutExperienceLevel, string>;

const EXPERIENCE_LEVEL_DESCRIPTIONS = Object.fromEntries(
  EXPERIENCE_LEVEL_OPTIONS.map((option) => [option.value, option.description]),
) as Record<WorkoutExperienceLevel, string>;

const normalizeGender = (value: unknown) => (
  GENDER_OPTIONS.includes(String(value)) ? String(value) : 'Nam'
);

const normalizeFitnessGoal = (value: unknown) => {
  const goal = String(value || '').trim();
  const normalized = LEGACY_FITNESS_GOAL_MAP[goal] || goal;
  return FITNESS_GOAL_OPTIONS.includes(normalized) ? normalized : 'Giảm mỡ';
};

const normalizeWorkoutLocation = (value: unknown): TrainingLocation =>
  normalizeTrainingLocation(value)
  ?? LEGACY_WORKOUT_LOCATION_VALUES[String(value ?? '').trim()]
  ?? 'home';

const serializeAvailableEquipment = (equipment: Iterable<Equipment>): string => {
  const selected = new Set(equipment);
  const canonicalEquipment = EQUIPMENT_TYPES.filter((item) => item !== 'none' && selected.has(item));
  return canonicalEquipment.length > 0 ? canonicalEquipment.join(',') : 'none';
};

const normalizeAvailableEquipment = (value: unknown): string =>
  serializeAvailableEquipment(parseAvailableEquipment(value));

const normalizeExperienceLevel = (value: unknown): WorkoutExperienceLevel => {
  const experienceMonths = experienceLevelToMonths(value);
  if (experienceMonths <= 0) return 'absolute_beginner';
  if (experienceMonths <= 2) return 'beginner';
  if (experienceMonths <= 5) return 'beginner_plus';
  if (experienceMonths <= 11) return 'intermediate';
  return 'advanced';
};

type ProfileDetails = NonNullable<ReturnType<typeof profileDetailsResource.read>['data']>;

function buildProfileForm(profile: any, details: ProfileDetails | null, lifestyle: any, user: any): typeof emptyForm {
  const p = profile || {};
  const b = details?.body || {};
  const h = details?.health || {};
  const lifestyleRes = { data: lifestyle || {} };
  const metadataFullName = user?.user_metadata?.full_name || '';
  const userEmail = user?.email || '';
  return {
    full_name: p.full_name || metadataFullName || '',
    email: p.email || userEmail,
    gender: normalizeGender(p.gender),
    birthday: p.birthday || '',
    age: getAgeFromBirthday(p.birthday || ''),
    height: toInput(b.height),
    weight: toInput(b.weight),
    target_weight: toInput(b.target_weight),
    body_fat: toInput(b.body_fat || b.body_fat_percentage),
    health_condition: h.health_condition || '',
    injuries: h.injuries || '',
    allergies: Array.isArray(h.allergies) && h.allergies.length > 0 ? h.allergies.join(', ') : h.medical_history || '',
    medications: h.medications || 'Không sử dụng thuốc',
    fitness_goal: normalizeFitnessGoal(lifestyleRes.data?.fitness_goal),
    diet_preference: lifestyleRes.data?.diet_preference || 'Bình thường',
    dietary_restrictions: normalizeDietaryRestrictions(lifestyleRes.data?.dietary_restrictions, lifestyleRes.data?.diet_preference, lifestyleRes.data?.current_diet),
    diet_styles: normalizeDietStyles(lifestyleRes.data?.diet_styles, lifestyleRes.data?.diet_preference, lifestyleRes.data?.current_diet),
    budget_level: normalizeBudgetLevel(lifestyleRes.data?.budget_level) || 'medium',
    workout_location: normalizeWorkoutLocation(lifestyleRes.data?.workout_location),
    equipment_available: normalizeAvailableEquipment(lifestyleRes.data?.equipment_available),
    experience_level: normalizeExperienceLevel(lifestyleRes.data?.experience_level),
  };
}

type ProfileOutletContext = {
  onPasswordClick?: () => void;
};

export default function Profile() {
  const { onPasswordClick } = useOutletContext<ProfileOutletContext>();
  const navigate = useNavigate();
  const location = useLocation();
  const isProfileEditPage = location.pathname === '/profile/edit';
  const { user, profile, lifestyle: accountLifestyle, membershipTier, membership, isAdmin, refreshTick, openPremiumModal, refreshProfile, signOut } = useAuth();
  const toast = useToast();
  const initialDetails = profileDetailsResource.read(user?.id).data;
  const [formData, setFormData] = useState(() => buildProfileForm(profile, initialDetails, accountLifestyle, user));
  const selectedAllergies = normalizeAllergies(formData.allergies).filter((value) => ALLERGENS.includes(value as typeof ALLERGENS[number]));
  const [latestBodyCreatedAt, setLatestBodyCreatedAt] = useState(initialDetails?.body?.created_at || '');
  const [loading, setLoading] = useState(() => !initialDetails);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(isProfileEditPage);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_url || null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [fitnessGoal, setFitnessGoal] = useState(normalizeFitnessGoal(accountLifestyle?.fitness_goal));
  const [streakCount, setStreakCount] = useState<number | null>(null);
  const [totalActiveDays, setTotalActiveDays] = useState<number | null>(null);
  const [totalExp, setTotalExp] = useState(profile?.exp ?? 0);
  const [dbLevel, setDbLevel] = useState(profile?.level ?? 1);
  const [refCode, setRefCode] = useState(profile?.ref_code || '');
  const [referralCount, setReferralCount] = useState(profile?.referral_count ?? 0);
  const [copied, setCopied] = useState(false);
  const [completedChallenges, setCompletedChallenges] = useState<ChallengeSummary[]>([]);
  const [challengesLoading, setChallengesLoading] = useState(true);
  const [challengesError, setChallengesError] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteAccountError, setDeleteAccountError] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);

  // Reuse the authenticated profile; only body and health details gate this page.
  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;
    let cancelled = false;
    async function loadProfile() {
      setLoading(!profileDetailsResource.read(userId).data);
      setError('');
      try {
        const details = await profileDetailsResource.load(userId);
        if (cancelled) return;
        setFormData(buildProfileForm(profile, details, accountLifestyle, user));
        setLatestBodyCreatedAt(details.body?.created_at || '');
        setAvatarUrl(profile?.avatar_url || null);
        setFitnessGoal(normalizeFitnessGoal(accountLifestyle?.fitness_goal));
        setTotalExp(profile?.exp ?? 0);
        setDbLevel(profile?.level ?? 1);
        setRefCode(profile?.ref_code || '');
        setReferralCount(profile?.referral_count ?? 0);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Không thể tải thông tin cá nhân.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadProfile();
    return () => { cancelled = true; };
  }, [reloadKey, user?.id]);

  // Slow activity and challenge reads update their own sections independently.
  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;
    let cancelled = false;
    setChallengesLoading(true);
    setChallengesError(false);
    void (async () => {
      try {
        const result = await supabase.from('daily_progress_logs').select('log_date').eq('user_id', userId).order('log_date', { ascending: false }).limit(90);
        if (cancelled) return;
        if (result.error) throw result.error;
        const logs = result.data || [];
        setTotalActiveDays(logs.length);
        const dates = new Set(logs.map((row: any) => row.log_date as string));
        let streak = 0;
        const today = new Date();
        for (let i = 0; i < 365; i++) {
          const date = new Date(today);
          date.setDate(date.getDate() - i);
          if (dates.has(date.toISOString().slice(0, 10))) streak++;
          else if (i > 0) break;
        }
        setStreakCount(streak);
      } catch { if (!cancelled) { setStreakCount(null); setTotalActiveDays(null); } }
    })();
    void (async () => {
      try {
        const challenges = await getUserChallenges(userId);
        if (!cancelled) setCompletedChallenges(challenges.filter((challenge) => challenge.status === 'completed').sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 4));
      } catch { if (!cancelled) setChallengesError(true); }
      finally { if (!cancelled) setChallengesLoading(false); }
    })();
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

  // ── Avatar upload ────────────────────────────────────────────────────────
  const handleAvatarChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;

    const maxMb = 5;
    const acceptedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    if (!acceptedTypes.has(file.type)) {
      toast.error('Chỉ hỗ trợ ảnh JPG, PNG, WebP hoặc GIF.');
      return;
    }
    if (file.size > maxMb * 1024 * 1024) {
      toast.error(`Ảnh quá lớn. Vui lòng chọn ảnh dưới ${maxMb}MB.`);
      return;
    }

    setAvatarUploading(true);
    try {
      const response = await fetchWithAuth('/api/profile/avatar', {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.avatarUrl) {
        throw new Error(getApiErrorMessage(payload?.error, 'Unable to upload avatar.'));
      }
      const publicUrl = `${payload.avatarUrl}?t=${Date.now()}`;

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

  const openDeleteAccountDialog = () => {
    setIsSettingsOpen(false);
    setDeletePassword('');
    setDeleteConfirmation('');
    setDeleteAccountError('');
    setIsDeleteAccountOpen(true);
  };

  const handleDeleteAccount = async () => {
    if (!user?.email || isDeletingAccount) return;
    if (deleteConfirmation.trim().toUpperCase() !== 'XÓA') {
      setDeleteAccountError('Vui lòng nhập XÓA để xác nhận.');
      return;
    }
    if (!deletePassword) {
      setDeleteAccountError('Vui lòng nhập mật khẩu hiện tại.');
      return;
    }

    setIsDeletingAccount(true);
    setDeleteAccountError('');
    try {
      const reauth = await supabase.auth.signInWithPassword({
        email: user.email,
        password: deletePassword,
      });
      if (reauth.error) {
        throw new Error('Mật khẩu không chính xác.');
      }

      const response = await fetchWithAuth('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'DELETE' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload?.error, 'Không thể xóa tài khoản lúc này.'));
      }

      await signOut();
      navigate('/', { replace: true });
    } catch (error: any) {
      setDeleteAccountError(error?.message || 'Không thể xóa tài khoản lúc này.');
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!user?.id) return;
    setSaving(true);
    setError('');
    try {
      const dietaryRestrictions = normalizeDietaryRestrictions(formData.dietary_restrictions);
      const dietStyles = normalizeDietStyles(formData.diet_styles);
      const normalizedBudget = normalizeBudgetLevel(formData.budget_level);
      const normalizedAllergies = normalizeAllergies(formData.allergies);
      const [profileRes, bodyRes, healthRes, lifestyleRes] = await Promise.all([
        fetchWithAuth('/api/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            full_name: formData.full_name.trim(),
            email: formData.email || user.email,
            gender: formData.gender,
            birthday: getBirthdayFromAge(formData.age),
          }),
        }).then(async (response) => {
            const payload = await response.json().catch(() => ({}));
            return response.ok
              ? { data: payload.data, error: null }
              : { data: null, error: new Error(getApiErrorMessage(payload?.error, 'Unable to save profile.')) };
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
          allergies: normalizedAllergies,
          medications: formData.medications.trim(),
          updated_at: new Date().toISOString(),
        }),
        supabase.from('lifestyle_settings').upsert({
          user_id: user.id,
          fitness_goal: formData.fitness_goal,
          // The scalar remains for legacy clients; the arrays are authoritative.
          diet_preference: dietaryRestrictions[0] || dietStyles[0] || formData.diet_preference,
          dietary_restrictions: dietaryRestrictions,
          diet_styles: dietStyles,
          budget_level: normalizedBudget || formData.budget_level,
          workout_location: normalizeWorkoutLocation(formData.workout_location),
          equipment_available: normalizeAvailableEquipment(formData.equipment_available),
          experience_level: normalizeExperienceLevel(formData.experience_level),
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
  const bmiLabel = bmi ? bmi.toFixed(1) : '--';
  const bmiStatus = getBmiStatus(bmi);
  const joinedLabel = profile?.created_at ? `Thành viên từ tháng ${formatJoinMonth(profile.created_at)}` : '';
  const goalLabel = fitnessGoal || 'Chưa đặt mục tiêu';
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

        <div className="grid items-start gap-5 lg:grid-cols-2">
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

          <section id="chi-so-co-the" className="rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-[0_8px_24px_rgba(0,0,0,0.08)] md:p-6">
            <SectionTitle icon={<Ruler className="h-4 w-4" />} title="Chỉ số cơ thể" helper="Mỗi lần lưu sẽ tạo một mốc mới để theo dõi tiến độ." />
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <ProfileField label="Chiều cao" name="height" value={formData.height} onChange={handleChange} editing type="number" suffix="cm" viewValue={formatMetric(formData.height, 'cm')} icon={<Ruler className="h-4 w-4" />} />
              <ProfileField label="Cân nặng hiện tại" name="weight" value={formData.weight} onChange={handleChange} editing type="number" suffix="kg" viewValue={formatMetric(formData.weight, 'kg')} icon={<Scale className="h-4 w-4" />} />
              <ProfileField label="Cân nặng mục tiêu" name="target_weight" value={formData.target_weight} onChange={handleChange} editing type="number" suffix="kg" viewValue={formatMetric(formData.target_weight, 'kg')} icon={<BadgeCheck className="h-4 w-4" />} />
              <ProfileField label="Body fat" name="body_fat" value={formData.body_fat} onChange={handleChange} editing type="number" suffix="%" viewValue={formatMetric(formData.body_fat, '%')} icon={<Activity className="h-4 w-4" />} />
            </div>
          </section>
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-2">
          <div className="space-y-5">
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
              <div className="mt-5 space-y-5">
                <OptionButtonGroup
                  label="Phong cách ăn"
                  value={formData.diet_preference}
                  options={DIET_PREFERENCE_OPTIONS}
                  onChange={(value) => setFormData((prev) => ({ ...prev, diet_preference: value }))}
                  columns="sm:grid-cols-2 xl:grid-cols-3"
                  descriptions={DIET_PREFERENCE_DESCRIPTIONS}
                />
                <OptionButtonGroup
                  label="Ngân sách bữa ăn"
                  value={formData.budget_level}
                  options={MEAL_BUDGET_OPTIONS}
                  onChange={(value) => setFormData((prev) => ({ ...prev, budget_level: value }))}
                  columns="sm:grid-cols-3"
                  optionLabels={MEAL_BUDGET_LABELS}
                  descriptions={MEAL_BUDGET_DESCRIPTIONS}
                />
              </div>
            </section>
          </div>

          <div className="space-y-5">
            <section className="rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-[0_8px_24px_rgba(0,0,0,0.08)] md:p-6">
              <SectionTitle icon={<Dumbbell className="h-4 w-4" />} title="Tùy chọn tập luyện" helper="Fitly dùng các thông tin này để chỉ đề xuất bài tập phù hợp với nơi tập, dụng cụ và kinh nghiệm của bạn." />
              <div className="mt-5 space-y-5">
                <OptionButtonGroup
                  label="Nơi tập"
                  value={formData.workout_location}
                  options={[...TRAINING_LOCATIONS]}
                  onChange={(value) => setFormData((prev) => ({ ...prev, workout_location: value }))}
                  columns="sm:grid-cols-2"
                  optionLabels={TRAINING_LOCATION_LABELS}
                  descriptions={TRAINING_LOCATION_DESCRIPTIONS}
                />
                <EquipmentPreferenceGroup
                  value={formData.equipment_available}
                  onChange={(equipment) => {
                    setFormData((prev) => {
                      const selected = parseAvailableEquipment(prev.equipment_available);
                      if (equipment === 'none') {
                        return { ...prev, equipment_available: 'none' };
                      }

                      selected.delete('none');
                      if (selected.has(equipment)) selected.delete(equipment);
                      else selected.add(equipment);

                      return {
                        ...prev,
                        equipment_available: serializeAvailableEquipment(selected),
                      };
                    });
                  }}
                />
                <OptionButtonGroup
                  label="Kinh nghiệm tập luyện"
                  value={formData.experience_level}
                  options={EXPERIENCE_LEVEL_OPTIONS.map((option) => option.value)}
                  onChange={(value) => setFormData((prev) => ({ ...prev, experience_level: value }))}
                  columns="sm:grid-cols-2 xl:grid-cols-3"
                  optionLabels={EXPERIENCE_LEVEL_LABELS}
                  descriptions={EXPERIENCE_LEVEL_DESCRIPTIONS}
                />
              </div>
            </section>
          </div>
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
                onClick={openDeleteAccountDialog}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-danger transition-colors hover:bg-danger/10"
              >
                <Trash2 className="h-4 w-4" />
                Xóa tài khoản và dữ liệu
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

      <section className="rounded-2xl border border-accent/20 bg-gradient-to-br from-accent/10 via-bg-secondary to-bg-secondary p-4 shadow-[0_8px_24px_rgba(0,0,0,0.08)] md:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-bg-primary">
            <Activity className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-black text-text-primary">Nhắc nhở trên điện thoại</h2>
            <p className="mt-1 text-sm font-semibold leading-6 text-text-secondary">
              Tải ứng dụng Fitly để nhận nhắc uống nước, giấc ngủ, buổi tập và thực đơn ngay trên thiết bị của bạn.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {['Uống nước', 'Giấc ngủ', 'Buổi tập', 'Thực đơn'].map((label) => (
            <span key={label} className="rounded-full bg-bg-primary/70 px-3 py-1.5 text-xs font-black text-text-primary ring-1 ring-border-primary">
              {label}
            </span>
          ))}
        </div>
        <p className="mt-4 text-xs font-bold text-accent">Thông báo chỉ khả dụng trên ứng dụng Fitly dành cho điện thoại.</p>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-3 rounded-2xl border border-border-primary bg-bg-secondary px-4 py-4 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-400/15 text-orange-400 border border-orange-400/20">
            <Flame className="h-5 w-5" />
          </span>
          <div>
            <p className="text-2xl font-black text-text-primary leading-none">{streakCount ?? '—'}</p>
            <p className="mt-1 text-xs font-semibold text-text-secondary">Chuỗi duy trì · ngày</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-border-primary bg-bg-secondary px-4 py-4 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent border border-accent/20">
            <CalendarDays className="h-5 w-5" />
          </span>
          <div>
            <p className="text-2xl font-black text-text-primary leading-none">{totalActiveDays ?? '—'}</p>
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

        {challengesLoading ? (
          <p role="status" className="py-4 text-xs text-text-secondary">Đang tải thành tựu…</p>
        ) : challengesError ? (
          <p className="py-4 text-xs text-text-secondary">Chưa tải được thành tựu. Bạn có thể xem lại trong mục Thử thách.</p>
        ) : completedChallenges.length === 0 ? (
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
      {user?.id && <AiPlanCard userId={user.id} profile={profile} membership={membership} refreshTick={refreshTick} />}

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
                {membershipTier === 'pro'
                  ? 0
                  : membershipTier === 'plus'
                  ? Math.max(0, 20 - referralCount)
                  : referralCount < 5
                  ? 5 - referralCount
                  : Math.max(0, 20 - referralCount)}
              </p>
              <p className="mt-0.5 text-[11px] font-semibold text-text-secondary">
                {membershipTier === 'pro'
                  ? 'Đã đạt PRO 🎉'
                  : membershipTier === 'plus'
                  ? (referralCount < 20 ? 'Còn đến PRO' : 'Đã đạt PRO 🎉')
                  : (referralCount < 5 ? 'Còn đến PLUS' : referralCount < 20 ? 'Còn đến PRO' : 'Đã đạt PRO 🎉')}
              </p>
            </div>
          </div>

          {/* Progress bars */}
          {membershipTier === 'pro' ? (
            <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-center">
              <p className="text-xs font-black text-amber-400">🎉 Bạn đang ở gói PRO — gói cao nhất!</p>
            </div>
          ) : (
            <div className="mt-3 space-y-2.5">
              {membershipTier === 'free' && (
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
              )}

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

      {isDeleteAccountOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            className="w-full max-w-md rounded-2xl border border-danger/30 bg-bg-secondary p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="delete-account-title" className="text-lg font-black text-danger">
                  Xóa vĩnh viễn tài khoản?
                </h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-text-secondary">
                  Hồ sơ, dữ liệu sức khỏe, lịch tập, thực đơn, hội thoại AI và ảnh đại diện sẽ bị xóa. Thao tác này không thể hoàn tác.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDeleteAccountOpen(false)}
                disabled={isDeletingAccount}
                className="rounded-lg p-2 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-50"
                aria-label="Đóng"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mt-5 block">
              <span className="text-xs font-black uppercase text-text-tertiary">Mật khẩu hiện tại</span>
              <input
                type="password"
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
                autoComplete="current-password"
                className="mt-2 h-11 w-full rounded-xl border border-border-primary bg-bg-tertiary px-3 text-sm font-semibold text-text-primary outline-none focus:border-danger"
              />
            </label>

            <label className="mt-4 block">
              <span className="text-xs font-black uppercase text-text-tertiary">
                Nhập XÓA để xác nhận
              </span>
              <input
                type="text"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                autoComplete="off"
                className="mt-2 h-11 w-full rounded-xl border border-border-primary bg-bg-tertiary px-3 text-sm font-semibold text-text-primary outline-none focus:border-danger"
              />
            </label>

            {deleteAccountError ? (
              <p className="mt-3 text-sm font-semibold text-danger">{deleteAccountError}</p>
            ) : null}

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setIsDeleteAccountOpen(false)}
                disabled={isDeletingAccount}
                className="h-11 flex-1 rounded-xl border border-border-primary bg-bg-tertiary text-sm font-black text-text-secondary disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteAccount()}
                disabled={isDeletingAccount}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-danger text-sm font-black text-white disabled:opacity-60"
              >
                {isDeletingAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {isDeletingAccount ? 'Đang xóa...' : 'Xóa vĩnh viễn'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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

function EquipmentPreferenceGroup({
  value,
  onChange,
}: {
  value: string;
  onChange: (equipment: Equipment) => void;
}) {
  const selectedEquipment = parseAvailableEquipment(value);
  const hasAdditionalEquipment = EQUIPMENT_TYPES.some(
    (equipment) => equipment !== 'none' && selectedEquipment.has(equipment),
  );

  return (
    <div>
      <span className="text-[10px] font-black uppercase text-text-tertiary">Dụng cụ có sẵn</span>
      <p className="mt-1 text-xs font-semibold leading-5 text-text-secondary">
        Chọn tất cả dụng cụ bạn có thể dùng. Bài bodyweight luôn được giữ trong lựa chọn phù hợp.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {EQUIPMENT_TYPES.map((equipment) => {
          const selected = equipment === 'none'
            ? !hasAdditionalEquipment
            : selectedEquipment.has(equipment);
          return (
            <button
              key={equipment}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(equipment)}
              className={`min-h-11 rounded-xl border px-3 py-2 text-left text-sm font-black transition-colors ${
                selected
                  ? 'border-accent/40 bg-accent/15 text-accent'
                  : 'border-border-primary bg-bg-tertiary text-text-secondary hover:text-text-primary'
              }`}
            >
              {EQUIPMENT_LABELS[equipment]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MultiOptionButtonGroup({
  label,
  values,
  options,
  optionLabels,
  onChange,
}: {
  label: string;
  values: string[];
  options: string[];
  optionLabels: Record<string, string>;
  onChange: (values: string[]) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-text-primary">{label}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const selected = values.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(selected ? values.filter((item) => item !== option) : [...values, option])}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${selected ? 'border-accent bg-accent/15 text-accent' : 'border-border-primary bg-bg-tertiary text-text-secondary hover:border-accent/50'}`}
            >
              {optionLabels[option] || option}
            </button>
          );
        })}
      </div>
    </div>
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
  optionLabels,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  columns?: string;
  icons?: Record<string, ReactNode>;
  descriptions?: Record<string, string>;
  optionLabels?: Record<string, string>;
}) {
  return (
    <div>
      <span className="text-[10px] font-black uppercase text-text-tertiary">{label}</span>
      <div className={`mt-1.5 grid gap-2 ${columns}`}>
        {options.map((option) => {
          const selected = value === option;
          const icon = icons?.[option];
          const description = descriptions?.[option];
          const optionLabel = optionLabels?.[option] || option;
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
                  <span className={`block text-sm font-black leading-tight ${selected ? 'text-accent' : 'text-text-primary'}`}>{optionLabel}</span>
                  <span className="mt-1.5 block text-xs font-semibold leading-5 text-text-tertiary">{description}</span>
                </span>
              ) : (
                optionLabel
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
