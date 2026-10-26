import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ClipboardList, Sparkles, X } from 'lucide-react';
import { profileDetailsResource } from '../lib/accountReads';
import { useAuth } from '../contexts/AuthContext';

type ProfileCompletionNudgeProps = {
  onOpenProfile: () => void;
};

type ProfileCompletionData = {
  profile: Record<string, any> | null;
  body: Record<string, any> | null;
  lifestyle: Record<string, any> | null;
  health: Record<string, any> | null;
};

const isFilled = (value: unknown) => String(value ?? '').trim().length > 0;
const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export default function ProfileCompletionNudge({ onOpenProfile }: ProfileCompletionNudgeProps) {
  const { user, profile, lifestyle, refreshTick } = useAuth();
  const [data, setData] = useState<ProfileCompletionData | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const dismissKey = user?.id ? `fitly-profile-nudge-dismissed:${user.id}` : '';

  useEffect(() => {
    if (!user?.id) {
      setData(null);
      setDismissed(false);
      return;
    }

    const userId = user.id;
    const isDismissed = localStorage.getItem(dismissKey) === 'true';
    setDismissed(isDismissed);
    if (isDismissed) return;
    let cancelled = false;
    void profileDetailsResource.load(userId).then((details) => {
      if (!cancelled) setData({ profile, lifestyle, body: details.body, health: details.health });
    }).catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [dismissKey, refreshTick, user?.id, profile, lifestyle]);

  useEffect(() => {
    const handleSupplementSaved = () => {
      setDismissed(true);
    };

    window.addEventListener('fitly:profile-supplement-saved', handleSupplementSaved);
    return () => window.removeEventListener('fitly:profile-supplement-saved', handleSupplementSaved);
  }, []);

  const profileState = useMemo(() => {
    if (!data) return null;

    const currentWeight = toNumber(data.body?.weight);
    const targetWeight = toNumber(data.body?.target_weight);
    const hasBodyDetail =
      (targetWeight > 0 && Math.abs(targetWeight - currentWeight) >= 0.5) ||
      toNumber(data.body?.body_fat) > 0 ||
      toNumber(data.body?.body_fat_percentage) > 0 ||
      toNumber(data.body?.waist) > 0 ||
      toNumber(data.body?.hips) > 0;
    const hasEatingDetail =
      isFilled(data.lifestyle?.current_diet) ||
      isFilled(data.lifestyle?.cooking_ability) ||
      isFilled(data.health?.medical_history);
    const hasRecoveryDetail =
      isFilled(data.lifestyle?.workout_time) &&
      isFilled(data.health?.sleep_hours) &&
      isFilled(data.health?.stress_level);
    const hasCoachPreference = isFilled(data.lifestyle?.expectations) || isFilled(data.lifestyle?.motivation);

    const sections = [
      {
        label: 'Mục tiêu cơ thể chi tiết',
        done: hasBodyDetail,
      },
      {
        label: 'Thói quen ăn uống hiện tại',
        done: hasEatingDetail,
      },
      {
        label: 'Lịch sinh hoạt & phục hồi',
        done: hasRecoveryDetail,
      },
      {
        label: 'Ghi chú riêng cho AI Coach',
        done: hasCoachPreference,
      },
    ];

    const completed = sections.filter((section) => section.done).length;
    const missing = sections.filter((section) => !section.done);
    const percent = Math.round((completed / sections.length) * 100);

    return { missing, percent };
  }, [data]);

  if (!user?.id || dismissed || !profileState || profileState.missing.length <= 1 || profileState.percent >= 85) {
    return null;
  }

  const handleDismiss = () => {
    if (dismissKey) localStorage.setItem(dismissKey, 'true');
    setDismissed(true);
  };

  return (
    <section className="mb-4 rounded-xl border border-ai/20 bg-ai/8 px-4 py-3 text-text-primary shadow-[0_16px_42px_rgba(0,0,0,0.12)] md:px-5 md:py-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ai/12 text-ai">
            <ClipboardList className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-black text-text-primary">Bổ sung hồ sơ AI để lịch sát hơn</p>
              <span className="rounded-full border border-ai/25 bg-ai/10 px-2 py-0.5 text-[10px] font-black text-ai">
                {profileState.percent}% hoàn tất
              </span>
            </div>
            <p className="mt-1 text-sm font-semibold leading-6 text-text-secondary">
              Còn thiếu: {profileState.missing.slice(0, 3).map((item) => item.label).join(', ')}.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenProfile}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-ai px-4 text-sm font-black text-white transition-colors hover:bg-ai-hover"
          >
            <Sparkles className="h-4 w-4" />
            Bổ sung ngay
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border-primary bg-bg-secondary text-text-tertiary transition-colors hover:text-text-primary"
            aria-label="Ẩn nhắc bổ sung hồ sơ"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
