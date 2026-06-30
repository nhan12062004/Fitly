import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Dumbbell,
  Loader2,
  Utensils,
} from 'lucide-react';
import type { SurveyPlanSummary } from './SurveyForm';

interface SurveyResultScreenProps {
  summary: SurveyPlanSummary;
  isGeneratingPlan?: boolean;
  generationError?: string;
  onStart: () => void;
}

export default function SurveyResultScreen({
  summary,
  isGeneratingPlan = false,
  generationError = '',
  onStart
}: SurveyResultScreenProps) {
  const exerciseItems = summary.todayExercises?.length
    ? summary.todayExercises
    : [{ name: summary.todayWorkout, detail: summary.todayDuration }];
  const mealItems = summary.todayMeals?.length
    ? summary.todayMeals
    : [{ label: 'Thực đơn', dish: summary.meals, detail: 'Chi tiết món sẽ được cá nhân hóa trong app' }];

  return (
    <div className="min-h-[100dvh] w-full bg-bg-primary px-3 py-3 text-text-primary sm:px-5 sm:py-5 lg:px-10">
      <div className="mx-auto flex min-h-[calc(100dvh-24px)] w-full max-w-6xl flex-col justify-center sm:min-h-[calc(100dvh-40px)]">
        <section>
          <div className="rounded-[24px] border border-border-primary bg-bg-primary/45 p-4 sm:p-5 md:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-accent">Hôm nay</p>
                <h2 className="mt-2 text-xl font-black tracking-tight text-text-primary sm:text-2xl">
                  Ngày đầu tiên được chuẩn bị cho bạn
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-border-primary bg-bg-secondary px-3 py-2 text-xs font-black text-text-primary">
                  <Clock3 className="h-3.5 w-3.5 text-accent" />
                  {summary.todayDuration}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-border-primary bg-bg-secondary px-3 py-2 text-xs font-black text-text-primary">
                  <Utensils className="h-3.5 w-3.5 text-accent" />
                  {summary.meals}
                </span>
              </div>
            </div>

            {isGeneratingPlan ? (
              <div className="mt-4 flex items-center gap-3 rounded-2xl border border-ai/20 bg-ai/10 p-4 text-ai">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                <div>
                  <p className="text-sm font-black">AI đang tạo lịch 7 ngày và lưu vào hồ sơ</p>
                  <p className="mt-1 text-xs font-semibold text-text-secondary">
                    Preview hôm nay sẽ tự cập nhật thành bài tập và thực đơn thật sau khi tạo xong.
                  </p>
                </div>
              </div>
            ) : null}

            {generationError ? (
              <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
                <p className="text-sm font-black text-red-400">Chưa tạo được lịch AI 7 ngày</p>
                <p className="mt-1 text-xs font-semibold leading-5 text-text-secondary">{generationError}</p>
              </div>
            ) : null}

            <div className="mt-5 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
              <div className="rounded-2xl border border-border-primary bg-bg-secondary/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-text-tertiary">Bài tập hôm nay</p>
                    <p className="mt-1 text-lg font-black text-text-primary">Gồm {exerciseItems.length} bài tập hôm nay</p>
                  </div>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
                    <Dumbbell className="h-4 w-4" />
                  </span>
                </div>

                <div className="mt-4 space-y-2.5">
                  {exerciseItems.map((exercise, index) => (
                    <div key={`${exercise.name}-${index}`} className="flex items-start gap-3 rounded-xl border border-border-primary bg-bg-primary/55 p-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent text-xs font-black text-text-inverse">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-black text-text-primary">{exercise.name}</p>
                        <p className="mt-0.5 text-xs font-semibold leading-5 text-text-secondary">{exercise.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-border-primary bg-bg-secondary/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-text-tertiary">Thực đơn hôm nay</p>
                    <p className="mt-1 text-lg font-black text-text-primary">Gồm {mealItems.length} bữa hôm nay</p>
                  </div>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
                    <Utensils className="h-4 w-4" />
                  </span>
                </div>

                <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                  {mealItems.map((meal, index) => (
                    <div key={`${meal.label}-${index}`} className="rounded-xl border border-border-primary bg-bg-primary/55 p-3">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />
                        <p className="text-xs font-black uppercase tracking-[0.1em] text-text-tertiary">{meal.label}</p>
                      </div>
                      <p className="mt-2 text-sm font-black leading-5 text-text-primary">{meal.dish}</p>
                      <p className="mt-1 text-xs font-semibold leading-5 text-text-secondary">{meal.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-accent/15 bg-accent/8 p-4">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-accent">Gợi ý</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-text-secondary">
                Bắt đầu bằng đúng bài tập và thực đơn này trong vài ngày đầu, sau đó bạn có thể tinh chỉnh lại mục tiêu, cường độ và bữa ăn trong hồ sơ.
              </p>
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={onStart}
              disabled={isGeneratingPlan}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-6 py-4 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
            >
              {isGeneratingPlan ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Đang tạo lịch 7 ngày
                </>
              ) : (
                <>
                  Bắt đầu ngày đầu tiên
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
