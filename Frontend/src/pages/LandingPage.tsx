import {
  ArrowRight,
  BarChart3,
  Bot,
  CalendarCheck,
  Check,
  ChevronDown,
  Clock3,
  Dumbbell,
  MessageSquareText,
  Sparkles,
  Utensils,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ScrollReveal from '../components/ScrollReveal';

const todayExercises = [
  'Push-up - 3 hiệp x 10',
  'Dumbbell Shoulder Press - 3 hiệp x 12',
  'Cable Fly - 3 hiệp x 12',
  'Plank - 3 hiệp x 30 giây',
];

const todayMeals = [
  ['Sáng', 'Yến mạch, trứng, chuối'],
  ['Trưa', 'Cơm gạo lứt, ức gà, rau xanh'],
  ['Xế', 'Sữa chua Hy Lạp, hạnh nhân'],
  ['Tối', 'Cá hồi, khoai lang, salad'],
];

const features = [
  'Lịch tập cá nhân hóa',
  'Thực đơn theo calories và protein',
  'AI Coach điều chỉnh bài tập, món ăn',
  'Theo dõi calories, protein, nước, giấc ngủ',
  'Báo cáo tiến độ tuần',
  'Nhắc nhở duy trì thói quen',
];

const faqs = [
  ['Tôi là người mới hoàn toàn, có dùng được không?', 'Có. App được thiết kế để bắt đầu từ mức dễ và tăng dần theo tiến độ của bạn.'],
  ['Tôi không có nhiều thời gian thì sao?', 'AI có thể tạo bài tập 10-30 phút phù hợp với lịch của bạn.'],
  ['Tôi có cần đi gym không?', 'Không bắt buộc. App có thể gợi ý bài tập tại nhà hoặc tại phòng gym.'],
  ['Tôi có thể đổi món ăn không?', 'Có. Bạn có thể yêu cầu AI đổi món theo sở thích, nguyên liệu hoặc mục tiêu calories.'],
  ['AI có tự sửa kế hoạch của tôi không?', 'Không. AI chỉ đề xuất, bạn là người chọn áp dụng hoặc không áp dụng.'],
  ['App phù hợp giảm cân hay tăng cơ?', 'Có thể dùng cho cả giảm cân, tăng cơ hoặc duy trì sức khỏe.'],
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-black uppercase tracking-[0.22em] text-text-tertiary">{children}</p>;
}

function PrimaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent px-6 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover"
    >
      {children}
      <ArrowRight className="h-4 w-4" />
    </button>
  );
}

function SecondaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-12 items-center justify-center rounded-xl border border-border-primary bg-bg-tertiary/45 px-6 text-sm font-black text-text-primary transition-colors hover:border-accent/30 hover:bg-bg-tertiary"
    >
      {children}
    </button>
  );
}

function ProductMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l border-border-primary pl-4">
      <p className="text-xs font-semibold text-text-tertiary">{label}</p>
      <p className="mt-1 text-lg font-black text-text-primary">{value}</p>
    </div>
  );
}

export default function LandingPage() {
  const { isLoggedIn } = useAuth();
  const navigate = useNavigate();
  const [hasScrolled, setHasScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setHasScrolled(window.scrollY > 18);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  if (isLoggedIn) {
    return <Navigate to="/overview" replace />;
  }

  return (
    <div className="landing-page min-h-[100dvh] w-full min-w-0 max-w-[100vw] flex-1 basis-0 overflow-x-hidden bg-bg-primary text-text-primary">
      <header
        className={`fixed inset-x-0 top-0 z-40 border-b transition-all duration-300 ${
          hasScrolled
            ? 'border-border-primary bg-bg-primary/92 shadow-[0_18px_44px_rgba(0,0,0,0.34)] backdrop-blur-xl'
            : 'border-transparent bg-transparent'
        }`}
      >
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-3 py-4 sm:h-24 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-0 lg:px-8">
          <button type="button" onClick={() => navigate('/')} className="flex min-w-0 items-center gap-3 text-left">
            <img src="/logo.svg" alt="Fitly" className="h-10 w-10 shrink-0 object-contain sm:h-11 sm:w-11" />
            <div className="min-w-0">
              <p className="truncate text-base font-black text-text-primary sm:text-lg">Fitly - Trợ lý cá nhân</p>
              <p className="hidden text-xs font-semibold text-text-tertiary sm:block">
                Mở app là biết hôm nay tập gì và ăn gì.
              </p>
            </div>
          </button>
          <nav className="hidden min-w-0 flex-1 items-center justify-center gap-8 lg:flex">
            {[
              ['Tính năng', 'features'],
              ['Phân tích', 'analysis'],
              ['Bảng giá', 'pricing'],
            ].map(([label, targetId]) => (
              <button
                key={targetId}
                type="button"
                onClick={() => document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth' })}
                className="text-xs font-black uppercase tracking-[0.2em] text-text-tertiary transition-colors hover:text-accent"
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="grid w-full shrink-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center sm:gap-3">
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-border-primary bg-bg-tertiary/45 px-3 text-xs font-bold text-text-primary transition-colors hover:border-accent/30 hover:bg-bg-tertiary sm:px-4 sm:text-sm"
            >
              Đăng nhập
            </button>
            <button
              type="button"
              onClick={() => navigate('/signup')}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-accent px-3 text-xs font-black text-text-inverse transition-colors hover:bg-accent-hover sm:px-5 sm:text-sm"
            >
              <span className="hidden sm:inline">Bắt đầu miễn phí</span>
              <span className="sm:hidden">Miễn phí</span>
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-border-primary">
          <div className="landing-grid absolute inset-0 opacity-70" />
          <div className="mx-auto grid min-h-[100dvh] w-full max-w-7xl grid-cols-1 items-center gap-10 px-4 pb-12 pt-32 sm:px-6 sm:pt-36 md:pb-16 lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,0.78fr)] lg:px-8">
            <ScrollReveal className="relative z-10 max-w-4xl">
              <SectionLabel>AI Fitness Coach</SectionLabel>
              <h1 className="mt-5 max-w-[calc(100vw-2rem)] text-3xl font-black leading-[1.08] tracking-normal text-text-primary sm:max-w-4xl sm:text-5xl md:text-6xl">
                <span className="block">Mở app là biết</span>
                <span className="block">hôm nay tập gì</span>
                <span className="block">và ăn gì.</span>
              </h1>
              <p className="mt-6 max-w-2xl text-base font-semibold leading-8 text-text-secondary md:text-lg">
                AI Coach tạo lịch tập và thực đơn cá nhân hóa theo mục tiêu, thể trạng và thời gian của bạn. Phù hợp cho người mới bắt đầu, người bận rộn và người muốn giảm cân bền vững.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <PrimaryButton onClick={() => navigate('/signup')}>Bắt đầu miễn phí</PrimaryButton>
                <SecondaryButton onClick={() => document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' })}>
                  Xem demo
                </SecondaryButton>
              </div>
              <p className="mt-4 text-sm font-semibold text-text-tertiary">
                Miễn phí 7 ngày · Không cần thẻ tín dụng · Có thể hủy bất cứ lúc nào
              </p>
            </ScrollReveal>

            <ScrollReveal className="relative z-10" delayMs={120}>
              <div className="landing-product-card landing-surface rounded-lg border border-border-primary p-4 shadow-[0_28px_90px_rgba(0,0,0,0.36)] sm:p-5">
                <div className="flex items-center justify-between gap-4 border-b border-border-primary pb-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-accent">Hôm nay</p>
                    <p className="mt-1 text-sm font-semibold text-text-secondary">Kế hoạch mẫu cho người mới</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ai/12 text-ai">
                    <Sparkles className="h-5 w-5" />
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-3 gap-3">
                  <ProductMetric label="Tập luyện" value="25 phút" />
                  <ProductMetric label="Calories" value="1.650" />
                  <ProductMetric label="Protein" value="120g" />
                </div>

                <div className="mt-6 space-y-4">
                  <div className="landing-soft-card rounded-lg border border-border-primary p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-text-primary">Push nhẹ cho người mới</p>
                        <p className="mt-1 text-xs font-bold text-text-tertiary">4 bài · Mức độ dễ</p>
                      </div>
                      <Dumbbell className="h-5 w-5 text-accent" />
                    </div>
                    <div className="mt-4 space-y-2">
                      {todayExercises.slice(0, 3).map((item, index) => (
                        <div key={item} className="flex items-center gap-3 text-xs font-semibold text-text-secondary">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-bg-secondary text-[10px] font-black text-accent">
                            {index + 1}
                          </span>
                          <span className="min-w-0 truncate">{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="landing-soft-card rounded-lg border border-border-primary p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-text-primary">Thực đơn giảm cân đơn giản</p>
                        <p className="mt-1 text-xs font-bold text-text-tertiary">4 bữa · Dễ chuẩn bị</p>
                      </div>
                      <Utensils className="h-5 w-5 text-info" />
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {todayMeals.map(([meal, food]) => (
                        <div key={meal} className="text-xs font-semibold text-text-secondary">
                          <span className="font-black text-info">{meal}:</span> {food}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="landing-coach-strip ai-surface rounded-lg border p-4">
                    <div className="flex items-start gap-3">
                      <Bot className="mt-0.5 h-5 w-5 shrink-0 text-ai" />
                      <p className="text-xs font-semibold leading-6 text-text-secondary">
                        Tôi có thể tạo bài tập 10-25 phút và thực đơn dễ nấu để bạn bắt đầu mà không bị quá tải.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </ScrollReveal>
          </div>
        </section>

        <section id="demo" className="border-b border-border-primary bg-bg-secondary py-16 md:py-20">
          <ScrollReveal className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionLabel>Preview hôm nay</SectionLabel>
            <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="landing-card landing-soft-card rounded-lg border border-border-primary p-5">
                <Dumbbell className="h-6 w-6 text-accent" />
                <h2 className="mt-5 text-xl font-black text-text-primary">Bài tập hôm nay</h2>
                <p className="mt-2 text-sm font-bold text-text-secondary">Push nhẹ cho người mới</p>
                <p className="mt-1 text-xs font-semibold text-text-tertiary">~25 phút · 4 bài · Mức độ dễ</p>
                <ol className="mt-5 space-y-3">
                  {todayExercises.map((item, index) => (
                    <li key={item} className="flex gap-3 text-sm font-semibold text-text-secondary">
                      <span className="text-accent">{index + 1}.</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
                <button type="button" onClick={() => navigate('/signup')} className="mt-6 h-11 rounded-xl bg-accent px-5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover">
                  Bắt đầu tập
                </button>
              </div>

              <div className="landing-card landing-soft-card rounded-lg border border-border-primary p-5">
                <Utensils className="h-6 w-6 text-info" />
                <h2 className="mt-5 text-xl font-black text-text-primary">Ăn gì hôm nay</h2>
                <p className="mt-2 text-sm font-bold text-text-secondary">Thực đơn giảm cân đơn giản</p>
                <p className="mt-1 text-xs font-semibold text-text-tertiary">~1.650 kcal · 120g protein</p>
                <div className="mt-5 space-y-3">
                  {todayMeals.map(([meal, food]) => (
                    <p key={meal} className="text-sm font-semibold leading-6 text-text-secondary">
                      <span className="font-black text-info">{meal}:</span> {food}
                    </p>
                  ))}
                </div>
                <button type="button" onClick={() => navigate('/signup')} className="mt-6 h-11 rounded-xl border border-border-primary bg-bg-tertiary/45 px-5 text-sm font-black text-text-primary transition-colors hover:border-accent/30 hover:bg-bg-tertiary">
                  Xem thực đơn mẫu
                </button>
              </div>

              <div className="landing-card ai-surface rounded-lg border p-5">
                <Bot className="h-6 w-6 text-ai" />
                <h2 className="mt-5 text-xl font-black text-text-primary">Gợi ý từ AI Coach</h2>
                <p className="mt-5 text-sm font-semibold leading-7 text-text-secondary">
                  Bạn là người mới? Tôi có thể tạo bài tập 10-25 phút và thực đơn dễ nấu để bạn bắt đầu mà không bị quá tải.
                </p>
                <button type="button" onClick={() => navigate('/signup')} className="mt-6 h-11 rounded-xl bg-accent px-5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover">
                  Nhờ AI tạo kế hoạch
                </button>
              </div>
            </div>
          </ScrollReveal>
        </section>

        <section id="features" className="scroll-mt-24 border-b border-border-primary bg-bg-primary py-16 md:py-20">
          <ScrollReveal className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionLabel>Tính năng</SectionLabel>
            <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-3xl font-black tracking-normal text-text-primary md:text-4xl">
                  Những gì Fitly làm cho bạn mỗi ngày
                </h2>
                <p className="mt-4 max-w-2xl text-base font-semibold leading-8 text-text-secondary">
                  Một nơi để xem bài tập, thực đơn, tiến độ và hỏi AI Coach khi cần chỉnh kế hoạch.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/signup')}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover"
              >
                Bắt đầu miễn phí
              </button>
            </div>

            <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {features.map((item, index) => {
                const featureIcons = [Dumbbell, Utensils, Bot, BarChart3, CalendarCheck, Zap];
                const featureTones = ['text-accent bg-accent/10', 'text-info bg-info/10', 'text-ai bg-ai/10', 'text-warning bg-warning/10', 'text-accent bg-accent/10', 'text-ai bg-ai/10'];
                const Icon = featureIcons[index] || Zap;
                return (
                  <div key={item} className="landing-card landing-soft-card rounded-lg border border-border-primary p-5">
                    <span className={`flex h-11 w-11 items-center justify-center rounded-lg ${featureTones[index] || featureTones[0]}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-5 text-lg font-black text-text-primary">{item}</h3>
                    <p className="mt-3 text-sm font-semibold leading-7 text-text-secondary">
                      Thiết kế để bạn biết việc cần làm tiếp theo mà không phải tự ghép nhiều công cụ.
                    </p>
                  </div>
                );
              })}
            </div>
          </ScrollReveal>
        </section>

        <section id="analysis" className="scroll-mt-24 border-b border-border-primary bg-bg-secondary py-16 md:py-20">
          <ScrollReveal className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionLabel>Phân tích</SectionLabel>
            <div className="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
              <div>
                <h2 className="text-3xl font-black tracking-normal text-text-primary md:text-4xl">
                  Theo dõi tiến độ mà không bị ngợp số liệu
                </h2>
                <p className="mt-4 text-base font-semibold leading-8 text-text-secondary">
                  Fitly gom tập luyện, dinh dưỡng, nước và thói quen thành những chỉ số dễ đọc để AI đề xuất điều chỉnh đúng lúc.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <article className="landing-card landing-soft-card rounded-lg border border-border-primary p-5 md:col-span-2">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-accent">Tuần này</p>
                      <h3 className="mt-2 text-xl font-black text-text-primary">Điểm duy trì kế hoạch</h3>
                    </div>
                    <BarChart3 className="h-7 w-7 text-accent" />
                  </div>
                  <div className="mt-6 space-y-4">
                    {[
                      ['Tập luyện', '4/5 buổi', '80%', 'bg-accent'],
                      ['Protein', '120g / ngày', '74%', 'bg-info'],
                      ['Giấc ngủ', '6.8h / đêm', '68%', 'bg-warning'],
                    ].map(([label, value, width, color]) => (
                      <div key={label}>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <span className="text-sm font-black text-text-primary">{label}</span>
                          <span className="text-sm font-bold text-text-secondary">{value}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-bg-tertiary">
                          <div className={`h-full rounded-full ${color}`} style={{ width }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="landing-card landing-soft-card rounded-lg border border-border-primary p-5">
                  <Clock3 className="h-6 w-6 text-warning" />
                  <h3 className="mt-5 text-lg font-black text-text-primary">Nhịp sinh hoạt</h3>
                  <p className="mt-3 text-sm font-semibold leading-7 text-text-secondary">
                    Theo dõi streak, thời lượng tập, nước và giấc ngủ để giữ thói quen ổn định.
                  </p>
                </article>

                <article className="landing-card ai-surface rounded-lg border p-5">
                  <MessageSquareText className="h-6 w-6 text-ai" />
                  <h3 className="mt-5 text-lg font-black text-text-primary">Gợi ý điều chỉnh</h3>
                  <p className="mt-3 text-sm font-semibold leading-7 text-text-secondary">
                    AI phát hiện ngày quá tải, thiếu protein hoặc lệch mục tiêu và gợi ý chỉnh nhẹ.
                  </p>
                </article>
              </div>
            </div>
          </ScrollReveal>
        </section>

        <section id="pricing" className="scroll-mt-24 border-b border-border-primary bg-bg-primary py-16 md:py-24">
          <ScrollReveal className="mx-auto w-full max-w-6xl px-4 text-center sm:px-6 lg:px-8">
            <SectionLabel>Bảng giá</SectionLabel>
            <h2 className="mx-auto mt-4 max-w-4xl text-3xl font-black tracking-normal text-text-primary md:text-5xl">
              Bắt đầu đơn giản, nâng cấp khi cần
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-base font-semibold leading-8 text-text-secondary">
              Chọn gói phù hợp với mức độ sử dụng AI. Bạn có thể bắt đầu với tracking cơ bản và mở rộng sang meal planner, phân tích nâng cao khi cần.
            </p>
            <div className="mt-7 inline-flex max-w-full items-center gap-2 rounded-full border border-accent/35 bg-accent/10 px-4 py-2 text-xs font-black text-accent">
              <Zap className="h-4 w-4 fill-current" />
              <span>Bắt đầu miễn phí ngay hôm nay — không cần thẻ</span>
            </div>

            <div className="mt-12 grid grid-cols-1 gap-5 text-left lg:grid-cols-3">
              <article className="landing-card landing-soft-card flex min-h-[28rem] flex-col rounded-lg border border-border-primary p-6">
                <div>
                  <h3 className="text-xl font-black text-text-primary">Free</h3>
                  <p className="mt-3 min-h-14 text-sm font-semibold leading-7 text-text-secondary">
                    Trải nghiệm đầy đủ tính năng cốt lõi — không cần thẻ.
                  </p>
                </div>
                <div className="mt-7">
                  <p className="text-4xl font-black text-accent">0đ</p>
                  <p className="mt-1 text-xs font-black text-text-tertiary">25 credit AI / tháng</p>
                </div>
                <div className="mt-7 space-y-4">
                  {[
                    'Kế hoạch ăn & tập AI cá nhân hóa',
                    'Quét món ăn bằng AI',
                    'Thử thách + bảng xếp hạng',
                    'Theo dõi tiến độ',
                  ].map((item) => (
                    <div key={item} className="flex items-start gap-3 text-sm font-semibold text-text-secondary">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/signup')}
                  className="mt-auto inline-flex h-12 w-full items-center justify-center rounded-xl border border-border-primary bg-transparent px-5 text-sm font-black text-text-primary transition-colors hover:border-accent/35 hover:bg-bg-tertiary"
                >
                  Bắt đầu miễn phí
                </button>
              </article>

              <article className="landing-card flex min-h-[28rem] flex-col rounded-lg border border-accent/45 bg-accent/5 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.24)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-black text-text-primary">Plus</h3>
                    <p className="mt-3 min-h-14 text-sm font-semibold leading-7 text-text-secondary">
                      Cho người tập nghiêm túc, dùng AI hằng ngày.
                    </p>
                  </div>
                  <span className="rounded-full border border-border-primary bg-bg-tertiary/70 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-text-tertiary">
                    Sắp có
                  </span>
                </div>
                <div className="mt-7">
                  <p className="text-4xl font-black text-accent">
                    49.000đ <span className="text-sm font-bold text-text-tertiary">/tháng</span>
                  </p>
                  <p className="mt-1 text-xs font-black text-text-tertiary">200 credit AI / tháng</p>
                </div>
                <div className="mt-7 space-y-4">
                  {[
                    'Mọi tính năng của Free',
                    'Gấp 8 lần lượt AI mỗi tháng',
                    'AI Coach chat thoải mái',
                    'Smart meal planner theo ngân sách',
                  ].map((item) => (
                    <div key={item} className="flex items-start gap-3 text-sm font-semibold text-text-secondary">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  disabled
                  className="mt-auto inline-flex h-12 w-full cursor-not-allowed items-center justify-center rounded-xl border border-border-primary bg-transparent px-5 text-sm font-black uppercase tracking-[0.14em] text-text-tertiary opacity-70"
                >
                  Sắp ra mắt
                </button>
              </article>

              <article className="landing-card landing-soft-card flex min-h-[28rem] flex-col rounded-lg border border-border-primary p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-black text-text-primary">Pro</h3>
                    <p className="mt-3 min-h-14 text-sm font-semibold leading-7 text-text-secondary">
                      Dùng AI không cần đếm lượt — tối ưu tối đa.
                    </p>
                  </div>
                  <span className="rounded-full border border-border-primary bg-bg-tertiary/70 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-text-tertiary">
                    Sắp có
                  </span>
                </div>
                <div className="mt-7">
                  <p className="text-4xl font-black text-accent">
                    99.000đ <span className="text-sm font-bold text-text-tertiary">/tháng</span>
                  </p>
                  <p className="mt-1 text-xs font-black text-text-tertiary">Credit AI không giới hạn</p>
                </div>
                <div className="mt-7 space-y-4">
                  {[
                    'Mọi tính năng của Plus',
                    'Không giới hạn phiên AI',
                    'Tạo lại kế hoạch bao nhiêu lần tùy thích',
                  ].map((item) => (
                    <div key={item} className="flex items-start gap-3 text-sm font-semibold text-text-secondary">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  disabled
                  className="mt-auto inline-flex h-12 w-full cursor-not-allowed items-center justify-center rounded-xl border border-border-primary bg-transparent px-5 text-sm font-black uppercase tracking-[0.14em] text-text-tertiary opacity-70"
                >
                  Sắp ra mắt
                </button>
              </article>
            </div>
          </ScrollReveal>
        </section>

        <section className="border-b border-border-primary bg-bg-secondary py-16 md:py-20">
          <ScrollReveal className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8">
            <SectionLabel>FAQ</SectionLabel>
            <div className="landing-surface mt-8 divide-y divide-border-primary rounded-lg border border-border-primary">
              {faqs.map(([question, answer]) => (
                <details key={question} className="group p-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-black text-text-primary">
                    {question}
                    <ChevronDown className="h-5 w-5 shrink-0 text-text-tertiary transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="mt-3 text-sm font-semibold leading-7 text-text-secondary">{answer}</p>
                </details>
              ))}
            </div>
          </ScrollReveal>
        </section>
      </main>

      <footer className="bg-bg-primary py-12">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-8 px-4 sm:px-6 md:grid-cols-[1fr_0.8fr_0.8fr_0.8fr] lg:px-8">
          <div>
            <p className="text-xl font-black text-text-primary">Fitly - Trợ lý cá nhân</p>
            <p className="mt-3 max-w-sm text-sm font-semibold leading-7 text-text-secondary">
              Mở app là biết hôm nay tập gì và ăn gì.
            </p>
          </div>
          <div>
            <p className="text-sm font-black text-text-primary">Sản phẩm</p>
            <div className="mt-4 space-y-2 text-sm font-semibold text-text-tertiary">
              <p>Hôm nay</p>
              <p>Tính năng</p>
              <p>Phân tích</p>
              <p>Bảng giá</p>
              <p>AI Coach</p>
            </div>
          </div>
          <div>
            <p className="text-sm font-black text-text-primary">Hỗ trợ</p>
            <div className="mt-4 space-y-2 text-sm font-semibold text-text-tertiary">
              <p>Câu hỏi thường gặp</p>
              <p>Liên hệ</p>
              <p>Chính sách bảo mật</p>
              <p>Điều khoản sử dụng</p>
            </div>
          </div>
          <div>
            <p className="text-sm font-black text-text-primary">Mạng xã hội</p>
            <div className="mt-4 space-y-2 text-sm font-semibold text-text-tertiary">
              <p>Facebook</p>
              <p>TikTok</p>
              <p>Instagram</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
