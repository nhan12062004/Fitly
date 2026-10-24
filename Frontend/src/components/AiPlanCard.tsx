import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AlertCircle, ArrowRight, CalendarDays, Check, Dumbbell, Loader2, LockKeyhole, MessageCircle, RefreshCw, Sparkles, Utensils, Zap } from 'lucide-react';
import type { AiQuotaKey, AiQuotaResponse } from '../../../shared/aiQuota';
import { fetchWithAuth } from '../lib/Api';
import { formatAiDate, getDisplayedMembership, getQuotaPeriod, parseAiQuotaResponse } from '../lib/aiQuota';
import type { MembershipState } from '../../../shared/membership';

const quotaItems = [
  { key: 'chatMessages', label: 'Tin nhắn AI Coach', unit: 'tin nhắn', description: 'Hỏi đáp về tập luyện và dinh dưỡng.', icon: MessageCircle, color: 'text-ai', fill: 'bg-ai' },
  { key: 'planGenerations', label: 'Tạo kế hoạch', unit: 'lượt', description: 'Tạo lại kế hoạch tập luyện và thực đơn.', icon: CalendarDays, color: 'text-info', fill: 'bg-info' },
  { key: 'workoutAdjustments', label: 'Đổi bài tập', unit: 'lượt', description: 'Điều chỉnh bài tập trong kế hoạch.', icon: Dumbbell, color: 'text-accent', fill: 'bg-accent' },
  { key: 'mealAdjustments', label: 'Đổi thực đơn', unit: 'lượt', description: 'Điều chỉnh bữa ăn trong thực đơn.', icon: Utensils, color: 'text-warning', fill: 'bg-warning' },
] satisfies Array<{ key: AiQuotaKey; label: string; unit: string; description: string; icon: typeof Zap; color: string; fill: string }>;

type ProfileMembership = { membership_tier?: string; membership_expires_at?: string | null };

export default function AiPlanCard({ userId, profile, membership, refreshTick = 0 }: {
  userId: string;
  profile: ProfileMembership | null;
  membership?: MembershipState;
  refreshTick?: number;
}) {
  const [resource, setResource] = useState<{ userId: string; data: AiQuotaResponse | null; error: string; loading: boolean } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const lastFetchAt = useRef(0);
  const current = resource?.userId === userId ? resource : null;
  const data = current?.data;
  const loading = current?.loading ?? true;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setResource({ userId, data: null, error: '', loading: true });
    const load = async () => {
      try {
        const response = await fetchWithAuth('/api/ai/quota', { signal: controller.signal });
        if (!response.ok) throw new Error('Chưa tải được quyền lợi AI. Vui lòng thử lại.');
        const nextData = parseAiQuotaResponse(await response.json());
        if (!cancelled) setResource({ userId, data: nextData, error: '', loading: false });
      } catch (error) {
        if (!cancelled) setResource({ userId, data: null, error: error instanceof Error ? error.message : 'Chưa tải được quyền lợi AI. Vui lòng thử lại.', loading: false });
      } finally {
        if (!cancelled) lastFetchAt.current = Date.now();
      }
    };
    void load();
    return () => { cancelled = true; controller.abort(); };
  }, [userId, refreshTick, reloadKey, membership?.tier, membership?.expiresAt]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetchAt.current >= 30_000) {
        lastFetchAt.current = Date.now();
        setReloadKey((key) => key + 1);
      }
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);

  const effective = getDisplayedMembership(data, profile, membership);
  const isPaid = effective.tier !== 'free';
  const validExpiry = formatAiDate(effective.expiresAt);
  const expired = effective.expired;
  const quotasMatch = data?.membershipTier === effective.tier;
  const number = (count: number) => count.toLocaleString('vi-VN');

  return (
    <section aria-labelledby="ai-plan-title" aria-busy={loading} className="min-w-0 overflow-hidden rounded-2xl border border-border-primary bg-bg-secondary shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
      <div className="p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent"><Zap className="h-5 w-5" aria-hidden="true" /></span>
            <div><h2 id="ai-plan-title" className="text-base font-black text-text-primary">Gói AI</h2><p className="mt-0.5 text-[11px] text-text-secondary">Quyền lợi và hạn mức sử dụng của bạn</p></div>
          </div>
          <button type="button" disabled={loading} onClick={() => setReloadKey((key) => key + 1)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border-primary px-3 text-xs text-text-secondary transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-wait disabled:opacity-60">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />{loading ? 'Đang đồng bộ' : 'Làm mới'}
          </button>
        </div>

        {loading && <div role="status" className="mt-5 flex min-h-40 items-center justify-center gap-2 text-sm text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Đang tải quyền lợi và số lượt thực tế…</div>}
        {!loading && current?.error && <div role="alert" className="mt-5 flex items-start gap-3 rounded-xl border border-warning/25 bg-warning/5 p-4 text-sm text-text-secondary"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" /><div><p>{current.error}</p><p className="mt-1 text-xs">Nhấn “Làm mới” để đồng bộ lại. Số lượt sẽ hiển thị sau khi tải thành công.</p></div></div>}

        {data && <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border-primary pt-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3 py-1.5 text-xs font-bold text-accent"><span className="h-1.5 w-1.5 rounded-full bg-current" />{effective.tier.toUpperCase()}</span>
              <span className={`text-xs ${expired || data.trialExpired ? 'text-warning' : 'text-text-secondary'}`}>{expired ? `${expired.tier === 'pro' ? 'Pro' : 'Plus'} đã hết hạn` : data.trialExpired ? 'Đã hết dùng thử' : isPaid ? 'Đang sử dụng' : 'Dùng thử 7 ngày'}</span>
            </div>
            {validExpiry && <p className="text-xs text-text-secondary">Hạn dùng đến: <span className="font-semibold text-text-primary">{validExpiry}</span></p>}
            {expired && <p className="text-xs text-text-secondary">Đã hết hạn ngày <span className="font-semibold text-warning">{formatAiDate(expired.expiresAt)}</span></p>}
          </div>
          <p className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-text-secondary"><CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{expired ? 'Gói hiện tại: Free · Plus và Pro gia hạn theo tháng.' : isPaid && validExpiry ? 'Đăng ký theo tháng · Gia hạn thành công sẽ cập nhật ngày hết hạn mới.' : quotasMatch ? getQuotaPeriod(data) : 'Gói hiện tại: Free'}</p>
          {isPaid && quotasMatch && <p className="mt-1 text-[11px] leading-5 text-text-secondary">{getQuotaPeriod(data)}</p>}
          {expired && <p role="status" className="mt-4 rounded-xl border border-warning/20 bg-warning/5 px-4 py-3 text-xs leading-6 text-text-secondary">Gói {expired.tier === 'pro' ? 'Pro' : 'Plus'} đã hết hạn ngày {formatAiDate(expired.expiresAt)}. Tài khoản hiện dùng gói Free. Quyền lợi theo tháng được mở lại sau khi gia hạn thành công.</p>}
          {!quotasMatch && <p role="alert" className="mt-4 rounded-xl border border-border-primary px-4 py-3 text-xs leading-6 text-text-secondary">Hạn mức trả về chưa khớp với gói hiện tại. Nhấn “Làm mới” để đồng bộ lại.</p>}

          {quotasMatch && <>
          {data.trialExpired && !expired && <p className="mt-4 rounded-xl border border-warning/20 bg-warning/5 px-4 py-3 text-xs leading-6 text-text-secondary">Thời gian dùng thử AI đã kết thúc. Các lượt chưa sử dụng không còn khả dụng. Bạn vẫn có thể xem kế hoạch và lịch sử đã lưu.</p>}

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {quotaItems.map(({ key, label, unit, description, icon: Icon, color, fill }) => {
              const limit = data.aiQuota.limits[key];
              const used = data.aiQuota.usage[key];
              const remaining = data.trialExpired ? 0 : Math.max(0, Math.min(limit, data.aiQuota.remaining[key]));
              const progress = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
              return <div key={key} data-quota={key} className="min-w-0 rounded-xl border border-border-primary bg-bg-tertiary/35 p-4">
                <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-xs font-semibold text-text-secondary"><Icon className={`h-4 w-4 shrink-0 ${color}`} aria-hidden="true" />{label}</h3>{remaining === 0 && <span className="shrink-0 text-[10px] text-warning">{data.trialExpired ? 'Hết hiệu lực' : 'Hết lượt'}</span>}</div>
                <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1"><span className="text-2xl font-semibold tabular-nums text-text-primary">{number(remaining)}</span><span className="text-[11px] text-text-secondary">{unit} còn lại / {number(limit)}</span></p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-quaternary" role="progressbar" aria-label={`${label} đã dùng`} aria-valuemin={0} aria-valuemax={limit || 1} aria-valuenow={Math.min(used, limit)} aria-valuetext={`Đã dùng ${number(used)} trên ${number(limit)} ${unit}`}><div className={`h-full rounded-full ${fill}`} style={{ width: `${progress}%` }} /></div>
                <p className="mt-2 text-[11px] text-text-secondary">Đã dùng {number(used)} / {number(limit)} {unit}</p><p className="mt-2 text-[10px] leading-5 text-text-secondary">{description}</p>
              </div>;
            })}
          </div>

          <div className="mt-4 flex items-start gap-3 rounded-xl border border-border-primary bg-bg-primary/35 p-4">
            <span className={`mt-0.5 ${isPaid ? 'text-accent' : 'text-text-secondary'}`}>{isPaid ? <Sparkles className="h-4 w-4" aria-hidden="true" /> : <LockKeyhole className="h-4 w-4" aria-hidden="true" />}</span>
            <div className="min-w-0 flex-1"><h3 className="text-xs font-semibold text-text-primary">{isPaid ? 'Lịch tập và thực đơn tự động mỗi 7 ngày' : 'Tự động tạo lịch mới với Plus / Pro'}</h3><p className="mt-1 text-[11px] leading-6 text-text-secondary">{isPaid ? 'Quyền lợi đi kèm gói, không trừ lượt tạo kế hoạch ở trên. Cần có kế hoạch ban đầu và đồng ý sử dụng AI.' : 'Gói Free có kế hoạch 7 ngày đầu. Plus và Pro có thêm quyền lợi tiếp tục tạo lịch theo chu kỳ 7 ngày.'}</p></div>
            {isPaid && <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-label="Có trong gói" />}
          </div>
          <p className="mt-3 text-[10px] leading-5 text-text-secondary">Mỗi tính năng có hạn mức riêng. Tin nhắn AI Coach không dùng chung số lượt với tạo hoặc điều chỉnh kế hoạch.</p>
          </>}
        </>}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border-primary pt-4">
          <Link to="/smart-planner" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-xs font-bold text-text-inverse transition-colors hover:bg-accent-hover">Mở AI Coach <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
          <Link to="/premium" className="inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-accent hover:underline">{expired ? 'Xem gói gia hạn' : isPaid ? 'Xem quyền lợi các gói' : 'Khám phá Plus và Pro'} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
        </div>
      </div>
    </section>
  );
}
