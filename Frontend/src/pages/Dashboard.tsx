import { Suspense, useState, useEffect } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import Sidebar from '../layout/Sidebar';
import TopBar from '../layout/TopBar';
import SurveyForm, { type SurveyPlanSummary } from '../components/SurveyForm';
import SurveyResultScreen from '../components/SurveyResultScreen';
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
  const day = baseDate.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const date = new Date(baseDate);
  date.setDate(baseDate.getDate() + diff);
  return getVietnamDateKey(date);
};

const getVietnamDayIndex = () => {
  const todayKey = getVietnamDateKey();
  const today = new Date(`${todayKey}T00:00:00`);
  const day = today.getDay();
  return day === 0 ? 6 : day - 1;
};

const mealLabelMap: Record<string, string> = {
  breakfast: 'Bữa sáng',
  lunch: 'Bữa trưa',
  snack: 'Bữa phụ',
  dinner: 'Bữa tối',
};

const mealOrder: Record<string, number> = {
  breakfast: 0,
  lunch: 1,
  snack: 2,
  dinner: 3,
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

const buildMealPreview = (items: any[]): SurveyPlanSummary['todayMeals'] => {
  const groups = new Map<string, any[]>();

  items
    .filter((item) => !item.is_rest_day && item.food_id)
    .forEach((item) => {
      const mealType = String(item.meal_type || 'lunch');
      groups.set(mealType, [...(groups.get(mealType) || []), item]);
    });

  return [...groups.entries()]
    .sort(([a], [b]) => (mealOrder[a] ?? 99) - (mealOrder[b] ?? 99))
    .map(([mealType, rows]) => {
      const dish = rows
        .map((row) => {
          const name = row.foods?.name || 'Món ăn';
          const quantity = Number(row.quantity || 1);
          return quantity && quantity !== 1 ? `${name} x${formatNumber(quantity)}` : name;
        })
        .join(' + ');
      const calories = rows.reduce((sum, row) => sum + Number(row.calories || 0) * Number(row.quantity || 1), 0);
      const protein = rows.reduce((sum, row) => sum + Number(row.protein || 0) * Number(row.quantity || 1), 0);

      return {
        label: mealLabelMap[mealType] || mealType,
        dish,
        detail: `${Math.round(calories)} kcal · ${Math.round(protein)}g protein`,
      };
    });
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileSupplementOpen, setIsProfileSupplementOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const { isLoggedIn, hasProfile, isCheckingProfile, refreshProfile } = useAuth();

  const [hasShownSurvey, setHasShownSurvey] = useState(false);
  const [surveyPlanSummary, setSurveyPlanSummary] = useState<SurveyPlanSummary | null>(null);
  const [isGeneratingSurveyPlan, setIsGeneratingSurveyPlan] = useState(false);
  const [surveyPlanError, setSurveyPlanError] = useState('');

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
    }
  }, [isLoggedIn, hasProfile, isCheckingProfile]);

  const generateSevenDayPlanPreview = async (summary: SurveyPlanSummary) => {
    const todayKey = getVietnamDateKey();
    const weekStartKey = getWeekStartKey(new Date(`${todayKey}T00:00:00`));
    const todayDayIndex = getVietnamDayIndex();

    const response = await fetchWithAuth('/api/ai-coach/generate-weekly-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekStartDate: weekStartKey }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(getApiErrorMessage({
        status: response.status,
        payload,
        fallbackMessage: 'Không thể tạo lịch AI 7 ngày. Vui lòng thử lại sau.',
        fallbackByStatus: {
          503: 'AI đang quá tải khi tạo lịch 7 ngày. Vui lòng thử lại sau ít phút.'
        }
      }));
    }

    const weeklyPlanId = payload?.data?.weeklyPlanId;
    const foodPlanId = payload?.data?.foodPlanId;
    if (!weeklyPlanId || !foodPlanId) {
      throw new Error('AI đã tạo lịch nhưng thiếu mã kế hoạch để tải preview.');
    }

    const [workoutRes, foodRes] = await Promise.all([
      supabase
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
        .order('order_index', { ascending: true }),
      supabase
        .from('weekly_food_items')
        .select('day_of_week, meal_type, food_id, quantity, calories, protein, carbs, fat, order_index, is_rest_day, foods:food_id (name, category, serving_unit)')
        .eq('food_plan_id', foodPlanId)
        .eq('day_of_week', todayDayIndex)
        .order('order_index', { ascending: true }),
    ]);

    if (workoutRes.error) throw workoutRes.error;
    if (foodRes.error) throw foodRes.error;

    const workoutRows = ((workoutRes.data || []) as any[]).filter((item) => !item.is_rest_day && item.exercise_id);
    const todayExercises = workoutRows.length > 0
      ? workoutRows.map((item) => ({
          name: item.exercises?.name || 'Bài tập',
          detail: formatExerciseDetail(item),
        }))
      : [{ name: 'Ngày nghỉ phục hồi', detail: 'AI xếp hôm nay là ngày nghỉ trong lịch 7 ngày.' }];
    const todayMeals = buildMealPreview((foodRes.data || []) as any[]);

    setSurveyPlanSummary({
      ...summary,
      todayWorkout: workoutRows.length > 0 ? 'Lịch tập hôm nay' : 'Ngày nghỉ phục hồi',
      meals: todayMeals.length > 0 ? `${todayMeals.length} bữa hôm nay` : summary.meals,
      todayExercises,
      todayMeals: todayMeals.length > 0 ? todayMeals : summary.todayMeals,
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
      await generateSevenDayPlanPreview(summary);
      await refreshProfile();
    } catch (err: any) {
      setSurveyPlanError(err?.message || 'Không thể tạo lịch AI 7 ngày.');
    } finally {
      setIsGeneratingSurveyPlan(false);
    }
  };

  const startFirstDay = () => {
    setSurveyPlanSummary(null);
    setSurveyPlanError('');
    navigate('/overview', { replace: true });
  };

  const openProfileEditor = () => {
    navigate('/profile');
  };

  const openProfileSupplement = () => {
    setIsProfileSupplementOpen(true);
  };

  const refineProfileAfterSurvey = () => {
    setSurveyPlanSummary(null);
    setSurveyPlanError('');
    navigate('/overview', { replace: true });
    openProfileSupplement();
  };

  // 1. Loading state - Chỉ hiện LoadingScreen toàn màn hình nếu đây là lần đầu kiểm tra và chưa có profile
  // Nếu đã có profile (đang refresh) hoặc đã hiện SurveyForm thì giữ nguyên UI để tránh flickering
  if (isCheckingProfile && !hasProfile && !hasShownSurvey) {
    return <LoadingScreen fullScreen />;
  }

  if (isLoggedIn && surveyPlanSummary) {
    return (
      <SurveyResultScreen
        summary={surveyPlanSummary}
        isGeneratingPlan={isGeneratingSurveyPlan}
        generationError={surveyPlanError}
        onStart={startFirstDay}
        onRefineProfile={refineProfileAfterSurvey}
      />
    );
  }

  // 2. Nếu đã đăng nhập nhưng chưa có Profile -> Bắt buộc làm Survey
  if (isLoggedIn && !hasProfile) {
    return (
      <div className="min-h-[100dvh] w-full bg-bg-primary overflow-y-auto">
        <SurveyForm onComplete={handleSurveyComplete} />
      </div>
    );
  }

  // 3. Nếu đã có Profile hoặc chưa đăng nhập (guest) -> Hiện Dashboard bình thường
  if (!isLoggedIn) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-bg-primary">
      <ProfileSupplementModal
        isOpen={isProfileSupplementOpen}
        onClose={() => setIsProfileSupplementOpen(false)}
      />

      {/* Password Change Modal */}
      <ChangePasswordModal 
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
      />

      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
      
      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar 
          onClose={() => setIsMobileMenuOpen(false)} 
          onProfileClick={openProfileEditor} 
          onPasswordClick={() => setIsPasswordModalOpen(true)}
        />
      </div>

      <div className="flex-1 flex h-full min-w-0 w-full flex-col overflow-y-auto custom-scrollbar">
        <TopBar onMenuClick={() => setIsMobileMenuOpen(true)} />
        <main className="dashboard-main flex min-h-0 flex-1 flex-col gap-6 bg-bg-primary px-4 pb-4 pt-5 md:px-6 md:pb-6 md:pt-7 lg:px-7 min-w-0 relative">
          <div className="mx-auto w-full">
            <ProfileCompletionNudge onOpenProfile={openProfileSupplement} />
            <Suspense fallback={null}>
              <Outlet context={{ onProfileClick: openProfileEditor }} />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
