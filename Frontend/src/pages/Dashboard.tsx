import { Suspense, useState, useEffect } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import TopBar from '../layout/TopBar';
import SurveyForm, { type SurveyPlanSummary } from '../components/SurveyForm';
import SurveyResultScreen from '../components/SurveyResultScreen';
import MealSurveyForm, { type MealSurveySelection } from '../components/MealSurveyForm';
import NutritionResultScreen, { type NutritionResult } from '../components/NutritionResultScreen';
import ProfileCompletionNudge from '../components/ProfileCompletionNudge';
import ProfileSupplementModal from '../components/ProfileSupplementModal';
import ChangePasswordModal from '../components/ChangePasswordModal';
import { useAuth } from '../contexts/AuthContext';
import LoadingScreen from '../components/LoadingScreen';
import { fetchWithAuth } from '../lib/Api';
import { getApiErrorMessage } from '../lib/ErrorMessage';
import { supabase } from '../lib/Supabase';

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';

const getVietnamDateKey = (date = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

const getWeekStartKey = (baseDate: Date): string => {
  const date = new Date(baseDate);
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  return getVietnamDateKey(date);
};

const formatNumber = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');

const formatExerciseDetail = (item: any) => {
  const sets = Number(item.sets || item.planned_sets || 0);
  const reps = String(item.reps || item.planned_reps || '').trim();
  const weightKg = Number(item.weight_kg || item.planned_weight_kg || 0);
  const restSeconds = Number(item.rest_seconds || item.planned_rest_seconds || 0);
  const parts: string[] = [];

  if (sets > 0 && reps && reps !== '0') parts.push(`${sets} hiệp x ${reps}`);
  if (weightKg > 0) parts.push(`${formatNumber(weightKg)} kg`);
  if (restSeconds > 0) parts.push(`nghỉ ${restSeconds}s`);

  return parts.join(' · ') || 'Theo hướng dẫn AI';
};

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isProfileSupplementOpen, setIsProfileSupplementOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const { isLoggedIn, hasProfile, isCheckingProfile, refreshProfile } = useAuth();

  const [hasShownSurvey, setHasShownSurvey] = useState(false);
  const [surveyPlanSummary, setSurveyPlanSummary] = useState<SurveyPlanSummary | null>(null);
  const [isGeneratingSurveyPlan, setIsGeneratingSurveyPlan] = useState(false);
  const [surveyPlanError, setSurveyPlanError] = useState('');
  const [nutritionResult, setNutritionResult] = useState<NutritionResult | null>(null);
  const [isGeneratingNutritionPlan, setIsGeneratingNutritionPlan] = useState(false);
  const [nutritionPlanError, setNutritionPlanError] = useState('');

  // Keep track if we've already shown the survey to prevent unmounting it during background profile checks (like when switching tabs)
  useEffect(() => {
    if (isLoggedIn && !hasProfile && !isCheckingProfile) {
      setHasShownSurvey(true);
    }
    if (!isLoggedIn) {
      setHasShownSurvey(false);
      setSurveyPlanSummary(null);
      setSurveyPlanError('');
      setIsGeneratingSurveyPlan(false);
      setNutritionResult(null);
      setIsGeneratingNutritionPlan(false);
      setNutritionPlanError('');
    }
  }, [isLoggedIn, hasProfile, isCheckingProfile]);

  const generateSevenDayWorkoutPreview = async (summary: SurveyPlanSummary) => {
    const todayKey = getVietnamDateKey();
    const weekStartKey = getWeekStartKey(new Date(`${todayKey}T00:00:00`));
    const todayDayIndex = 0;

    const response = await fetchWithAuth('/api/ai-coach/generate-weekly-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekStartDate: weekStartKey, planScope: 'workout_only' }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(getApiErrorMessage({
        status: response.status,
        payload,
        fallbackMessage: 'Không thể tạo lịch tập AI 7 ngày. Vui lòng thử lại sau.',
        fallbackByStatus: {
          503: 'AI đang quá tải khi tạo lịch tập 7 ngày. Vui lòng thử lại sau ít phút.'
        }
      }));
    }

    const weeklyPlanId = payload?.data?.weeklyPlanId;
    if (!weeklyPlanId) {
      throw new Error('AI đã tạo lịch nhưng thiếu mã kế hoạch để tải preview.');
    }

    const workoutRes = await supabase
      .from('weekly_plan_exercises')
      .select(`
        day_of_week,
        exercise_id,
        sets,
        reps,
        weight_kg,
        rest_seconds,
        planned_sets,
        planned_reps,
        planned_weight_kg,
        planned_rest_seconds,
        order_index,
        is_rest_day,
        exercises:exercise_id (name, body_part, target_muscle)
      `)
      .eq('weekly_plan_id', weeklyPlanId)
      .eq('day_of_week', todayDayIndex)
      .order('order_index', { ascending: true });

    if (workoutRes.error) throw workoutRes.error;

    const prescribedWeeklyWorkouts = Math.max(2, Math.min(5, Number(payload?.data?.trainingPrescription?.weeklyWorkouts) || 3));
    const prescribedDurationMinutes = Math.max(20, Math.min(60, Number(payload?.data?.trainingPrescription?.durationMinutes) || 45));

    const workoutRows = ((workoutRes.data || []) as any[]).filter((item) => !item.is_rest_day && item.exercise_id);
    const todayExercises = workoutRows.length > 0
      ? workoutRows.map((item) => ({
          name: item.exercises?.name || 'Bài tập',
          detail: formatExerciseDetail(item),
        }))
      : [{ name: 'Ngày nghỉ phục hồi', detail: 'AI xếp hôm nay là ngày nghỉ trong lịch 7 ngày.' }];

    setSurveyPlanSummary({
      ...summary,
      frequency: `Fitly đề xuất ${prescribedWeeklyWorkouts} buổi/tuần`,
      duration: `${prescribedDurationMinutes} phút / buổi`,
      weeklyWorkouts: prescribedWeeklyWorkouts,
      todayDuration: workoutRows.length > 0 ? `${prescribedDurationMinutes} phút` : 'Nghỉ phục hồi',
      todayWorkout: workoutRows.length > 0 ? 'Lịch tập hôm nay' : 'Ngày nghỉ phục hồi',
      todayExercises,
      todayMeals: [],
      hasAiWorkoutPreview: true,
    });
  };

  const handleSurveyComplete = async (summary?: SurveyPlanSummary) => {
    if (summary) {
      setSurveyPlanSummary(summary);
      setSurveyPlanError('');
      setIsGeneratingSurveyPlan(true);
    }
    await refreshProfile();
    if (!summary) return;

    try {
      await generateSevenDayWorkoutPreview(summary);
      await refreshProfile();
    } catch (err: any) {
      setSurveyPlanError(err?.message || 'Không thể tạo lịch tập AI 7 ngày.');
    } finally {
      setIsGeneratingSurveyPlan(false);
    }
    navigate('/assessment');
  };

  const continueToMealSurvey = () => {
    navigate('/assessment/meals');
  };

  const completeMealSurvey = async (selection: MealSurveySelection) => {
    setNutritionPlanError('');
    setIsGeneratingNutritionPlan(true);
    setNutritionResult(null);

    try {
      const todayKey = getVietnamDateKey();
      const weekStartDate = getWeekStartKey(new Date(`${todayKey}T00:00:00`));
      const response = await fetchWithAuth('/api/ai-coach/generate-onboarding-meal-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStartDate }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(getApiErrorMessage({
          status: response.status,
          payload,
          fallbackMessage: 'Không thể tạo thực đơn AI 7 ngày. Vui lòng thử lại.',
          fallbackByStatus: {
            409: 'Lịch tập 7 ngày chưa sẵn sàng. Vui lòng quay lại trang khảo sát và thử lại.',
            503: 'AI đang quá tải, vui lòng thử lại sau vài phút.',
          }
        }));
      }

      const foodPlanId = payload?.data?.foodPlanId;
      if (!foodPlanId) throw new Error('AI chưa trả về thực đơn 7 ngày.');
      const { data: foodRows, error } = await supabase
        .from('weekly_food_items')
        .select('day_of_week, meal_type, quantity, order_index, recipe_id, recipes:recipe_id(name)')
        .eq('food_plan_id', foodPlanId)
        .eq('is_rest_day', false)
        .order('day_of_week', { ascending: true })
        .order('meal_type', { ascending: true })
        .order('order_index', { ascending: true });
      if (error) throw error;

      const grouped = Array.from({ length: 7 }, (_, day) => ({ day, meals: [] as NutritionResult['days'][number]['meals'] }));
      (foodRows || []).forEach((row: any) => {
        const day = Number(row.day_of_week);
        if (day < 0 || day > 6) return;
        grouped[day].meals.push({
          mealType: String(row.meal_type || ''),
          name: row.recipes?.name || 'Món ăn AI chọn',
          quantity: Number(row.quantity || 1),
        });
      });
      setNutritionResult({
        ...selection,
        targetCalories: Number(payload?.data?.ai_json?.meal_plan?.target_calories) || null,
        explanation: String(payload?.data?.ai_json?.meal_plan?.explanation || ''),
        days: grouped,
        macroTargets: payload?.data?.nutritionTargets || null,
      });
      await refreshProfile();
      navigate('/nutrition-assessment');
    } catch (err: any) {
      setNutritionPlanError(err?.message || 'Không thể tạo thực đơn AI 7 ngày.');
      // Không re-throw để MealSurveyForm hiển thị lỗi mà không reset form
      throw err;
    } finally {
      setIsGeneratingNutritionPlan(false);
    }
  };

  const openProfileSupplement = () => {
    setIsProfileSupplementOpen(true);
  };

  // Ưu tiên 1: Nếu đang ở trang survey → xử lý riêng, không bị loading state phía dưới block
  if (location.pathname === '/assessment/survey') {
    // Chưa biết trạng thái đăng nhập (auth đang resolve)
    if (isCheckingProfile && !isLoggedIn) {
      return <LoadingScreen fullScreen />;
    }
    // Chưa đăng nhập hẳn: redirect về trang chủ
    if (!isLoggedIn) {
      return <Navigate to="/" replace />;
    }
    // Đã đăng nhập: hiện survey
    return <SurveyForm onComplete={handleSurveyComplete} />;
  }

  // Ưu tiên 2: Loading state - chỉ hiện khi chưa có profile VÀ chưa ở trang survey
  if (isCheckingProfile && !hasProfile && !hasShownSurvey) {
    return <LoadingScreen fullScreen />;
  }

  if (isLoggedIn && surveyPlanSummary && isGeneratingSurveyPlan && location.pathname !== '/assessment') {
    return <LoadingScreen fullScreen />;
  }

  if (isLoggedIn && isGeneratingNutritionPlan && location.pathname !== '/nutrition-assessment' && location.pathname !== '/assessment/meals') {
    return <LoadingScreen fullScreen />;
  }

  if (isLoggedIn && surveyPlanSummary && (location.pathname === '/assessment' || location.pathname === '/assessment/meals')) {
    if (location.pathname === '/assessment/meals') {
      return <MealSurveyForm isGenerating={isGeneratingNutritionPlan} onComplete={completeMealSurvey} onBack={() => navigate(-1)} />;
    }

    return (
      <SurveyResultScreen
        summary={surveyPlanSummary}
        isGeneratingPlan={isGeneratingSurveyPlan}
        onStart={continueToMealSurvey}
      />
    );
  }

  if (isLoggedIn && nutritionResult && location.pathname === '/nutrition-assessment') {
    return (
      <NutritionResultScreen
        result={nutritionResult}
        isGenerating={isGeneratingNutritionPlan}
        error={nutritionPlanError}
        onOpenPlan={() => {
          setNutritionResult(null);
          setSurveyPlanSummary(null);
          navigate('/overview');
        }}
      />
    );
  }

  // 2. Nếu đã đăng nhập nhưng chưa có Profile -> Bắt buộc làm Survey
  if (isLoggedIn && !hasProfile) {
    return <Navigate to="/assessment/survey" replace />;
  }

  // 3. Nếu đã có Profile hoặc chưa đăng nhập (guest) -> Hiện Dashboard bình thường
  if (!isLoggedIn) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="app-shell flex h-[100dvh] w-full overflow-hidden bg-bg-primary">
      <ProfileSupplementModal
        isOpen={isProfileSupplementOpen}
        onClose={() => setIsProfileSupplementOpen(false)}
      />

      {/* Password Change Modal */}
      <ChangePasswordModal 
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
      />

      <div className="app-scroll-region flex-1 flex h-full min-w-0 w-full flex-col overflow-y-auto custom-scrollbar">
        <TopBar />
        <main className="dashboard-main flex min-h-0 flex-1 flex-col gap-6 bg-bg-primary px-4 pb-4 pt-5 md:px-6 md:pb-6 md:pt-7 lg:px-7 min-w-0 relative">
          <div className="dashboard-content mx-auto w-full min-w-0">
            <ProfileCompletionNudge onOpenProfile={openProfileSupplement} />
            <Suspense fallback={null}>
              <Outlet context={{ onPasswordClick: () => setIsPasswordModalOpen(true) }} />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
