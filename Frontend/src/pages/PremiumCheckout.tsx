import { useState } from 'react';
import {
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth, type MembershipTier } from '../contexts/AuthContext';
import { API_BASE_URL } from '../lib/Api';
import { supabase } from '../lib/Supabase';
import { useToast } from '../components/ToastProvider';

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

const formatMembershipExpiry = (value: unknown): string => {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('vi-VN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
};

export default function PremiumCheckout() {
  const { user, profile, membershipTier, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [submittingPlanId, setSubmittingPlanId] = useState<MembershipTier | null>(null);
  const membershipExpiryLabel = formatMembershipExpiry(profile?.membership_expires_at);

  const handleClose = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/overview');
    }
  };

  const handlePlanAction = async (tier: MembershipTier) => {
    if (!user?.id || tier === 'free' || submittingPlanId) return;
    setSubmittingPlanId(tier);
    try {
      const sessionRes = await supabase.auth.getSession();
      const accessToken = sessionRes.data.session?.access_token;
      if (!accessToken) throw new Error('Missing access token');

      const response = await fetch(`${API_BASE_URL}/api/membership/renew`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ tier }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Không thể gia hạn gói lúc này.');

      await refreshProfile();
      toast.success(tier === membershipTier ? 'Đã gia hạn thêm 1 tháng.' : `Đã kích hoạt gói ${tier.toUpperCase()} trong 1 tháng.`);
    } catch (error: any) {
      toast.error(error?.message || 'Không thể xử lý gói lúc này.');
    } finally {
      setSubmittingPlanId(null);
    }
  };

  return (
    <div className="premium-checkout-page dashboard-page-shell relative mx-auto max-w-5xl pb-5 md:pb-7">
      <button
        type="button"
        onClick={handleClose}
        className="premium-checkout-close"
        aria-label="Đóng"
      >
        <X className="h-5 w-5" />
      </button>

      <section className="premium-checkout-section">
        <div className="text-center">
          <h1 className="premium-checkout-title">
            Nâng cấp gói của bạn
          </h1>
        </div>

        <div className="premium-plan-grid">
          {planCards.map((plan) => {
            const isFree = plan.id === 'free';
            const isPlus = plan.id === 'plus';
            const isPro = plan.id === 'pro';
            const isCurrent = plan.id === membershipTier;
            const isLowerTier = tierRank[plan.id] < tierRank[membershipTier];
            const isSuggested = (membershipTier === 'free' && isPlus) || (membershipTier === 'plus' && isPro);
            const canUpgrade = !isCurrent && !isLowerTier;
            const canSubmit = canUpgrade;
            const isSubmitting = submittingPlanId === plan.id;
            
            const hasUsedPromo = isFree
              ? false
              : Boolean(
                  profile?.has_purchased_plus ||
                  profile?.has_purchased_pro ||
                  membershipTier === 'plus' ||
                  membershipTier === 'pro'
                );

            const displayPrice = isFree
              ? '0'
              : hasUsedPromo
              ? (isPlus ? '79.000' : '149.000')
              : plan.price;

            const displayOldPrice = isFree || hasUsedPromo ? undefined : plan.oldPrice;
            const displayPromo = isFree || hasUsedPromo ? undefined : plan.promo;
            const displayPeriod = isFree ? 'VND / tháng' : hasUsedPromo ? 'VND / tháng' : plan.period;
            const displayRenewText = isFree || hasUsedPromo ? undefined : plan.renewText;

            const ctaLabel = isCurrent
              ? 'Gói hiện tại của bạn'
              : isLowerTier
              ? 'Gói thấp hơn'
              : `Nâng cấp lên ${plan.name}`;
            const badgeLabel = isCurrent ? 'Hiện tại' : isSuggested ? (isPlus ? 'Phổ biến' : 'Đề xuất') : null;
            const cardClass = [
              'premium-plan-card',
              `premium-plan-${plan.id}`,
              isSuggested ? 'premium-plan-suggested' : '',
              isCurrent ? 'premium-plan-current' : '',
            ].filter(Boolean).join(' ');

            return (
              <article
                key={plan.id}
                className={cardClass}
              >
                <div className="premium-plan-head">
                  <h2>{plan.name}</h2>
                  <div className="premium-plan-badges">
                    {badgeLabel ? (
                      <span className={`premium-plan-badge ${isCurrent ? 'premium-plan-badge-current' : isPlus ? 'premium-plan-badge-plus' : 'premium-plan-badge-pro'}`}>
                        {badgeLabel}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className={`premium-plan-price-block ${isFree ? 'premium-plan-price-free' : ''}`}>
                  {displayOldPrice ? (
                    <div className="premium-plan-promo-row">
                      <span className="premium-plan-old-price">đ{displayOldPrice}</span>
                      <span className={`premium-plan-promo ${isPlus ? 'premium-plan-promo-plus' : 'premium-plan-promo-pro'}`}>
                        {displayPromo}
                      </span>
                    </div>
                  ) : null}

                  <div className="premium-plan-price-row">
                    <span className="premium-plan-currency">đ</span>
                    <span className="premium-plan-price">{displayPrice}</span>
                    <span className="premium-plan-period">
                      {displayPeriod}
                    </span>
                  </div>

                  {displayRenewText ? (
                    <p className="premium-plan-renew">{displayRenewText}</p>
                  ) : null}
                </div>

                <p className="premium-plan-description">{plan.description}</p>

                {isCurrent && !isFree && membershipExpiryLabel ? (
                  <p className="premium-plan-current-note">Hạn gói hiện tại: {membershipExpiryLabel}</p>
                ) : null}

                {!canSubmit ? (
                  <div className="premium-plan-cta premium-plan-cta-disabled">
                    {ctaLabel}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handlePlanAction(plan.id)}
                    disabled={!!submittingPlanId}
                    className={`premium-plan-cta ${isPlus ? 'premium-plan-cta-plus' : 'premium-plan-cta-pro'}`}
                  >
                    {isSubmitting ? 'Đang xử lý...' : ctaLabel}
                  </button>
                )}

                <div className="premium-plan-benefits">
                  {plan.featureIntro ? (
                    <p className="premium-plan-feature-intro">{plan.featureIntro}</p>
                  ) : null}
                  {plan.benefits.map((benefit) => (
                    <p key={benefit} className="premium-plan-benefit">
                      <span className={`premium-plan-check ${isPro ? 'premium-plan-check-pro' : isPlus ? 'premium-plan-check-plus' : 'premium-plan-check-free'}`}>
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
