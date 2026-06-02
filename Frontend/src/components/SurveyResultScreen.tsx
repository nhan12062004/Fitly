import { ArrowRight, Dumbbell, Flame, MapPin, Target, Utensils, Zap } from 'lucide-react';
import type { SurveyPlanSummary } from './SurveyForm';

interface SurveyResultScreenProps {
  summary: SurveyPlanSummary;
  onStart: () => void;
}

const formatCalories = (value: number) => new Intl.NumberFormat('vi-VN').format(value);

export default function SurveyResultScreen({ summary, onStart }: SurveyResultScreenProps) {
  const planItems = [
    { label: 'Mục tiêu', value: summary.goal, icon: Target },
    { label: 'Trình độ', value: summary.experience, icon: Zap },
    { label: 'Tần suất', value: summary.frequency, icon: Dumbbell },
    { label: 'Thời lượng', value: summary.duration, icon: Flame },
    { label: 'Calo mục tiêu', value: `${formatCalories(summary.targetCalories)} kcal / ngày`, icon: Utensils },
    { label: 'Nơi tập', value: summary.location, icon: MapPin }
  ];

  return (
    <div className="min-h-screen w-full bg-bg-primary px-3 py-3 text-text-primary sm:px-5 sm:py-5 lg:px-10">
      <div className="mx-auto flex min-h-[calc(100vh-24px)] w-full max-w-6xl flex-col justify-center gap-4 sm:min-h-[calc(100vh-40px)] sm:gap-5">
        <div className="grid gap-4 md:grid-cols-[1.04fr_0.96fr] md:items-stretch lg:gap-5">
          <section className="rounded-[28px] border border-border-primary bg-bg-secondary p-5 shadow-[0_24px_80px_rgba(0,0,0,0.18)] md:p-7 lg:p-8">
            <div className="rounded-[24px] border border-white/6 bg-[linear-gradient(155deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))] p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <img src="/logo.svg" alt="Trợ lý cá nhân" className="h-11 w-11 shrink-0 sm:h-12 sm:w-12" />
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-accent">Trợ lý cá nhân</p>
                  <h1 className="mt-1 text-2xl font-black tracking-tight text-text-primary sm:text-3xl md:text-4xl">
                  Kế hoạch cá nhân của bạn đã sẵn sàng
                  </h1>
                </div>
              </div>
              <p className="mt-4 text-sm font-semibold leading-6 text-text-secondary">
                Đây là cấu hình mở đầu để bạn bắt đầu ngay hôm nay. Bạn vẫn có thể tinh chỉnh thêm sau khi vào app.
              </p>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {planItems.map(({ label, value, icon: Icon }) => (
                <div key={label} className="rounded-2xl border border-border-primary bg-bg-primary/65 p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-text-tertiary">{label}</p>
                      <p className="mt-1 text-sm font-black leading-5 text-text-primary">{value}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="flex flex-col justify-between rounded-[28px] border border-border-primary bg-bg-secondary p-5 md:p-7 lg:p-8">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-accent">Hôm nay</p>
              <h2 className="mt-3 text-xl font-black tracking-tight text-text-primary sm:text-2xl">
                Ngày đầu tiên được chuẩn bị cho bạn
              </h2>

              <div className="mt-6 space-y-3">
                <div className="rounded-2xl border border-border-primary bg-bg-primary/65 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-text-tertiary">Bài tập</p>
                  <p className="mt-1 text-lg font-black text-text-primary">{summary.todayWorkout}</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-border-primary bg-bg-primary/65 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-text-tertiary">Thời gian</p>
                    <p className="mt-1 text-lg font-black text-text-primary">{summary.todayDuration}</p>
                  </div>
                  <div className="rounded-2xl border border-border-primary bg-bg-primary/65 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-text-tertiary">Thực đơn</p>
                    <p className="mt-1 text-lg font-black text-text-primary">{summary.meals}</p>
                  </div>
                </div>
                <div className="rounded-2xl border border-accent/15 bg-accent/8 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-accent">Gợi ý</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-text-secondary">
                    Bắt đầu bằng đúng nhịp này trong vài ngày đầu, sau đó bạn có thể điều chỉnh lại mục tiêu, cường độ và bữa ăn trong hồ sơ.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onStart}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-6 py-4 text-sm font-black text-black transition-colors hover:bg-accent-hover md:mt-8"
            >
              Bắt đầu ngày đầu tiên
              <ArrowRight className="h-4 w-4" />
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
