import {
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth, type MembershipTier } from '../contexts/AuthContext';

const tierRank: Record<MembershipTier, number> = {
  free: 0,
  plus: 1,
  pro: 2,
};

const planCards: Array<{
  id: MembershipTier;
  name: string;
  price: string;
  oldPrice?: string;
  period: string;
  renewText?: string;
  promo?: string;
  description: string;
  featureIntro?: string;
  benefits: string[];
}> = [
  {
    id: 'free',
    name: 'Free',
    price: '0',
    period: 'VND / tháng',
    description: 'Dùng thử lịch tập, thực đơn và AI Coach trong 7 ngày.',
    benefits: [
      'Lịch tập và thực đơn 7 ngày đầu',
      'Có giới hạn lượt tạo lại bài tập',
      'Có giới hạn lượt tạo lại thực đơn',
      'AI Coach giới hạn 25 tin nhắn',
    ],
  },
  {
    id: 'plus',
    name: 'Plus',
    price: '55.000',
    oldPrice: '79.000',
    period: 'VND / tháng đầu',
    renewText: 'Sau đó 79.000đ / tháng',
    promo: 'Giảm 30% lần mua đầu',
    description: 'Fitly tự chuẩn bị lịch mới mỗi tuần, bạn chỉ cần làm theo.',
    benefits: [
      'Tự động tạo lịch 7 ngày mỗi tuần',
      'Tạo lịch thêm khi đổi mục tiêu hoặc lịch sinh hoạt',
      'Đổi bài tập và thực đơn nhiều hơn',
      'AI Coach đủ dùng để theo sát hằng ngày',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '104.000',
    oldPrice: '149.000',
    period: 'VND / tháng đầu',
    renewText: 'Sau đó 149.000đ / tháng',
    promo: 'Giảm 30% lần mua đầu',
    description: 'Dành cho người tập nghiêm túc, cần AI Coach theo sát hơn.',
    featureIntro: 'Mọi tính năng trong Plus, và:',
    benefits: [
      'Giới hạn sử dụng cao hơn nhiều so với Plus',
      'Tạo lịch thêm linh hoạt hơn mỗi tháng',
      'Tạo lại bài tập và thực đơn thoải mái hơn',
      'AI Coach theo sát hơn với 800 tin nhắn/tháng',
      'Phù hợp người tập nghiêm túc hoặc đổi lịch thường xuyên',
    ],
  },
];

export default function PremiumCheckout() {
  const { membershipTier } = useAuth();
  const navigate = useNavigate();

  const handleClose = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/overview');
    }
  };

  return (
    <div className="dashboard-page-shell relative mx-auto max-w-4xl pb-5 md:pb-7">
      <button
        type="button"
        onClick={handleClose}
        className="absolute right-1 top-0 z-10 flex h-10 w-10 items-center justify-center rounded-xl text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-text-primary md:right-2"
        aria-label="Đóng"
      >
        <X className="h-5 w-5" />
      </button>

      <section className="pt-2 md:pt-3">
        <div className="text-center">
          <h1 className="text-xl font-black tracking-tight text-text-primary md:text-2xl">
            Nâng cấp gói của bạn
          </h1>
        </div>

        <div className="mx-auto mt-5 grid max-w-4xl gap-3 lg:grid-cols-3">
          {planCards.map((plan) => {
            const isFree = plan.id === 'free';
            const isPlus = plan.id === 'plus';
            const isPro = plan.id === 'pro';
            const isCurrent = plan.id === membershipTier;
            const isLowerTier = tierRank[plan.id] < tierRank[membershipTier];
            const isSuggested = (membershipTier === 'free' && isPlus) || (membershipTier === 'plus' && isPro);
            const canUpgrade = !isCurrent && !isLowerTier;
            const ctaLabel = isCurrent
              ? 'Gói hiện tại của bạn'
              : isLowerTier
                ? 'Gói thấp hơn'
                : `Nâng cấp lên ${plan.name}`;
            const badgeLabel = isCurrent ? 'Hiện tại' : isSuggested ? (isPlus ? 'Phổ biến' : 'Đề xuất') : null;
            const cardClass = isSuggested && isPlus
              ? 'border-green-400/70 bg-green-500/20'
              : isSuggested && isPro
                ? 'border-amber-300/70 bg-amber-300/10'
                : 'premium-card';
            const badgeClass = isCurrent
              ? 'bg-bg-tertiary px-3 py-1 text-text-tertiary'
              : isPlus
                ? 'bg-green-300/20 px-3 py-1 text-green-100'
                : 'bg-amber-300/15 px-3 py-1 text-amber-100';

            return (
              <article
                key={plan.id}
                className={`flex min-h-[28.5rem] flex-col rounded-[18px] border p-5 shadow-[0_14px_36px_rgba(0,0,0,0.14)] ${cardClass}`}
              >
                <div className="flex min-h-11 items-start justify-between gap-3">
                  <h2 className="text-3xl font-black tracking-tight text-text-primary">{plan.name}</h2>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {badgeLabel ? (
                      <span className={`rounded-full text-[10px] font-black uppercase tracking-[0.12em] ${badgeClass}`}>
                        {badgeLabel}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className={`${isFree ? 'mt-4 min-h-0' : plan.oldPrice ? 'mt-5 min-h-[7.5rem]' : 'mt-5 min-h-[5.25rem]'}`}>
                  {plan.oldPrice ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs font-black text-text-tertiary">
                      <span className="line-through decoration-2">đ{plan.oldPrice}</span>
                      <span className={`rounded-full px-2.5 py-1 uppercase tracking-[0.1em] ${isPlus ? 'bg-green-300/20 text-green-100' : 'bg-amber-300/15 text-amber-100'}`}>
                        {plan.promo}
                      </span>
                    </div>
                  ) : null}

                  <div className={`${isFree ? 'mt-0' : 'mt-2'} flex items-end gap-2`}>
                    <span className={`${isFree ? 'pb-5' : 'pb-6'} text-xl font-bold text-text-tertiary`}>đ</span>
                    <span className="text-[2.85rem] font-black leading-none text-text-primary">{plan.price}</span>
                    <span className="min-w-0 pb-2 text-xs font-bold leading-5 text-text-tertiary">
                      {plan.period}
                    </span>
                  </div>

                  {plan.renewText ? (
                    <p className="mt-2 text-xs font-bold text-text-tertiary">{plan.renewText}</p>
                  ) : null}
                </div>

                <p className={`${isFree ? 'mt-5 min-h-0' : 'mt-1 min-h-14'} text-lg font-black leading-7 text-text-primary`}>{plan.description}</p>

                {!canUpgrade ? (
                  <div className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-full border border-border-primary bg-transparent px-4 text-sm font-black text-text-tertiary">
                    {ctaLabel}
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-black transition-colors ${isPlus ? 'bg-green-400 text-white hover:bg-green-500' : 'bg-white text-black hover:bg-white/90'}`}
                  >
                    {ctaLabel}
                  </button>
                )}

                <div className={`${isFree ? 'mt-5' : 'mt-6'} space-y-3.5`}>
                  {plan.featureIntro ? (
                    <p className="text-sm font-black leading-5 text-text-primary">{plan.featureIntro}</p>
                  ) : null}
                  {plan.benefits.map((benefit) => (
                    <p key={benefit} className="flex items-center gap-3 text-sm font-semibold leading-5 text-text-secondary">
                      <span className={`shrink-0 text-base font-black leading-5 ${isPro ? 'text-amber-100' : isPlus ? 'text-green-100' : 'text-accent'}`}>
                        ✓
                      </span>
                      <span>{benefit}</span>
                    </p>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
