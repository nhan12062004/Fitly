import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  AlertCircle,
  BadgeCheck,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronRight,
  Crown,
  HeartPulse,
  Loader2,
  Mail,
  PencilLine,
  Phone,
  Ruler,
  Save,
  Scale,
  ShieldCheck,
  User,
  VenusAndMars,
  X,
} from 'lucide-react';
import { supabase } from '../lib/Supabase';
import { useAuth } from '../contexts/AuthContext';
import { SkeletonBlock } from '../components/PageSkeleton';
import { useToast } from '../components/ToastProvider';

const emptyForm = {
  full_name: '',
  email: '',
  phone: '',
  gender: 'Nam',
  birthday: '',
  job: '',
  height: '',
  weight: '',
  target_weight: '',
  body_fat: '',
  health_condition: '',
  injuries: '',
  allergies: '',
  medications: 'Không sử dụng thuốc',
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

const getBmiStatus = (bmi: number | null) => {
  if (!bmi) return 'Chưa đủ dữ liệu';
  if (bmi < 18.5) return 'Thiếu cân';
  if (bmi < 23) return 'Cân đối';
  if (bmi < 25) return 'Cần theo dõi';
  return 'Cao';
};

const membershipLabels = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
};

const membershipCopy = {
  free: 'Gói Free có 4 lượt đổi AI để bạn bắt đầu tinh chỉnh kế hoạch.',
  plus: 'Gói Plus có 8 lượt đổi AI cho các lần chỉnh kế hoạch thường xuyên hơn.',
  pro: 'Gói Pro mở khóa lượt đổi AI không giới hạn cho workout, meal plan và đề xuất trong AI Coach.',
};

const membershipBenefits = {
  free: ['4 lượt đổi AI', 'Trải nghiệm tính năng cốt lõi', 'Có thể nâng cấp bất cứ lúc nào'],
  plus: ['8 lượt đổi AI', 'Mọi tính năng của Free', 'Tối ưu kế hoạch theo phản hồi'],
  pro: ['AI Coach không giới hạn', 'Kế hoạch không giới hạn', 'Ưu tiên tính năng mới'],
};

export default function Profile() {
  const { user, profile, membershipTier, openPremiumModal, refreshProfile } = useAuth();
  const toast = useToast();
  const [formData, setFormData] = useState(emptyForm);
  const [latestBodyCreatedAt, setLatestBodyCreatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

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
        const [profileRes, bodyRes, healthRes] = await Promise.all([
          supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
          supabase
            .from('body_metrics')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase.from('health_conditions').select('*').eq('user_id', userId).maybeSingle(),
        ]);

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
          gender: p.gender || 'Nam',
          birthday: p.birthday || '',
          job: p.job || '',
          height: toInput(b.height),
          weight: toInput(b.weight),
          target_weight: toInput(b.target_weight),
          body_fat: toInput(b.body_fat || b.body_fat_percentage),
          health_condition: h.health_condition || '',
          injuries: h.injuries || '',
          allergies: h.medical_history || '',
          medications: h.medications || 'Không sử dụng thuốc',
        });
        setLatestBodyCreatedAt(b.created_at || '');
      } catch (err: any) {
        setError(err?.message || 'Không thể tải thông tin cá nhân.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, user?.id]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error, toast]);

  const bmi = useMemo(() => {
    const height = Number(formData.height);
    const weight = Number(formData.weight);
    if (!Number.isFinite(height) || !Number.isFinite(weight) || height <= 0 || weight <= 0) return null;
    return weight / ((height / 100) ** 2);
  }, [formData.height, formData.weight]);

  const completion = useMemo(() => {
    const checks = [
      formData.full_name,
      formData.email,
      formData.phone,
      formData.gender,
      formData.birthday,
      formData.height,
      formData.weight,
      formData.health_condition || formData.injuries,
    ];
    const done = checks.filter((item) => String(item || '').trim()).length;
    return Math.round((done / checks.length) * 100);
  }, [formData]);

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleCancel = () => {
    setIsEditing(false);
    setReloadKey((value) => value + 1);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!user?.id) return;

    setSaving(true);
    setError('');
    try {
      const [profileRes, bodyRes, healthRes] = await Promise.all([
        supabase.from('profiles').upsert({
          id: user.id,
          full_name: formData.full_name.trim(),
          email: formData.email || user.email,
          phone: formData.phone.trim(),
          gender: formData.gender,
          birthday: formData.birthday || null,
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
      ]);

      const firstError = [profileRes.error, bodyRes.error, healthRes.error].find(Boolean);
      if (firstError) throw firstError;

      await refreshProfile();
      setLatestBodyCreatedAt(new Date().toISOString());
      setIsEditing(false);
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
  const bmiLabel = bmi ? bmi.toFixed(1) : 'Chưa có';
  const bmiStatus = getBmiStatus(bmi);
  const lastUpdateLabel = latestBodyCreatedAt ? formatDate(latestBodyCreatedAt) : 'Chưa có mốc';

  return (
    <form onSubmit={handleSave} className="dashboard-page-shell pb-5 md:pb-7">
      <header className="mb-5 flex flex-col gap-5 rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-[0_20px_60px_rgba(0,0,0,0.12)] sm:flex-row sm:items-center sm:justify-between md:p-7">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-accent text-2xl font-black text-text-inverse shadow-[0_12px_30px_rgba(0,0,0,0.18)] md:h-20 md:w-20 md:text-3xl">
            {initial}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-accent">Hồ sơ cá nhân</p>
            <h1 className="mt-1 truncate text-2xl font-black text-text-primary md:text-3xl">{rawName}</h1>
            <p className="mt-1 truncate text-sm font-semibold text-text-secondary">{formatValue(formData.email)}</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
          {isEditing ? (
            <>
              <button type="button" onClick={handleCancel} disabled={saving} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border-primary bg-bg-tertiary px-5 text-sm font-black text-text-secondary transition-colors hover:text-text-primary disabled:opacity-60">
                <X className="h-4 w-4" />
                Hủy
              </button>
              <button type="submit" disabled={saving} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Lưu thay đổi
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setIsEditing(true)} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover">
              <PencilLine className="h-4 w-4" />
              Chỉnh sửa hồ sơ
            </button>
          )}
        </div>
      </header>

      <section className="mb-5 overflow-hidden rounded-2xl border border-border-primary bg-bg-secondary shadow-[0_16px_45px_rgba(0,0,0,0.08)]">
        <div className="grid md:grid-cols-4">
          <div className="border-b border-border-primary px-5 py-4 md:border-b-0 md:border-r">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Hoàn thiện hồ sơ</p>
                <p className="mt-1 text-xl font-black text-text-primary">{completion}%</p>
              </div>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/15 bg-accent/10 text-accent">
                <BadgeCheck className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg-tertiary">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${completion}%` }} />
            </div>
            <p className="mt-2 truncate text-[11px] font-semibold text-text-secondary">Cập nhật {lastUpdateLabel}</p>
          </div>
          <ProfileStat icon={<Scale className="h-4 w-4" />} label="Cân nặng" value={formatMetric(formData.weight, 'kg')} tone="accent" />
          <ProfileStat icon={<Ruler className="h-4 w-4" />} label="Chiều cao" value={formatMetric(formData.height, 'cm')} tone="info" />
          <ProfileStat icon={<Activity className="h-4 w-4" />} label="BMI" value={bmiLabel} helper={bmiStatus} tone="warning" />
        </div>
      </section>

      <main className="min-w-0 space-y-5">
          <section id="thong-tin-ca-nhan" className="scroll-mt-5 rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-[0_16px_45px_rgba(0,0,0,0.08)] md:p-6">
            <SectionTitle icon={<User className="h-4 w-4" />} title="Thông tin cá nhân" helper="Thông tin nhận diện và liên hệ cơ bản của bạn." />
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <ProfileField label="Họ và tên" name="full_name" value={formData.full_name} onChange={handleChange} editing={isEditing} icon={<User className="h-4 w-4" />} />
              <ProfileField label="Email" name="email" value={formData.email} onChange={handleChange} editing={false} icon={<Mail className="h-4 w-4" />} />
              <ProfileField label="Số điện thoại" name="phone" value={formData.phone} onChange={handleChange} editing={isEditing} icon={<Phone className="h-4 w-4" />} />
              <ProfileSelect label="Giới tính" name="gender" value={formData.gender} onChange={handleChange} editing={isEditing} options={['Nam', 'Nữ', 'Khác']} icon={<VenusAndMars className="h-4 w-4" />} />
              <ProfileField label="Ngày sinh" name="birthday" value={formData.birthday} onChange={handleChange} editing={isEditing} type="date" viewValue={formatDate(formData.birthday)} icon={<CalendarDays className="h-4 w-4" />} />
              <ProfileField label="Nghề nghiệp" name="job" value={formData.job} onChange={handleChange} editing={isEditing} icon={<BriefcaseBusiness className="h-4 w-4" />} />
            </div>
          </section>

          <div className="grid items-start gap-5 lg:grid-cols-2">
            <section id="chi-so-co-the" className="scroll-mt-5 rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-[0_16px_45px_rgba(0,0,0,0.08)] md:p-6">
              <SectionTitle icon={<Ruler className="h-4 w-4" />} title="Chỉ số cơ thể" helper="Mỗi lần lưu sẽ tạo một mốc mới để theo dõi tiến độ." />
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <ProfileField label="Chiều cao" name="height" value={formData.height} onChange={handleChange} editing={isEditing} type="number" suffix="cm" viewValue={formatMetric(formData.height, 'cm')} icon={<Ruler className="h-4 w-4" />} />
                <ProfileField label="Cân nặng hiện tại" name="weight" value={formData.weight} onChange={handleChange} editing={isEditing} type="number" suffix="kg" viewValue={formatMetric(formData.weight, 'kg')} icon={<Scale className="h-4 w-4" />} />
                <ProfileField label="Cân nặng mục tiêu" name="target_weight" value={formData.target_weight} onChange={handleChange} editing={isEditing} type="number" suffix="kg" viewValue={formatMetric(formData.target_weight, 'kg')} icon={<BadgeCheck className="h-4 w-4" />} />
                <ProfileField label="Body fat" name="body_fat" value={formData.body_fat} onChange={handleChange} editing={isEditing} type="number" suffix="%" viewValue={formatMetric(formData.body_fat, '%')} icon={<Activity className="h-4 w-4" />} />
              </div>
            </section>

            <section id="suc-khoe" className="scroll-mt-5 rounded-2xl border border-border-primary bg-bg-secondary p-5 shadow-[0_16px_45px_rgba(0,0,0,0.08)] md:p-6">
              <SectionTitle icon={<HeartPulse className="h-4 w-4" />} title="Sức khỏe cơ bản" helper="Các lưu ý giúp Fitly cá nhân hóa kế hoạch an toàn hơn." />
              <div className="mt-5 grid gap-4">
                <ProfileTextArea label="Bệnh nền / lưu ý sức khỏe" name="health_condition" value={formData.health_condition} onChange={handleChange} editing={isEditing} icon={<HeartPulse className="h-4 w-4" />} />
                <ProfileTextArea label="Chấn thương" name="injuries" value={formData.injuries} onChange={handleChange} editing={isEditing} icon={<Activity className="h-4 w-4" />} />
                <ProfileTextArea label="Dị ứng / thực phẩm cần tránh" name="allergies" value={formData.allergies} onChange={handleChange} editing={isEditing} icon={<AlertCircle className="h-4 w-4" />} />
                <ProfileField label="Thuốc đang dùng" name="medications" value={formData.medications} onChange={handleChange} editing={isEditing} icon={<ShieldCheck className="h-4 w-4" />} />
              </div>
              <div className="mt-5 flex items-start gap-3 rounded-xl border border-warning/20 bg-warning/10 px-4 py-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p className="text-sm font-semibold leading-6 text-text-secondary">
                  Thông tin này không thay thế tư vấn y tế. Hãy hỏi chuyên gia trước khi tập cường độ cao nếu bạn có vấn đề sức khỏe đặc biệt.
                </p>
              </div>
            </section>
          </div>

          <section id="goi-tai-khoan" className="scroll-mt-5 overflow-hidden rounded-2xl border border-amber-300/25 bg-[linear-gradient(135deg,rgba(245,158,11,0.14),rgba(245,158,11,0.04)_48%,rgba(255,255,255,0.02))] shadow-[0_18px_55px_rgba(0,0,0,0.10)]">
            <div className="grid gap-6 p-5 md:p-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div>
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300">
                    <Crown className="h-5 w-5 fill-current" />
                  </span>
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-300">Gói tài khoản</p>
                    <h2 className="mt-1 text-xl font-black text-text-primary">Bạn đang dùng gói {membershipLabel}</h2>
                  </div>
                </div>
                <p className="mt-4 max-w-2xl text-sm font-semibold leading-6 text-text-secondary">
                  {membershipCopy[membershipTier]}
                </p>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
                  {membershipBenefits[membershipTier].map((benefit) => (
                    <span key={benefit} className="inline-flex items-center gap-2 text-xs font-bold text-text-secondary">
                      <Check className="h-3.5 w-3.5 text-amber-300" />
                      {benefit}
                    </span>
                  ))}
                </div>
              </div>

              {membershipTier === 'pro' ? (
                <div className="rounded-xl border border-amber-300/20 bg-amber-400/10 px-5 py-3 text-center">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-300">Đang hoạt động</p>
                  <p className="mt-1 text-sm font-black text-text-primary">Pro</p>
                </div>
              ) : (
                <button type="button" onClick={openPremiumModal} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-amber-300 px-6 text-sm font-black text-text-inverse transition-colors hover:bg-amber-200">
                  Xem gói Plus / Pro
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </section>
      </main>
    </form>
  );
}

function ProfileSkeleton() {
  return (
    <div className="dashboard-page-shell flex flex-col gap-4 pb-4 md:gap-5 md:pb-6 lg:pb-7">
      <section className="rounded-xl border border-border-primary bg-bg-secondary p-6">
        {SkeletonBlock('h-20 w-full rounded-xl')}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {SkeletonBlock('h-80 rounded-xl')}
        {SkeletonBlock('h-80 rounded-xl')}
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

function ProfileStat({
  icon,
  label,
  value,
  helper,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  helper?: string;
  tone: 'accent' | 'info' | 'warning' | 'danger';
}) {
  const toneClasses = {
    accent: 'text-accent bg-accent/10 border-accent/15',
    info: 'text-info bg-info/10 border-info/15',
    warning: 'text-warning bg-warning/10 border-warning/15',
    danger: 'text-danger bg-danger/10 border-danger/15',
  }[tone];

  return (
    <div className="min-w-0 border-b border-border-primary px-5 py-4 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${toneClasses}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase text-text-tertiary">{label}</p>
          <p className="mt-0.5 truncate text-base font-black text-text-primary">{value}</p>
          {helper ? <p className="mt-0.5 truncate text-xs font-semibold text-text-secondary">{helper}</p> : null}
        </div>
      </div>
    </div>
  );
}

function ProfileField({
  label,
  name,
  value,
  onChange,
  editing,
  icon,
  type = 'text',
  suffix,
  viewValue,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  editing: boolean;
  icon?: ReactNode;
  type?: string;
  suffix?: string;
  viewValue?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-[10px] font-black uppercase text-text-tertiary">{label}</span>
      {editing ? (
        <div className="relative mt-1.5">
          {icon ? <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-text-tertiary">{icon}</span> : null}
          <input
            name={name}
            type={type}
            value={value}
            onChange={onChange}
            step={type === 'number' ? '0.1' : undefined}
            className={`h-11 w-full rounded-xl border border-border-primary bg-bg-tertiary text-sm font-semibold text-text-primary outline-none transition-colors focus:border-accent ${icon ? 'pl-10' : 'pl-3'} ${suffix ? 'pr-10' : 'pr-3'}`}
          />
          {suffix ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black text-text-tertiary">{suffix}</span> : null}
        </div>
      ) : (
        <div className="mt-1.5 flex min-h-11 items-center gap-3 rounded-xl border border-border-primary bg-bg-tertiary/45 px-3 py-2.5">
          {icon ? <span className="shrink-0 text-text-tertiary">{icon}</span> : null}
          <p className="min-w-0 truncate text-sm font-black text-text-primary">
            {viewValue || formatValue(value)}
          </p>
        </div>
      )}
    </label>
  );
}

function ProfileSelect({
  label,
  name,
  value,
  onChange,
  editing,
  options,
  icon,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  editing: boolean;
  options: string[];
  icon?: ReactNode;
}) {
  if (!editing) {
    return (
      <div>
        <span className="text-[10px] font-black uppercase text-text-tertiary">{label}</span>
        <div className="mt-1.5 flex min-h-11 items-center gap-3 rounded-xl border border-border-primary bg-bg-tertiary/45 px-3 py-2.5">
          {icon ? <span className="shrink-0 text-text-tertiary">{icon}</span> : null}
          <p className="truncate text-sm font-black text-text-primary">{formatValue(value)}</p>
        </div>
      </div>
    );
  }

  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase text-text-tertiary">{label}</span>
      <div className="relative mt-1.5">
        {icon ? <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-text-tertiary">{icon}</span> : null}
        <select
          name={name}
          value={value}
          onChange={onChange}
          className={`h-11 w-full rounded-xl border border-border-primary bg-bg-tertiary pr-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-accent ${icon ? 'pl-10' : 'pl-3'}`}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

function ProfileTextArea({
  label,
  name,
  value,
  onChange,
  editing,
  icon,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  editing: boolean;
  icon?: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase text-text-tertiary">{label}</span>
      {editing ? (
        <div className="relative mt-1.5">
          {icon ? <span className="pointer-events-none absolute left-3 top-3.5 text-text-tertiary">{icon}</span> : null}
          <textarea
            name={name}
            value={value}
            onChange={onChange}
            rows={3}
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
