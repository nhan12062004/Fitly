import {
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  Dumbbell,
  Sparkles,
  Star,
  Utensils,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import ScrollReveal from '../components/ScrollReveal';
import FitlyLogo from '../components/FitlyLogo';

const todayExercises = [
  'Push-up - 3 hiệp x 10',
  'Dumbbell Shoulder Press - 3 hiệp x 12',
  'Cable Fly - 3 hiệp x 12',
  'Plank - 3 hiệp x 30 giây',
];

const featureShowcase = [
  {
    icon: Dumbbell,
    title: 'Lịch tập hiện ngay khi mở app',
    text: 'Fitly chọn bài theo mục tiêu, thời gian rảnh và thiết bị bạn có trong ngày.',
    iconClass: 'text-accent',
  },
  {
    icon: Utensils,
    title: 'Thực đơn bám sát calories và protein',
    text: 'Bữa ăn được gợi ý theo mục tiêu, ngân sách, nguyên liệu và món bạn dễ theo.',
    iconClass: 'text-info',
  },
  {
    icon: Bot,
    title: 'AI Coach chỉnh kế hoạch khi dữ liệu thay đổi',
    text: 'Khi bạn cập nhật tiến độ, AI gợi ý đổi bài, đổi món hoặc giảm tải đúng lúc.',
    iconClass: 'text-ai',
  },
];

const testimonials = [
  {
    quote: 'Trước đây tôi hay bỏ buổi vì không biết nên tập gì. Fitly gom sẵn bài tập ngắn và thực đơn vừa sức nên tôi theo được đều hơn.',
    name: 'Mai Anh',
    role: 'Nhân viên văn phòng · Hà Nội',
    initials: 'MA',
    result: 'Tập đều',
  },
  {
    quote: 'Tôi chỉ cần ghi món ăn và lịch tập. AI gợi ý chỉnh phần protein với calories rõ ràng, không phải tự tính từng thứ như trước.',
    name: 'Quốc Huy',
    role: 'Designer · TP.HCM',
    initials: 'QH',
    result: 'Ăn gọn',
  },
  {
    quote: 'Phần theo dõi tiến độ giúp tôi nhận ra ngày nào đang quá tải. Kế hoạch linh hoạt nên vẫn giữ được nhịp dù lịch bận.',
    name: 'Thanh Trúc',
    role: 'Sinh viên · Đà Nẵng',
    initials: 'TT',
    result: 'Giữ nhịp',
  },
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

function SectionHeading({
  eyebrow,
  title,
  description,
  className = '',
}: {
  eyebrow: string;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={`mx-auto max-w-5xl text-center ${className}`}>
      <p className="text-[11px] font-black uppercase leading-none tracking-[0.32em] text-accent">{eyebrow}</p>
      <h2 className="landing-section-title mx-auto mt-5 max-w-5xl font-black tracking-normal text-text-primary">
        {title}
      </h2>
      {description ? (
        <p className="mx-auto mt-5 max-w-2xl text-base font-semibold leading-8 text-text-secondary">
          {description}
        </p>
      ) : null}
    </div>
  );
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

  useEffect(() => {
    document.documentElement.classList.add('landing-scrollbar-visible');
    document.body.classList.add('landing-scrollbar-visible');

    return () => {
      document.documentElement.classList.remove('landing-scrollbar-visible');
      document.body.classList.remove('landing-scrollbar-visible');
    };
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
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-3 py-4 sm:h-20 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-0 lg:px-8">
          <button type="button" onClick={() => navigate('/')} className="flex min-w-0 items-center gap-3 text-left">
            <FitlyLogo />
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
              <span className="sm:hidden">Đăng kí</span>
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-hero-section relative overflow-hidden">
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
                <SecondaryButton onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}>
                  Xem tính năng
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
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-accent">Thiết lập cá nhân</p>
                    <p className="mt-1 text-sm font-semibold text-text-secondary">AI bắt đầu từ hồ sơ và lịch sống của bạn</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ai/12 text-ai">
                    <Sparkles className="h-5 w-5" />
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {[
                    ['Mục tiêu', 'Giảm mỡ bền vững'],
                    ['Thời gian', '20-30 phút/ngày'],
                    ['Dụng cụ', 'Tạ tay + thảm'],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-border-primary bg-bg-secondary/65 p-3">
                      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-text-tertiary">{label}</p>
                      <p className="mt-1 text-sm font-black text-text-primary">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-5 rounded-lg border border-border-primary bg-bg-secondary/65 p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ai/12 text-ai">
                      <Bot className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-black text-text-primary">AI đang ghép kế hoạch phù hợp</p>
                      <p className="mt-1 text-xs font-semibold leading-6 text-text-secondary">
                        Kết hợp mục tiêu, kinh nghiệm tập, lịch rảnh và thói quen ăn uống để tạo điểm bắt đầu vừa sức.
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 space-y-3">
                    {[
                      ['Hồ sơ thể trạng', 'w-[86%]', 'bg-accent'],
                      ['Lịch sinh hoạt', 'w-[72%]', 'bg-info'],
                      ['Ngân sách bữa ăn', 'w-[64%]', 'bg-ai'],
                    ].map(([label, width, color]) => (
                      <div key={label}>
                        <div className="mb-2 flex items-center justify-between text-xs font-bold text-text-secondary">
                          <span>{label}</span>
                          <Check className="h-3.5 w-3.5 text-accent" />
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
                          <div className={`h-full rounded-full ${width} ${color}`} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {[
                    [Dumbbell, '4 buổi tập', 'text-accent'],
                    [Utensils, '3 bữa/ngày', 'text-info'],
                    [Zap, 'Nhắc thói quen', 'text-warning'],
                  ].map(([Icon, label, color]) => (
                    <div key={label as string} className="flex items-center gap-2 rounded-lg border border-border-primary bg-bg-secondary/55 p-3">
                      <Icon className={`h-4 w-4 shrink-0 ${color}`} />
                      <span className="min-w-0 truncate text-xs font-black text-text-secondary">{label as string}</span>
                    </div>
                  ))}
                </div>
              </div>
            </ScrollReveal>
          </div>
        </section>

        <section id="features" className="landing-lower-section scroll-mt-24 py-16 md:py-20">
          <ScrollReveal className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionHeading
              eyebrow="Tính năng"
              title="Một ngày trong Fitly, nhìn là biết việc cần làm"
              description="Lịch tập, thực đơn và AI Coach được đặt trong cùng một luồng để bạn mở app lên là theo được ngay."
            />

            <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center">
              <div className="landing-product-card landing-surface relative overflow-hidden rounded-lg border border-border-primary p-4 sm:p-5">
                <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] [background-size:42px_42px]" />
                <div className="relative z-10">
                  <div className="flex items-center justify-between gap-4 border-b border-border-primary pb-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-accent">Kế hoạch hôm nay</p>
                      <p className="mt-1 text-sm font-semibold text-text-secondary">Đã cá nhân hóa từ dữ liệu mới nhất</p>
                    </div>
                    <Sparkles className="h-6 w-6 text-accent" />
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-[1fr_0.9fr]">
                    <div className="rounded-lg border border-border-primary bg-bg-secondary/70 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-text-primary">Push nhẹ cho người mới</p>
                          <p className="mt-1 text-xs font-bold text-text-tertiary">25 phút · 4 bài · Không quá tải</p>
                        </div>
                        <Dumbbell className="h-5 w-5 text-accent" />
                      </div>
                      <div className="mt-4 space-y-2">
                        {todayExercises.slice(0, 3).map((item, index) => (
                          <div key={item} className="flex items-center gap-3 text-xs font-semibold text-text-secondary">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-bg-tertiary text-[10px] font-black text-accent">
                              {index + 1}
                            </span>
                            <span className="min-w-0 truncate">{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-4">
                      <div className="rounded-lg border border-border-primary bg-bg-secondary/70 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-black text-text-primary">Thực đơn</p>
                          <Utensils className="h-5 w-5 text-info" />
                        </div>
                        <div className="mt-4 space-y-3">
                          {[
                            ['Calories', '1.650', 'w-[74%]', 'bg-info'],
                            ['Protein', '120g', 'w-[68%]', 'bg-accent'],
                          ].map(([label, value, width, color]) => (
                            <div key={label}>
                              <div className="flex items-center justify-between text-xs font-bold text-text-secondary">
                                <span>{label}</span>
                                <span>{value}</span>
                              </div>
                              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
                                <div className={`h-full rounded-full ${width} ${color}`} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="ai-surface rounded-lg border p-4">
                        <div className="flex items-start gap-3">
                          <Bot className="mt-0.5 h-5 w-5 shrink-0 text-ai" />
                          <p className="text-xs font-semibold leading-6 text-text-secondary">
                            Hôm nay bạn chỉ rảnh 20 phút, tôi sẽ rút bài tập và giữ đủ nhóm cơ chính.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-3">
                    {[
                      ['4/5', 'buổi tập'],
                      ['82%', 'đúng mục tiêu'],
                      ['3', 'gợi ý mới'],
                    ].map(([value, label]) => (
                      <div key={label} className="rounded-lg border border-border-primary bg-bg-secondary/55 p-3">
                        <p className="text-lg font-black text-text-primary">{value}</p>
                        <p className="mt-1 truncate text-[11px] font-semibold text-text-tertiary">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-text-tertiary">Tập trung vào hành động</p>
                <h3 className="mt-4 text-3xl font-black leading-tight text-text-primary">
                  Không cần tự ghép bài tập, món ăn và ghi chú ở nhiều nơi
                </h3>
                <p className="mt-5 text-sm font-semibold leading-7 text-text-secondary">
                  Fitly biến dữ liệu mỗi ngày thành một kế hoạch dễ theo: hôm nay tập gì, ăn gì, cần chỉnh gì và vì sao nên chỉnh.
                </p>
                <div className="mt-8 divide-y divide-border-primary">
                  {featureShowcase.map(({ icon: Icon, title, text, iconClass }) => (
                    <div key={title} className="flex gap-4 py-5 first:pt-0 last:pb-0">
                      <span className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-primary bg-bg-tertiary/70 ${iconClass}`}>
                        <Icon className="h-5 w-5" />
                      </span>
                      <div>
                        <h4 className="text-base font-black text-text-primary">{title}</h4>
                        <p className="mt-2 text-sm font-semibold leading-7 text-text-secondary">{text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </ScrollReveal>
        </section>

        <section id="analysis" className="landing-lower-section scroll-mt-24 py-16 md:py-20">
          <ScrollReveal className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionHeading
              eyebrow="Phân tích"
              title="AI hiểu cơ thể, lịch tập và bữa ăn của riêng bạn"
              description="Fitly đọc mục tiêu, thể trạng, thời gian rảnh, dữ liệu tập luyện và nhật ký ăn uống để đề xuất kế hoạch vừa sức hơn cho từng người."
            />

            <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
              <div className="relative min-h-[24rem] overflow-hidden rounded-lg border border-border-primary bg-bg-secondary">
                <img
                  src="https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1000&q=82"
                  alt="Người tập luyện với tạ trong phòng gym"
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>

              <div>
                <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-border-primary bg-bg-tertiary/70 text-accent">
                  <Dumbbell className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-2xl font-black leading-tight text-text-primary">
                  Không dùng một giáo án chung cho mọi người
                </h3>
                <p className="mt-4 text-sm font-semibold leading-7 text-text-secondary">
                  AI xem mục tiêu, kinh nghiệm tập, thiết bị bạn có, nhóm cơ đã tập và cảm giác sau buổi tập để điều chỉnh kế hoạch tiếp theo.
                </p>
                <div className="mt-6 grid gap-3">
                  {[
                    'Giảm độ khó khi bạn mệt, đau nhẹ hoặc thiếu thời gian.',
                    'Tăng số hiệp, thời lượng hoặc bài bổ trợ khi tiến độ đang ổn.',
                    'Gợi ý ngày nghỉ và nhóm cơ cần ưu tiên để tránh tập lệch.',
                  ].map((item) => (
                    <div key={item} className="flex items-start gap-3 text-sm font-semibold leading-7 text-text-secondary">
                      <Check className="mt-1 h-4 w-4 shrink-0 text-accent" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-16 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center">
              <div className="order-2 lg:order-1">
                <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-border-primary bg-bg-tertiary/70 text-info">
                  <Utensils className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-2xl font-black leading-tight text-text-primary">
                  Thực đơn dựa trên món bạn thật sự có thể ăn
                </h3>
                <p className="mt-4 text-sm font-semibold leading-7 text-text-secondary">
                  Fitly kết hợp calories, protein, ngân sách, nguyên liệu và thói quen ăn uống để đề xuất bữa dễ theo hơn trong đời sống hằng ngày.
                </p>
                <div className="mt-6 grid gap-3">
                  {[
                    'Đổi món theo sở thích, dị ứng, nguyên liệu còn lại hoặc thời gian nấu.',
                    'Nhắc phần còn thiếu như protein, rau, nước hoặc calories trong ngày.',
                    'Chia bữa theo lịch sinh hoạt thay vì ép bạn theo một khung cứng.',
                  ].map((item) => (
                    <div key={item} className="flex items-start gap-3 text-sm font-semibold leading-7 text-text-secondary">
                      <Check className="mt-1 h-4 w-4 shrink-0 text-info" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative order-1 min-h-[24rem] overflow-hidden rounded-lg border border-border-primary bg-bg-secondary lg:order-2">
                <img
                  src="https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=1000&q=82"
                  alt="Bữa ăn lành mạnh với rau, trứng và bơ"
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
            </div>

            <div className="mx-auto mt-14 max-w-4xl border-t border-white/[0.07] pt-8 text-center">
              <Bot className="mx-auto h-6 w-6 text-ai" />
              <p className="mx-auto mt-4 max-w-3xl text-sm font-semibold leading-7 text-text-secondary">
                Khi bạn cập nhật cân nặng, buổi tập đã hoàn thành hoặc bữa ăn đã dùng, Fitly dùng dữ liệu đó để tinh chỉnh lần gợi ý tiếp theo.
              </p>
            </div>
          </ScrollReveal>
        </section>

        <section id="pricing" className="landing-lower-section scroll-mt-24 py-16 md:py-24">
          <ScrollReveal className="mx-auto w-full max-w-6xl px-4 text-center sm:px-6 lg:px-8">
            <SectionHeading
              eyebrow="Bảng giá"
              title="Chọn gói theo nhịp tập của bạn"
              description="Dùng thử 7 ngày để nhận lịch tự động đầu tiên. Khi cần lịch mới hằng tuần và thêm quota AI, bạn có thể nâng cấp sau."
            />
            <div className="mt-7 inline-flex max-w-full items-center gap-2 rounded-full border border-accent/35 bg-accent/10 px-4 py-2 text-xs font-black text-accent">
              <Zap className="h-4 w-4 fill-current" />
              <span>Ưu đãi lần đầu: giảm 30% tháng đầu cho Plus hoặc Pro</span>
            </div>

            <div className="premium-plan-grid mt-10 text-left">
              <article className="premium-plan-card premium-plan-free">
                <div className="premium-plan-head">
                  <h2>Free</h2>
                </div>
                <div className="premium-plan-price-block premium-plan-price-free">
                  <div className="premium-plan-price-row">
                    <span className="premium-plan-currency">đ</span>
                    <span className="premium-plan-price">0</span>
                    <span className="premium-plan-period">VND / tháng</span>
                  </div>
                </div>
                <p className="premium-plan-description">Dùng thử lịch tập, thực đơn và AI Coach trong 7 ngày.</p>
                <button type="button" onClick={() => navigate('/signup')} className="premium-plan-cta premium-plan-cta-disabled">
                  Bắt đầu miễn phí
                </button>
                <div className="premium-plan-benefits">
                  {['Lịch tập và thực đơn 7 ngày đầu', 'Có giới hạn lượt tạo lại bài tập', 'Có giới hạn lượt tạo lại thực đơn', 'AI Coach giới hạn 25 tin nhắn'].map((item) => (
                    <p key={item} className="premium-plan-benefit">
                      <span className="premium-plan-check premium-plan-check-free">✓</span>
                      <span>{item}</span>
                    </p>
                  ))}
                </div>
              </article>

              <article className="premium-plan-card premium-plan-plus premium-plan-suggested">
                <div className="premium-plan-head">
                  <h2>Plus</h2>
                  <div className="premium-plan-badges">
                    <span className="premium-plan-badge premium-plan-badge-plus">Phổ biến</span>
                  </div>
                </div>
                <div className="premium-plan-price-block">
                  <div className="premium-plan-promo-row">
                    <span className="premium-plan-old-price">đ79.000</span>
                    <span className="premium-plan-promo premium-plan-promo-plus">Giảm 30% lần mua đầu</span>
                  </div>
                  <div className="premium-plan-price-row">
                    <span className="premium-plan-currency">đ</span>
                    <span className="premium-plan-price">55.000</span>
                    <span className="premium-plan-period">VND / tháng đầu</span>
                  </div>
                  <p className="premium-plan-renew">Sau đó 79.000đ / tháng</p>
                </div>
                <p className="premium-plan-description">Fitly tự chuẩn bị lịch mới mỗi tuần, bạn chỉ cần làm theo.</p>
                <button type="button" onClick={() => navigate('/signup')} className="premium-plan-cta premium-plan-cta-plus">
                  Chọn Plus
                </button>
                <div className="premium-plan-benefits">
                  {['Tự động tạo lịch 7 ngày mỗi tuần', 'Tạo lịch thêm khi đổi mục tiêu hoặc lịch sinh hoạt', 'Đổi bài tập và thực đơn nhiều hơn', 'AI Coach đủ dùng để theo sát hằng ngày'].map((item) => (
                    <p key={item} className="premium-plan-benefit">
                      <span className="premium-plan-check premium-plan-check-plus">✓</span>
                      <span>{item}</span>
                    </p>
                  ))}
                </div>
              </article>

              <article className="premium-plan-card premium-plan-pro">
                <div className="premium-plan-head">
                  <h2>Pro</h2>
                  <div className="premium-plan-badges">
                    <span className="premium-plan-badge premium-plan-badge-pro">Đề xuất</span>
                  </div>
                </div>
                <div className="premium-plan-price-block">
                  <div className="premium-plan-promo-row">
                    <span className="premium-plan-old-price">đ149.000</span>
                    <span className="premium-plan-promo premium-plan-promo-pro">Giảm 30% lần mua đầu</span>
                  </div>
                  <div className="premium-plan-price-row">
                    <span className="premium-plan-currency">đ</span>
                    <span className="premium-plan-price">104.000</span>
                    <span className="premium-plan-period">VND / tháng đầu</span>
                  </div>
                  <p className="premium-plan-renew">Sau đó 149.000đ / tháng</p>
                </div>
                <p className="premium-plan-description">Dành cho người tập nghiêm túc, cần AI Coach theo sát hơn.</p>
                <button type="button" onClick={() => navigate('/signup')} className="premium-plan-cta premium-plan-cta-pro">
                  Chọn Pro
                </button>
                <div className="premium-plan-benefits">
                  <p className="premium-plan-feature-intro">Mọi tính năng trong Plus, và:</p>
                  {['Giới hạn sử dụng cao hơn nhiều so với Plus', 'Tạo lịch thêm linh hoạt hơn mỗi tháng', 'Tạo lại bài tập và thực đơn thoải mái hơn', 'AI Coach theo sát hơn với 800 tin nhắn/tháng', 'Phù hợp người tập nghiêm túc hoặc đổi lịch thường xuyên'].map((item) => (
                    <p key={item} className="premium-plan-benefit">
                      <span className="premium-plan-check premium-plan-check-pro">✓</span>
                      <span>{item}</span>
                    </p>
                  ))}
                </div>
              </article>
            </div>
          </ScrollReveal>
        </section>

        <section className="landing-lower-section py-20 md:py-28">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionHeading
              eyebrow="Người dùng nói gì"
              title="Thói quen nhỏ, kết quả rõ hơn"
              description="Một vài phản hồi tiêu biểu từ những người dùng Fitly để giữ nhịp tập luyện và ăn uống mỗi ngày."
            />
            <div className="mt-11 grid grid-cols-1 gap-4 md:grid-cols-3">
              {testimonials.map((testimonial) => (
                <article key={testimonial.name} className="landing-card landing-soft-card flex min-h-[13rem] flex-col rounded-lg border border-border-primary p-5 sm:p-6">
                  <div className="flex items-center gap-1 text-accent" aria-label="5 sao">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Star key={index} className="h-4 w-4 fill-current" />
                    ))}
                  </div>
                  <p className="mt-5 text-sm font-semibold leading-7 text-text-secondary">
                    “{testimonial.quote}”
                  </p>
                  <div className="mt-auto border-t border-border-primary pt-5">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-accent/35 bg-accent/10 text-xs font-black text-accent">
                          {testimonial.initials}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-text-primary">{testimonial.name}</p>
                          <p className="mt-0.5 truncate text-[11px] font-semibold text-text-tertiary">{testimonial.role}</p>
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-accent">
                        {testimonial.result}
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="landing-lower-section scroll-mt-24 py-20 md:py-28">
          <ScrollReveal className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
            <SectionHeading eyebrow="Câu hỏi thường gặp" title="Bạn muốn biết thêm?" />
            <div className="mx-auto mt-10 grid max-w-3xl gap-2.5 text-left sm:gap-3">
              {faqs.map(([question, answer]) => (
                <details
                  key={question}
                  className="group overflow-hidden rounded-[18px] border border-border-primary bg-bg-secondary/55 transition-colors hover:border-border-secondary open:bg-bg-secondary"
                >
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-black text-text-primary marker:hidden sm:px-6 [&::-webkit-details-marker]:hidden">
                    <span>{question}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-text-tertiary transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="border-t border-border-primary px-5 pb-5 pt-4 text-sm font-semibold leading-7 text-text-secondary sm:px-6">
                    {answer}
                  </p>
                </details>
              ))}
            </div>
          </ScrollReveal>
        </section>

        <section className="landing-lower-section py-20 md:py-24">
          <ScrollReveal className="mx-auto w-full max-w-5xl px-4 text-center sm:px-6 lg:px-8">
            <h2 className="landing-section-title mx-auto max-w-4xl font-black tracking-normal text-text-primary">
              Sẵn sàng bắt đầu?
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-base font-semibold leading-8 text-text-secondary">
              Tạo tài khoản miễn phí và để Fitly chuẩn bị kế hoạch tập luyện, ăn uống phù hợp với mục tiêu của bạn.
            </p>
            <div className="mt-8">
              <PrimaryButton onClick={() => navigate('/signup')}>Bắt đầu miễn phí</PrimaryButton>
            </div>
          </ScrollReveal>
        </section>
      </main>

      <footer className="landing-footer-section py-12">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-8 px-4 sm:px-6 md:grid-cols-[1fr_0.8fr_0.8fr_0.8fr] lg:px-8">
          <div>
            <div className="flex items-center gap-3">
              <Link to="/" aria-label="Fitly — Trang chủ"><FitlyLogo /></Link>
            </div>
          </div>
          <div>
            <p className="text-sm font-black text-text-primary">Sản phẩm</p>
            <div className="mt-4 space-y-2 text-sm font-semibold text-text-tertiary">
              <p>Hôm nay</p>
              <p>AI Coach</p>
              <p>Bài tập</p>
              <p>Thực đơn</p>
              <p>Tiến độ</p>
              <p>Thử thách</p>
            </div>
          </div>
          <div>
            <p className="text-sm font-black text-text-primary">Hỗ trợ</p>
            <div className="mt-4 space-y-2 text-sm font-semibold text-text-tertiary">
              <button
                type="button"
                onClick={() => document.getElementById('faq')?.scrollIntoView({ behavior: 'smooth' })}
                className="block text-left transition-colors hover:text-accent"
              >
                Câu hỏi thường gặp
              </button>
              <p>Liên hệ</p>
              <Link to="/privacy" className="block transition-colors hover:text-accent">
                Chính sách bảo mật
              </Link>
              <Link to="/terms" className="block transition-colors hover:text-accent">
                Điều khoản dịch vụ
              </Link>
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
