import { ArrowRight, Check, Crown, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const premiumBenefits = [
  'Tạo lại Trợ lý cá nhân không giới hạn',
  'Tạo lại meal plan và workout plan không giới hạn',
  'Mở khóa các lần tinh chỉnh kế hoạch thông minh',
  'Ưu tiên các tính năng Premium trong các bản cập nhật sau',
];

interface PremiumCheckoutProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PremiumCheckout({ isOpen, onClose }: PremiumCheckoutProps) {
  const { membershipTier, isPremium } = useAuth();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="themed-modal-backdrop absolute inset-0 backdrop-blur-md" onClick={onClose} />
      <div className="premium-shell relative max-h-[92vh] w-full max-w-[1200px] overflow-y-auto custom-scrollbar rounded-[28px] border border-border-primary p-4 shadow-[0_24px_80px_rgba(0,0,0,0.24)] md:p-6">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-xl border border-border-primary bg-bg-tertiary/60 p-2 text-text-tertiary transition-colors hover:text-text-primary"
        >
          <X className="h-5 w-5" />
        </button>

        <section className="premium-main overflow-hidden rounded-[24px] border border-amber-300/20">
          <div className="grid gap-5 p-5 lg:grid-cols-[1.15fr_0.85fr] lg:p-6">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-400/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-amber-200">
                <Crown className="h-3.5 w-3.5 fill-current" />
                Nâng cấp Premium
              </div>

              <div>
                <h1 className="text-3xl font-black tracking-tight text-text-primary md:text-4xl">
                  Mở khóa Trợ lý cá nhân không giới hạn
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
                  Trạng thái gói hiện đã đồng bộ theo `membership_tier` trong `profiles`.
                  Bạn có thể nối bước này với Stripe, PayOS hoặc MoMo khi sẵn sàng triển khai thanh toán thật.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <article className={`rounded-[22px] border p-4 ${!isPremium ? 'border-sky-300/30 bg-sky-400/10' : 'premium-card'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-200">Free Plan</p>
                      <p className="mt-2 text-2xl font-black text-text-primary">0đ</p>
                    </div>
                    {!isPremium && (
                      <span className="rounded-full border border-sky-300/30 bg-sky-400/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-sky-200">
                        Gói hiện tại
                      </span>
                    )}
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-text-secondary">
                    <p>1 lần kích hoạt Trợ lý cá nhân trong 7 ngày đầu</p>
                    <p>Phù hợp để trải nghiệm sản phẩm</p>
                    <p>Không có quyền tạo lại AI Coach không giới hạn</p>
                  </div>
                </article>

                <article className={`rounded-[22px] border p-4 ${isPremium ? 'border-amber-300/30 bg-amber-400/10' : 'premium-card'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-200">Premium Plan</p>
                      <p className="mt-2 text-2xl font-black text-text-primary">299.000đ / tháng</p>
                    </div>
                    {isPremium && (
                      <span className="rounded-full border border-amber-300/30 bg-amber-400/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-amber-200">
                        Gói hiện tại
                      </span>
                    )}
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-text-secondary">
                    <p>Tạo lại Trợ lý cá nhân không giới hạn</p>
                    <p>Tạo lại meal plan và workout plan không giới hạn</p>
                    <p>Ưu tiên các tính năng cá nhân hóa nâng cao</p>
                  </div>
                </article>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {premiumBenefits.map((benefit) => (
                  <div key={benefit} className="premium-card rounded-[20px] border p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-400/12 text-amber-200">
                        <Check className="h-4 w-4" />
                      </div>
                      <p className="text-sm font-bold text-text-primary">{benefit}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <aside className="rounded-[24px] border border-amber-300/15 bg-[linear-gradient(180deg,rgba(251,191,36,0.12),rgba(251,191,36,0.04))] p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-200">
                  <Crown className="h-7 w-7 fill-current" />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-200">Premium Plan</p>
                  <p className="mt-1 text-2xl font-black text-text-primary">299.000đ / tháng</p>
                  <p className="mt-2 text-xs font-semibold text-amber-100/80">
                    Bạn đang dùng: {membershipTier === 'premium' ? 'Premium' : 'Free'}
                  </p>
                </div>
              </div>

              <div className="premium-inner mt-5 space-y-3 rounded-[20px] border p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
                  <ShieldCheck className="h-4 w-4 text-accent-muted" />
                  Trạng thái gói được đồng bộ từ database
                </div>
                <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
                  <Sparkles className="h-4 w-4 text-amber-200" />
                  Sẵn sàng nối với cổng thanh toán thật
                </div>
              </div>

              <button
                type="button"
                disabled={isPremium}
                className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-amber-300 px-5 text-sm font-black text-text-inverse transition-colors hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPremium ? 'Đã kích hoạt Premium' : 'Tiếp tục thanh toán'}
                <ArrowRight className="h-4 w-4" />
              </button>

              <p className="mt-3 text-xs leading-5 text-amber-100/80">
                Modal này hiện là giao diện premium trong app. Khi bạn nối backend thanh toán thật, chỉ cần gắn handler cho nút trên.
              </p>
            </aside>
          </div>
        </section>
      </div>
    </div>
  );
}
