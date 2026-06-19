import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  AlertCircle,
  BadgeCheck,
  BriefcaseBusiness,
  CalendarDays,
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

export default function Profile() {
  const { user, profile, membershipTier, refreshProfile } = useAuth();
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
  const membershipLabel = membershipTier === 'premium' ? 'Premium' : 'Free';
  const bmiLabel = bmi ? bmi.toFixed(1) : 'Chưa có';
  const bmiStatus = getBmiStatus(bmi);
  const lastUpdateLabel = latestBodyCreatedAt ? formatDate(latestBodyCreatedAt) : 'Chưa có mốc';

  return (
    <form onSubmit={handleSave} className="dashboard-page-shell flex flex-col gap-4 pb-4 md:gap-5 md:pb-6 lg:pb-7">
      <section className="overflow-hidden rounded-xl border border-border-primary bg-bg-secondary shadow-[0_22px_70px_rgba(0,0,0,0.16)]">
        <div className="border-b border-border-primary bg-bg-tertiary/45 px-5 py-5 md:px-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-accent text-3xl font-black text-text-inverse shadow-[0_16px_38px_rgba(0,0,0,0.18)]">
                {initial}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-black text-text-primary md:text-3xl">{rawName}</h1>
                  <span className="inline-flex h-7 items-center rounded-full border border-accent/20 bg-accent/10 px-3 text-xs font-black text-accent">
                    {membershipLabel}
                  </span>
                </div>
                <p className="mt-1 text-sm font-semibold text-text-secondary">{formatValue(formData.email)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <ProfilePill icon={<BadgeCheck className="h-3.5 w-3.5" />} label={`Hồ sơ ${completion}%`} tone="accent" />
                  <ProfilePill icon={<CalendarDays className="h-3.5 w-3.5" />} label={`Cập nhật ${lastUpdateLabel}`} tone="neutral" />
                </div>
              </div>
            </div>

            <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
              {isEditing ? (
                <>
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={saving}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border-primary bg-bg-secondary px-5 text-sm font-black text-text-secondary transition-colors hover:text-text-primary disabled:opacity-60"
                  >
                    <X className="h-4 w-4" />
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-60"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Lưu thay đổi
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover"
                >
                  <PencilLine className="h-4 w-4" />
                  Chỉnh sửa thông tin
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-0 md:grid-cols-4">
          <ProfileStat icon={<Scale className="h-4 w-4" />} label="Cân nặng" value={formatMetric(formData.weight, 'kg')} tone="accent" />
          <ProfileStat icon={<Ruler className="h-4 w-4" />} label="Chiều cao" value={formatMetric(formData.height, 'cm')} tone="info" />
          <ProfileStat icon={<Activity className="h-4 w-4" />} label="BMI" value={bmiLabel} helper={bmiStatus} tone="warning" />
          <ProfileStat icon={<HeartPulse className="h-4 w-4" />} label="Sức khỏe" value={formatValue(formData.health_condition || formData.injuries, 'Không có lưu ý')} tone="danger" />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.72fr)]">
        <section className="rounded-xl border border-border-primary bg-bg-secondary p-5 shadow-[0_18px_50px_rgba(0,0,0,0.10)] md:p-6">
          <SectionTitle
            icon={<User className="h-4 w-4" />}
            title="Thông Tin Cơ Bản"
            helper="Dữ liệu nhận diện và liên hệ của tài khoản."
          />
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <ProfileField label="Họ và tên" name="full_name" value={formData.full_name} onChange={handleChange} editing={isEditing} icon={<User className="h-4 w-4" />} />
            <ProfileField label="Email" name="email" value={formData.email} onChange={handleChange} editing={false} icon={<Mail className="h-4 w-4" />} />
            <ProfileField label="Số điện thoại" name="phone" value={formData.phone} onChange={handleChange} editing={isEditing} icon={<Phone className="h-4 w-4" />} />
            <ProfileSelect label="Giới tính" name="gender" value={formData.gender} onChange={handleChange} editing={isEditing} options={['Nam', 'Nữ', 'Khác']} />
            <ProfileField label="Ngày sinh" name="birthday" value={formData.birthday} onChange={handleChange} editing={isEditing} type="date" viewValue={formatDate(formData.birthday)} icon={<CalendarDays className="h-4 w-4" />} />
            <ProfileField label="Nghề nghiệp" name="job" value={formData.job} onChange={handleChange} editing={isEditing} icon={<BriefcaseBusiness className="h-4 w-4" />} />
          </div>
        </section>

        <aside className="rounded-xl border border-border-primary bg-bg-secondary p-5 shadow-[0_18px_50px_rgba(0,0,0,0.10)] md:p-6">
          <SectionTitle
            icon={<ShieldCheck className="h-4 w-4" />}
            title="Trạng Thái"
            helper="Tổng quan nhanh về hồ sơ nền."
          />
          <div className="mt-5 space-y-3">
            <StatusRow label="Gói tài khoản" value={membershipLabel} tone="accent" />
            <StatusRow label="Mức hoàn thiện" value={`${completion}%`} tone="info" />
            <StatusRow label="BMI" value={`${bmiLabel}${bmi ? ` · ${bmiStatus}` : ''}`} tone="warning" />
            <StatusRow label="Cập nhật cơ thể" value={lastUpdateLabel} tone="neutral" />
          </div>
          <div className="mt-5 rounded-xl border border-border-primary bg-bg-tertiary/45 px-4 py-3">
            <p className="text-xs font-black uppercase text-text-tertiary">Ghi chú</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-text-secondary">
              Trang này chỉ quản lý thông tin cá nhân nền. Dữ liệu bổ sung cho AI Coach sẽ xuất hiện qua lời nhắc riêng khi cần.
            </p>
          </div>
        </aside>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border-primary bg-bg-secondary p-5 shadow-[0_18px_50px_rgba(0,0,0,0.10)] md:p-6">
          <SectionTitle
            icon={<Ruler className="h-4 w-4" />}
            title="Chỉ Số Cơ Thể"
            helper="Mỗi lần lưu sẽ tạo một mốc cơ thể mới để theo dõi tiến độ."
          />
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <ProfileField label="Chiều cao" name="height" value={formData.height} onChange={handleChange} editing={isEditing} type="number" suffix="cm" viewValue={formatMetric(formData.height, 'cm')} icon={<Ruler className="h-4 w-4" />} />
            <ProfileField label="Cân nặng hiện tại" name="weight" value={formData.weight} onChange={handleChange} editing={isEditing} type="number" suffix="kg" viewValue={formatMetric(formData.weight, 'kg')} icon={<Scale className="h-4 w-4" />} />
            <ProfileField label="Cân nặng mục tiêu" name="target_weight" value={formData.target_weight} onChange={handleChange} editing={isEditing} type="number" suffix="kg" viewValue={formatMetric(formData.target_weight, 'kg')} icon={<BadgeCheck className="h-4 w-4" />} />
            <ProfileField label="Body fat" name="body_fat" value={formData.body_fat} onChange={handleChange} editing={isEditing} type="number" suffix="%" viewValue={formatMetric(formData.body_fat, '%')} icon={<Activity className="h-4 w-4" />} />
          </div>
        </section>

        <section className="rounded-xl border border-border-primary bg-bg-secondary p-5 shadow-[0_18px_50px_rgba(0,0,0,0.10)] md:p-6">
          <SectionTitle
            icon={<HeartPulse className="h-4 w-4" />}
            title="Sức Khỏe Cơ Bản"
            helper="Các lưu ý an toàn nền, không thay thế tư vấn y tế."
          />
          <div className="mt-5 grid gap-4">
            <ProfileTextArea label="Bệnh nền / lưu ý sức khỏe" name="health_condition" value={formData.health_condition} onChange={handleChange} editing={isEditing} />
            <ProfileTextArea label="Chấn thương" name="injuries" value={formData.injuries} onChange={handleChange} editing={isEditing} />
            <ProfileTextArea label="Dị ứng / thực phẩm cần tránh" name="allergies" value={formData.allergies} onChange={handleChange} editing={isEditing} />
            <ProfileField label="Thuốc đang dùng" name="medications" value={formData.medications} onChange={handleChange} editing={isEditing} icon={<ShieldCheck className="h-4 w-4" />} />
          </div>
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-warning/20 bg-warning/10 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="text-sm font-semibold leading-6 text-text-secondary">
              Nếu bạn có bệnh nền nặng, đau bất thường hoặc đang dùng thuốc đặc trị, hãy tham khảo chuyên gia y tế trước khi tập cường độ cao.
            </p>
          </div>
        </section>
      </div>
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

function ProfilePill({ icon, label, tone }: { icon: ReactNode; label: string; tone: 'accent' | 'neutral' }) {
  const classes = tone === 'accent'
    ? 'border-accent/20 bg-accent/10 text-accent'
    : 'border-border-primary bg-bg-secondary text-text-secondary';

  return (
    <span className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-black ${classes}`}>
      {icon}
      {label}
    </span>
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
          <input
            name={name}
            type={type}
            value={value}
            onChange={onChange}
            step={type === 'number' ? '0.1' : undefined}
            className="h-11 w-full rounded-xl border border-border-primary bg-bg-tertiary px-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-accent"
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
}: {
  label: string;
  name: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  editing: boolean;
  options: string[];
}) {
  if (!editing) {
    return (
      <div>
        <span className="text-[10px] font-black uppercase text-text-tertiary">{label}</span>
        <div className="mt-1.5 flex min-h-11 items-center rounded-xl border border-border-primary bg-bg-tertiary/45 px-3 py-2.5">
          <p className="truncate text-sm font-black text-text-primary">{formatValue(value)}</p>
        </div>
      </div>
    );
  }

  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase text-text-tertiary">{label}</span>
      <select
        name={name}
        value={value}
        onChange={onChange}
        className="mt-1.5 h-11 w-full rounded-xl border border-border-primary bg-bg-tertiary px-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-accent"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProfileTextArea({
  label,
  name,
  value,
  onChange,
  editing,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  editing: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase text-text-tertiary">{label}</span>
      {editing ? (
        <textarea
          name={name}
          value={value}
          onChange={onChange}
          rows={3}
          className="mt-1.5 w-full resize-none rounded-xl border border-border-primary bg-bg-tertiary px-3 py-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-accent"
        />
      ) : (
        <p className="mt-1.5 min-h-[4.75rem] whitespace-pre-line rounded-xl border border-border-primary bg-bg-tertiary/45 px-3 py-3 text-sm font-semibold leading-6 text-text-primary">
          {formatValue(value)}
        </p>
      )}
    </label>
  );
}

function StatusRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'accent' | 'info' | 'warning' | 'neutral';
}) {
  const marker = {
    accent: 'bg-accent',
    info: 'bg-info',
    warning: 'bg-warning',
    neutral: 'bg-text-tertiary',
  }[tone];

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border-primary bg-bg-tertiary/45 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${marker}`} />
        <p className="text-sm font-semibold text-text-secondary">{label}</p>
      </div>
      <p className="min-w-0 truncate text-right text-sm font-black text-text-primary">{value}</p>
    </div>
  );
}
