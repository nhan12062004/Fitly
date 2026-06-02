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
  Salad,
  ShieldCheck,
  Sparkles,
  Target,
  Utensils,
  Zap,
} from 'lucide-react';
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

const painPoints = [
  'Không biết hôm nay nên tập gì',
  'Không biết ăn gì để giảm cân hoặc tăng cơ',
  'Tập vài ngày rồi bỏ',
  'Không có nhiều thời gian',
  'Sợ tập sai kỹ thuật',
  'Không thấy mình tiến bộ',
];

const solutions = [
  ['Biết hôm nay tập gì', 'AI tạo bài tập theo mục tiêu, thể trạng, lịch trình và mức độ hiện tại của bạn.'],
  ['Biết hôm nay ăn gì', 'Thực đơn cá nhân hóa theo calories, protein, sở thích ăn uống và mức độ dễ chuẩn bị.'],
  ['Dễ duy trì', 'Có bài tập ngắn 10-30 phút cho người bận rộn hoặc người mới quay lại tập.'],
  ['AI điều chỉnh mỗi ngày', 'Nếu bạn mệt, đau, bận hoặc không thích món ăn, AI sẽ đề xuất thay đổi để bạn vẫn tiếp tục được.'],
];

const features = [
  'Lịch tập cá nhân hóa',
  'Thực đơn theo calories và protein',
  'AI Coach điều chỉnh bài tập, món ăn',
  'Theo dõi calories, protein, nước, giấc ngủ',
  'Báo cáo tiến độ tuần',
  'Nhắc nhở duy trì thói quen',
];

const audiences = [
  'Người mới tập gym',
  'Người muốn giảm cân',
  'Người muốn tăng cơ',
  'Người bận rộn',
  'Người từng bỏ tập',
  'Người không biết bắt đầu từ đâu',
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
      className="landing-action inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-accent px-6 text-sm font-black text-black transition-all hover:bg-accent-hover"
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
      className="inline-flex h-12 items-center justify-center rounded-lg border border-border-primary bg-bg-secondary px-6 text-sm font-black text-text-primary transition-all hover:border-accent/40 hover:text-accent"
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

  if (isLoggedIn) {
    return <Navigate to="/overview" replace />;
  }

  return (
    <div className="landing-page min-h-screen w-full min-w-0 max-w-[100vw] flex-1 basis-0 overflow-x-hidden bg-bg-primary text-text-primary">
      <header className="sticky top-0 z-40 border-b border-border-primary bg-bg-primary/88 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-3 py-3 sm:h-20 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-0 lg:px-8">
          <button type="button" onClick={() => navigate('/')} className="min-w-0 text-left">
            <p className="truncate text-base font-black text-text-primary sm:text-lg">Fitly - Trợ lý cá nhân</p>
            <p className="hidden text-xs font-semibold text-text-tertiary sm:block">
              Mở app là biết hôm nay tập gì và ăn gì.
            </p>
          </button>
          <div className="grid w-full shrink-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center sm:gap-3">
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-border-primary bg-bg-secondary px-3 text-xs font-bold text-text-primary transition-colors hover:border-accent/40 hover:text-accent sm:px-4 sm:text-sm"
            >
              Đăng nhập
            </button>
            <button
              type="button"
              onClick={() => navigate('/signup')}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-accent px-3 text-xs font-black text-black transition-colors hover:bg-accent-hover sm:px-5 sm:text-sm"
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
          <div className="mx-auto grid min-h-[calc(100vh-116px)] w-full max-w-7xl grid-cols-1 items-center gap-10 px-4 py-12 sm:min-h-[calc(100vh-80px)] sm:px-6 md:py-16 lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,0.78fr)] lg:px-8">
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
                <button type="button" onClick={() => navigate('/signup')} className="mt-6 h-11 rounded-lg bg-accent px-5 text-sm font-black text-black">
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
                <button type="button" onClick={() => navigate('/signup')} className="mt-6 h-11 rounded-lg border border-border-primary px-5 text-sm font-black text-text-primary">
                  Xem thực đơn mẫu
                </button>
              </div>

              <div className="landing-card ai-surface rounded-lg border p-5">
                <Bot className="h-6 w-6 text-ai" />
                <h2 className="mt-5 text-xl font-black text-text-primary">Gợi ý từ AI Coach</h2>
                <p className="mt-5 text-sm font-semibold leading-7 text-text-secondary">
                  Bạn là người mới? Tôi có thể tạo bài tập 10-25 phút và thực đơn dễ nấu để bạn bắt đầu mà không bị quá tải.
                </p>
                <button type="button" onClick={() => navigate('/signup')} className="mt-6 h-11 rounded-lg bg-ai px-5 text-sm font-black text-white transition-colors hover:bg-ai-hover">
                  Nhờ AI tạo kế hoạch
                </button>
              </div>
            </div>
          </ScrollReveal>
        </section>

        <section className="border-b border-border-primary bg-bg-primary py-16 md:py-20">
          <ScrollReveal className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-10 px-4 sm:px-6 lg:grid-cols-[0.85fr_1fr] lg:px-8">
            <div>
              <SectionLabel>Vấn đề</SectionLabel>
              <h2 className="mt-4 text-3xl font-black tracking-normal text-text-primary md:text-4xl">
                Bạn có đang gặp những vấn đề này?
              </h2>
              <p className="mt-5 text-base font-semibold leading-8 text-text-secondary">
                Fitly - Trợ lý cá nhân giúp bạn biến mục tiêu lớn thành việc nhỏ cần làm hôm nay.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {painPoints.map((item) => (
                <div key={item} className="landing-card landing-surface flex items-start gap-3 rounded-lg border border-border-primary p-4">
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                  <p className="text-sm font-bold text-text-secondary">{item}</p>
                </div>
              ))}
            </div>
          </ScrollReveal>
        </section>

        <section className="border-b border-border-primary bg-bg-secondary py-16 md:py-20">
          <ScrollReveal className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionLabel>Giải pháp</SectionLabel>
            <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {solutions.map(([title, desc], index) => (
                <div key={title} className="landing-card landing-soft-card rounded-lg border border-border-primary p-5">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/10 text-sm font-black text-accent">
                    {index + 1}
                  </span>
                  <h3 className="mt-5 text-lg font-black text-text-primary">{title}</h3>
                  <p className="mt-3 text-sm font-semibold leading-7 text-text-secondary">{desc}</p>
                </div>
              ))}
            </div>
          </ScrollReveal>
        </section>

        <section className="border-b border-border-primary bg-bg-primary py-16 md:py-20">
          <ScrollReveal className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-10 px-4 sm:px-6 lg:grid-cols-[0.88fr_1fr] lg:items-center lg:px-8">
            <div>
              <SectionLabel>Cách hoạt động</SectionLabel>
              <h2 className="mt-4 text-3xl font-black tracking-normal text-text-primary md:text-4xl">
                Mỗi ngày chỉ cần mở app.
              </h2>
              <div className="mt-8 space-y-5">
                {[
                  ['Nhập mục tiêu của bạn', 'Giảm cân, tăng cơ, giữ dáng hoặc bắt đầu lại thói quen tập luyện.'],
                  ['Nhận kế hoạch cá nhân', 'AI tạo lịch tập và thực đơn phù hợp với thể trạng, thời gian và sở thích của bạn.'],
                  ['Mỗi ngày chỉ cần mở app', 'Bạn biết hôm nay tập gì, ăn gì, và AI sẽ điều chỉnh nếu cần.'],
                ].map(([title, desc], index) => (
                  <div key={title} className="flex gap-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-black text-black">
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="text-base font-black text-text-primary">{title}</h3>
                      <p className="mt-1 text-sm font-semibold leading-6 text-text-secondary">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="landing-product-card landing-surface rounded-lg border border-border-primary p-5">
              <SectionLabel>AI Coach cá nhân</SectionLabel>
              <div className="mt-5 space-y-3">
                {[
                  'Hôm nay tôi mệt, đổi bài nhẹ hơn được không?',
                  'Tôi chỉ có 10 phút thì tập gì?',
                  'Tôi muốn đổi món trưa.',
                  'Tại sao tôi chưa giảm cân?',
                  'Tôi bỏ tập vài ngày rồi, bắt đầu lại thế nào?',
                ].map((message) => (
                  <div key={message} className="landing-soft-card flex items-start gap-3 rounded-lg border border-border-primary p-3">
                    <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-ai" />
                    <p className="text-sm font-semibold text-text-secondary">"{message}"</p>
                  </div>
                ))}
              </div>
              <div className="ai-surface mt-5 rounded-lg border p-4">
                <p className="text-sm font-bold leading-7 text-text-secondary">
                  AI không tự ý thay đổi kế hoạch của bạn. Mọi đề xuất đều được hiển thị rõ để bạn chọn Áp dụng hoặc Không áp dụng.
                </p>
              </div>
            </div>
          </ScrollReveal>
        </section>

        <section className="border-b border-border-primary bg-bg-secondary py-16 md:py-20">
          <ScrollReveal className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
            <div>
              <SectionLabel>Tính năng chính</SectionLabel>
              <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {features.map((item) => (
                  <div key={item} className="landing-card landing-soft-card flex items-center gap-3 rounded-lg border border-border-primary p-4">
                    <Zap className="h-5 w-5 shrink-0 text-accent" />
                    <p className="text-sm font-bold text-text-secondary">{item}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <SectionLabel>Dành cho ai</SectionLabel>
              <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {audiences.map((item) => (
                  <div key={item} className="landing-card landing-soft-card flex items-center gap-3 rounded-lg border border-border-primary p-4">
                    <Target className="h-5 w-5 shrink-0 text-warning" />
                    <p className="text-sm font-bold text-text-secondary">{item}</p>
                  </div>
                ))}
              </div>
              <p className="ai-surface mt-6 rounded-lg border p-4 text-sm font-bold leading-7 text-text-secondary">
                Không cần biết nhiều về gym hay dinh dưỡng. AI Coach sẽ biến mục tiêu của bạn thành kế hoạch dễ làm mỗi ngày.
              </p>
            </div>
          </ScrollReveal>
        </section>

        <section className="border-b border-border-primary bg-bg-primary py-16 md:py-20">
          <ScrollReveal className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionLabel>Demo giao diện</SectionLabel>
            <div className="landing-product-card landing-surface mt-8 rounded-lg border border-border-primary p-4 md:p-6">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                <div className="landing-soft-card rounded-lg border border-border-primary p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-accent">Trang hôm nay</p>
                      <h3 className="mt-2 text-2xl font-black text-text-primary">Tất cả trong một màn hình</h3>
                    </div>
                    <CalendarCheck className="h-7 w-7 text-accent" />
                  </div>
                  <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
                    {[
                      ['Bài tập', '~25 phút'],
                      ['Thực đơn', '1.650 kcal'],
                      ['Tiến độ', 'Nước · Ngủ · Protein'],
                    ].map(([title, desc]) => (
                      <div key={title} className="landing-soft-card rounded-lg border border-border-primary p-4">
                        <p className="text-sm font-black text-text-primary">{title}</p>
                        <p className="mt-2 text-xs font-semibold text-text-tertiary">{desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="landing-soft-card rounded-lg border border-border-primary p-5">
                  <div className="flex items-center gap-3">
                    <Bot className="h-6 w-6 text-ai" />
                    <h3 className="text-xl font-black text-text-primary">AI Coach chat</h3>
                  </div>
                  <div className="mt-5 space-y-3">
                    <p className="landing-soft-card rounded-lg border border-border-primary p-3 text-sm font-semibold text-text-secondary">Tôi chỉ có 10 phút hôm nay.</p>
                    <p className="ai-surface rounded-lg border p-3 text-sm font-semibold text-text-secondary">
                      Tôi đề xuất rút còn 3 bài chính. Bạn muốn áp dụng thay đổi này không?
                    </p>
                  </div>
                </div>
              </div>
              <p className="mt-4 text-sm font-semibold leading-7 text-text-secondary">
                Tất cả những gì bạn cần trong một màn hình: bài tập hôm nay, thực đơn hôm nay và gợi ý từ AI Coach.
              </p>
            </div>
          </ScrollReveal>
        </section>

        <section className="border-b border-border-primary bg-bg-secondary py-16 md:py-20">
          <ScrollReveal className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-4 px-4 sm:px-6 lg:grid-cols-3 lg:px-8">
            <div className="landing-card landing-soft-card rounded-lg border border-border-primary p-5">
              <BarChart3 className="h-6 w-6 text-accent" />
              <p className="mt-5 text-3xl font-black text-text-primary">10.000+</p>
              <p className="mt-2 text-sm font-semibold text-text-secondary">người đang xây dựng thói quen khỏe hơn mỗi ngày</p>
            </div>
            <div className="landing-card landing-soft-card rounded-lg border border-border-primary p-5">
              <Clock3 className="h-6 w-6 text-warning" />
              <p className="mt-5 text-sm font-semibold leading-7 text-text-secondary">
                "Trước đây tôi không biết hôm nay nên tập gì. App giúp tôi duy trì 4 buổi mỗi tuần mà không bị quá tải."
              </p>
            </div>
            <div className="landing-card landing-soft-card rounded-lg border border-border-primary p-5">
              <Salad className="h-6 w-6 text-info" />
              <p className="mt-5 text-sm font-semibold leading-7 text-text-secondary">
                "Thực đơn rõ ràng, dễ nấu, không còn phải tự nghĩ hôm nay ăn gì."
              </p>
            </div>
          </ScrollReveal>
        </section>

        <section className="border-b border-border-primary bg-bg-primary py-16 md:py-20">
          <ScrollReveal className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
            <ShieldCheck className="mx-auto h-8 w-8 text-accent" />
            <h2 className="mt-5 text-3xl font-black tracking-normal text-text-primary md:text-4xl">
              Sẵn sàng biết hôm nay nên tập gì và ăn gì?
            </h2>
            <p className="mt-4 text-base font-semibold leading-8 text-text-secondary">
              Bắt đầu miễn phí trong vài phút. Không cần thẻ tín dụng.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <PrimaryButton onClick={() => navigate('/signup')}>Bắt đầu miễn phí</PrimaryButton>
              <SecondaryButton onClick={() => document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' })}>
                Xem demo
              </SecondaryButton>
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
              <p>AI Coach</p>
              <p>Bài tập</p>
              <p>Thực đơn</p>
              <p>Tiến độ</p>
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
