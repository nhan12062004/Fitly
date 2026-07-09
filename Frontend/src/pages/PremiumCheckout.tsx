import { ArrowRight, Check, Crown, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useAuth, type MembershipTier } from '../contexts/AuthContext';

const planCards: Array<{
  id: MembershipTier;
  name: string;
  price: string;
  accent: string;
  description: string;
  benefits: string[];
}> = [
  {
    id: 'free',
    name: 'Free',
    price: '0đ',
    accent: 'text-sky-200',
    description: 'Phù hợp để bắt đầu theo dõi tập luyện và ăn uống.',
    benefits: ['4 lượt đổi AI', 'Theo dõi tiến độ cơ bản', 'Lịch tập và thực đơn cá nhân hóa'],
  },
  {
    id: 'plus',
    name: 'Plus',
    price: '49.000đ / tháng',
    accent: 'text-accent',
    description: 'Cho người dùng AI đều đặn hơn trong quá trình tập.',
    benefits: ['8 lượt đổi AI', 'Mọi tính năng của Free', 'Tối ưu kế hoạch theo phản hồi'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '99.000đ / tháng',
    accent: 'text-amber-200',
    description: 'Dành cho người muốn đổi kế hoạch bằng AI không cần đếm lượt.',
    benefits: ['Không giới hạn lượt đổi AI', 'Tạo lại workout và meal plan tùy ý', 'Ưu tiên tính năng cá nhân hóa mới'],
  },
];

interface PremiumCheckoutProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PremiumCheckout({ isOpen, onClose }: PremiumCheckoutProps) {
  const { membershipTier, isPremium } = useAuth();
  const currentPlan = planCards.find((plan) => plan.id === membershipTier) || planCards[0];

  if (!isOpen) return null;

  return (
    <div className="responsive-sheet-backdrop fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="themed-modal-backdrop absolute inset-0 backdrop-blur-md" onClick={onClose} />
      <div className="premium-shell responsive-sheet-panel relative max-h-[92dvh] w-full max-w-[1200px] overflow-y-auto custom-scrollbar rounded-[28px] border border-border-primary p-4 shadow-[0_24px_80px_rgba(0,0,0,0.24)] md:p-6">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-xl border border-border-primary bg-bg-tertiary/60 p-2 text-text-tertiary transition-colors hover:text-text-primary"
          aria-label="Đóng"
        >
          <X className="h-5 w-5" />
        </button>

        <section className="premium-main overflow-hidden rounded-[24px] border border-amber-300/20">
          <div className="grid gap-5 p-5 lg:grid-cols-[1.15fr_0.85fr] lg:p-6">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-400/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-amber-200">
                <Crown className="h-3.5 w-3.5 fill-current" />
                Gói AI Fitly
              </div>

              <div>
                <h1 className="text-3xl font-black tracking-tight text-text-primary md:text-4xl">
                  Chọn gói đổi kế hoạch bằng AI
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
                  Fitly hiện có 3 gói: Free, Plus và Pro. Free có 4 lượt đổi AI, Plus có 8 lượt đổi AI, Pro không giới hạn.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {planCards.map((plan) => {
                  const isCurrent = plan.id === membershipTier;
                  const isPro = plan.id === 'pro';
                  return (
                    <article
                      key={plan.id}
                      className={`rounded-[22px] border p-4 ${isCurrent ? 'border-amber-300/35 bg-amber-400/10' : 'premium-card'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className={`text-xs font-black uppercase tracking-[0.18em] ${plan.accent}`}>{plan.name}</p>
                          <p className="mt-2 text-2xl font-black text-text-primary">{plan.price}</p>
                        </div>
                        {isCurrent ? (
                          <span className="rounded-full border border-amber-300/30 bg-amber-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-amber-200">
                            Hiện tại
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-3 min-h-12 text-sm font-semibold leading-6 text-text-secondary">{plan.description}</p>
                      <div className="mt-4 space-y-2">
                        {plan.benefits.map((benefit) => (
                          <p key={benefit} className="flex items-start gap-2 text-sm font-semibold text-text-secondary">
                            <Check className={`mt-0.5 h-4 w-4 shrink-0 ${isPro ? 'text-amber-200' : 'text-accent'}`} />
                            <span>{benefit}</span>
                          </p>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>

            <aside className="rounded-[24px] border border-amber-300/15 bg-[linear-gradient(180deg,rgba(251,191,36,0.12),rgba(251,191,36,0.04))] p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-200">
                  <Crown className="h-7 w-7 fill-current" />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-200">Gói hiện tại</p>
                  <p className="mt-1 text-2xl font-black text-text-primary">{currentPlan.name}</p>
                  <p className="mt-2 text-xs font-semibold text-amber-100/80">
                    {isPremium ? 'Bạn đang dùng Pro không giới hạn.' : 'Nâng cấp để có thêm lượt đổi AI.'}
                  </p>
                </div>
              </div>

              <div className="premium-inner mt-5 space-y-3 rounded-[20px] border p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
                  <ShieldCheck className="h-4 w-4 text-accent-muted" />
                  Trạng thái gói đồng bộ từ database
                </div>
                <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
                  <Sparkles className="h-4 w-4 text-amber-200" />
                  Pro mở khóa lượt đổi AI không giới hạn
                </div>
              </div>

              <button
                type="button"
                disabled={isPremium}
                className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-amber-300 px-5 text-sm font-black text-text-inverse transition-colors hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPremium ? 'Đã kích hoạt Pro' : 'Tiếp tục nâng cấp'}
                <ArrowRight className="h-4 w-4" />
              </button>

              <p className="mt-3 text-xs leading-5 text-amber-100/80">
                Khi nối thanh toán thật, cập nhật `membership_tier` trong `profiles` thành `plus` hoặc `pro`.
              </p>
            </aside>
          </div>
        </section>
      </div>
    </div>
  );
}
