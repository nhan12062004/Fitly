import { supabase } from '../config/Supabase';

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';

export type CoachQuickAction = {
  label: string;
  command: 'menu' | 'today' | 'workout' | 'meals' | 'health' | 'water' | 'sleep' | 'help' | 'clear';
  amountMl?: number;
  sleepHours?: number;
};

export type CoachCommandResult = {
  command: string;
  reply: string;
  responseMode?: 'coach_advice' | 'support';
  quickActions?: CoachQuickAction[];
  clearHistory?: boolean;
};

type ProfileLike = {
  id: string;
  full_name?: string | null;
};

const WATER_ACTIONS: CoachQuickAction[] = [
  { label: '+250ml', command: 'water', amountMl: 250 },
  { label: '+500ml', command: 'water', amountMl: 500 },
  { label: '+750ml', command: 'water', amountMl: 750 },
  { label: '+1000ml', command: 'water', amountMl: 1000 },
];

const SLEEP_ACTIONS: CoachQuickAction[] = [4, 5, 6, 7, 8, 9, 10].map((hours) => ({
  label: hours === 10 ? '10h+' : `${hours}h`,
  command: 'sleep',
  sleepHours: hours,
}));

export const getVietnamDateKey = (date = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value || '1970';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
};

export const addDaysToDateKey = (dateKey: string, days: number): string => {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const getWeekStartKey = (dateKey = getVietnamDateKey()): string => {
  const date = new Date(`${dateKey}T00:00:00`);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const getVietnamDayIndex = (dateKey = getVietnamDateKey()): number => {
  const day = new Date(`${dateKey}T00:00:00`).getDay();
  return day === 0 ? 6 : day - 1;
};

const formatNumber = (value: unknown, fallback = '?') => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? String(Math.round(numberValue * 10) / 10) : fallback;
};

const compactLines = (lines: string[], maxLines: number) => {
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines), `... và ${lines.length - maxLines} mục khác`];
};

const getProfile = async (userId: string): Promise<ProfileLike> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return { id: userId, full_name: data?.full_name || null };
};

export const updateDailyProgress = async (userId: string, updates: Record<string, number | string>) => {
  const today = getVietnamDateKey();
  const { data: existingLog, error: existingLogError } = await supabase
    .from('daily_progress_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('log_date', today)
    .limit(1)
    .maybeSingle();

  if (existingLogError) throw existingLogError;

  const saveResult = existingLog?.id
    ? await supabase.from('daily_progress_logs').update(updates).eq('id', existingLog.id)
    : await supabase.from('daily_progress_logs').insert({ user_id: userId, log_date: today, ...updates });

  if (saveResult.error) throw saveResult.error;
};

export const addWaterIntake = async (userId: string, amountMl: number) => {
  const today = getVietnamDateKey();
  const { data: existingLog, error: existingLogError } = await supabase
    .from('daily_progress_logs')
    .select('id, water_intake_ml')
    .eq('user_id', userId)
    .eq('log_date', today)
    .limit(1)
    .maybeSingle();

  if (existingLogError) throw existingLogError;

  const nextWaterIntakeMl = (existingLog?.water_intake_ml || 0) + amountMl;
  await updateDailyProgress(userId, { water_intake_ml: nextWaterIntakeMl });
  return nextWaterIntakeMl;
};

export const incrementDailyCalories = async (userId: string, calories: number) => {
  const today = getVietnamDateKey();
  const { data: existingLog, error } = await supabase
    .from('daily_progress_logs')
    .select('id, calories_consumed')
    .eq('user_id', userId)
    .eq('log_date', today)
    .maybeSingle();
  if (error) throw error;

  if (existingLog?.id) {
    const updateRes = await supabase
      .from('daily_progress_logs')
      .update({ calories_consumed: (Number(existingLog.calories_consumed) || 0) + calories })
      .eq('id', existingLog.id);
    if (updateRes.error) throw updateRes.error;
    return;
  }

  const insertRes = await supabase
    .from('daily_progress_logs')
    .insert({ user_id: userId, log_date: today, calories_consumed: calories });
  if (insertRes.error) throw insertRes.error;
};

export const getHydrationSnapshot = async (userId: string) => {
  const today = getVietnamDateKey();
  const [logRes, lifestyleRes] = await Promise.all([
    supabase.from('daily_progress_logs').select('water_intake_ml').eq('user_id', userId).eq('log_date', today).maybeSingle(),
    supabase.from('lifestyle_settings').select('daily_water_goal').eq('user_id', userId).maybeSingle(),
  ]);

  const currentMl = logRes.data?.water_intake_ml || 0;
  const goalMl = Math.round((lifestyleRes.data?.daily_water_goal || 2) * 1000);
  const percent = Math.min(100, Math.round((currentMl / Math.max(goalMl, 1)) * 100));
  return { today, currentMl, goalMl, percent };
};

export const getSleepSnapshot = async (userId: string) => {
  const today = getVietnamDateKey();
  const yesterday = addDaysToDateKey(today, -1);
  const [todayLogRes, yesterdayLogRes, healthRes] = await Promise.all([
    supabase.from('daily_progress_logs').select('sleep_hours').eq('user_id', userId).eq('log_date', today).maybeSingle(),
    supabase.from('daily_progress_logs').select('sleep_hours').eq('user_id', userId).eq('log_date', yesterday).maybeSingle(),
    supabase.from('health_conditions').select('sleep_hours, sleep_quality').eq('user_id', userId).maybeSingle(),
  ]);

  return {
    today,
    yesterday,
    todaySleepHours: todayLogRes.data?.sleep_hours || 0,
    yesterdaySleepHours: yesterdayLogRes.data?.sleep_hours || 0,
    targetSleepHours: Number(healthRes.data?.sleep_hours || 8),
    sleepQuality: healthRes.data?.sleep_quality || 'chưa ghi',
  };
};

export const buildHelpText = () =>
  [
    'Fitly AI Coach',
    'Các chức năng nhanh được thực hiện trực tiếp trong Fitly.',
    '',
    'Lệnh nhanh:',
    '/menu - mở bảng điều khiển',
    '/today - xem tiến độ hôm nay',
    '/water - ghi nhanh lượng nước',
    '/sleep - ghi nhanh giấc ngủ',
    '/workout - xem bài tập gần đây và hôm nay',
    '/meals - xem thực đơn hôm nay',
    '/health - xem chỉ số sức khỏe/hồ sơ',
    '/clear - xoá ngữ cảnh trò chuyện',
    '',
    'Bạn cũng có thể nhắn tự nhiên:',
    '- Tôi uống 500ml nước',
    '- Tôi ngủ 7.5h',
    '- Tôi vừa ăn 650 kcal',
    '- Hôm nay tôi nên tập gì?',
  ].join('\n');

export const buildTodaySummary = async (profile: ProfileLike) => {
  const today = getVietnamDateKey();
  const [lifestyle, todayLog, todaySessions] = await Promise.all([
    supabase.from('lifestyle_settings').select('daily_water_goal, target_calories').eq('user_id', profile.id).maybeSingle(),
    supabase.from('daily_progress_logs').select('*').eq('user_id', profile.id).eq('log_date', today).maybeSingle(),
    supabase.from('daily_exercise_sessions').select('is_completed').eq('user_id', profile.id).eq('log_date', today),
  ]);

  const waterMl = todayLog.data?.water_intake_ml || 0;
  const waterGoalMl = Math.round((lifestyle.data?.daily_water_goal || 2) * 1000);
  const calories = todayLog.data?.calories_consumed || 0;
  const targetCalories = lifestyle.data?.target_calories || 0;
  const sleepHours = todayLog.data?.sleep_hours || 0;
  const sessions = todaySessions.data || [];
  const completedSessions = sessions.filter((session: any) => session.is_completed).length;

  return [
    `Tiến độ hôm nay (${today})`,
    `Người dùng: ${profile.full_name || 'Bạn'}`,
    '',
    `Nước: ${waterMl} / ${waterGoalMl}ml`,
    `Calo nạp: ${calories}${targetCalories ? ` / ${targetCalories} kcal` : ' kcal'}`,
    `Ngủ: ${sleepHours ? `${sleepHours}h` : 'chưa ghi'}`,
    `Bài tập: ${completedSessions}/${sessions.length} hoàn thành`,
  ].join('\n');
};

export const buildWorkoutReport = async (profile: ProfileLike) => {
  const today = getVietnamDateKey();
  const dateKeys = [today, addDaysToDateKey(today, -1), addDaysToDateKey(today, -2)];
  const weekStartKey = getWeekStartKey(today);
  const todayDayIndex = getVietnamDayIndex(today);

  const [sessionsRes, plansRes] = await Promise.all([
    supabase
      .from('daily_exercise_sessions')
      .select('log_date, sets, reps, weight_kg, rest_seconds, is_completed, order_index, exercises:exercise_id(name, body_part, target_muscle)')
      .eq('user_id', profile.id)
      .in('log_date', dateKeys)
      .order('log_date', { ascending: false })
      .order('order_index', { ascending: true }),
    supabase.from('weekly_plans').select('id, name, week_start_date, created_at, updated_at').eq('user_id', profile.id).eq('week_start_date', weekStartKey).eq('plan_status', 'active').limit(20),
  ]);

  const latestPlan = ((plansRes.data || []) as any[]).sort((a, b) =>
    new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime()
  )[0];

  const planItemsRes = latestPlan?.id
    ? await supabase
      .from('weekly_plan_exercises')
      .select('day_of_week, sets, reps, weight_kg, rest_seconds, order_index, is_rest_day, exercises:exercise_id(name, body_part, target_muscle)')
      .eq('weekly_plan_id', latestPlan.id)
      .order('day_of_week', { ascending: true })
      .order('order_index', { ascending: true })
    : { data: [] };

  const sessions = (sessionsRes.data || []) as any[];
  const planItems = (planItemsRes.data || []) as any[];
  const recentLines = dateKeys.map((dateKey) => {
    const items = sessions.filter((item) => item.log_date === dateKey);
    if (items.length === 0) return `${dateKey}: chưa có bài tập được ghi.`;
    const done = items.filter((item) => item.is_completed).length;
    const names = compactLines(items.map((item) => {
      const exercise = item.exercises as any;
      return `${item.is_completed ? 'Đã xong' : 'Chưa xong'} ${exercise?.name || 'Bài tập'} ${item.sets || 0}x${item.reps || '-'} ${item.weight_kg || 0}kg`;
    }), 8).join('; ');
    return `${dateKey}: ${done}/${items.length} hoàn thành - ${names}`;
  });
  const todayPlan = compactLines(
    planItems
      .filter((item) => item.day_of_week === todayDayIndex && !item.is_rest_day)
      .map((item) => {
        const exercise = item.exercises as any;
        return `- ${exercise?.name || 'Bài tập'}: ${item.sets || 0}x${item.reps || '-'}, ${item.weight_kg || 0}kg, nghỉ ${item.rest_seconds || 60}s`;
      }),
    10
  );

  return [
    `Bài tập của ${profile.full_name || 'bạn'}`,
    '',
    '3 ngày gần nhất:',
    ...recentLines,
    '',
    `Lịch hôm nay (${today})${latestPlan?.name ? ` - ${latestPlan.name}` : ''}:`,
    todayPlan.length ? todayPlan.join('\n') : 'Chưa có lịch tập hôm nay trong Fitly.',
  ].join('\n');
};

export const buildMealReport = async (profile: ProfileLike) => {
  const today = getVietnamDateKey();
  const weekStartKey = getWeekStartKey(today);
  const todayDayIndex = getVietnamDayIndex(today);

  const plansRes = await supabase
    .from('weekly_food_plans')
    .select('id, name, week_start_date, created_at, updated_at')
    .eq('user_id', profile.id)
    .eq('week_start_date', weekStartKey)
    .eq('plan_status', 'active')
    .limit(20);

  const latestPlan = ((plansRes.data || []) as any[]).sort((a, b) =>
    new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime()
  )[0];

  if (!latestPlan?.id) {
    return 'Thực đơn hôm nay\n\nMình chưa thấy thực đơn tuần hiện tại trong Fitly. Bạn có thể tạo meal plan ở AI Coach hoặc hỏi mình gợi ý tạm thời theo mục tiêu.';
  }

  const itemsRes = await supabase
    .from('weekly_food_items')
    .select('day_of_week, meal_type, quantity, calories, protein, carbs, fat, is_rest_day, order_index, recipes:recipe_id(name, meal_type, serving_unit)')
    .eq('food_plan_id', latestPlan.id)
    .eq('day_of_week', todayDayIndex)
    .order('order_index', { ascending: true });

  const items = ((itemsRes.data || []) as any[]).filter((item) => !item.is_rest_day);
  if (items.length === 0) {
    return `Thực đơn hôm nay (${today})\n\nHôm nay đang được đánh dấu nghỉ hoặc chưa có món ăn trong meal plan.`;
  }

  const totals = items.reduce((sum, item) => {
    const qty = Number(item.quantity || 1);
    return {
      kcal: sum.kcal + Number(item.calories || 0) * qty,
      protein: sum.protein + Number(item.protein || 0) * qty,
      carbs: sum.carbs + Number(item.carbs || 0) * qty,
      fat: sum.fat + Number(item.fat || 0) * qty,
    };
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0 });

  const mealLines = compactLines(items.map((item) => {
    const food = (item.recipes || item.foods) as any;
    const qty = Number(item.quantity || 1);
    return `- ${item.meal_type}: ${food?.name || 'Món ăn'} x${qty} ${food?.serving_unit || ''} (${Math.round(Number(item.calories || 0) * qty)} kcal, P${Math.round(Number(item.protein || 0) * qty)}g)`;
  }), 12);

  return [
    `Thực đơn hôm nay (${today})`,
    latestPlan.name || 'Meal plan',
    '',
    ...mealLines,
    '',
    `Tổng: ${Math.round(totals.kcal)} kcal | Protein ${Math.round(totals.protein)}g | Carb ${Math.round(totals.carbs)}g | Fat ${Math.round(totals.fat)}g`,
  ].join('\n');
};

export const buildHealthReport = async (profile: ProfileLike) => {
  const [bodyMetricsRes, bodyHistoryRes, lifestyleRes, healthRes] = await Promise.all([
    supabase.from('body_metrics').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('body_metrics').select('weight, body_fat_percentage, body_fat, chest, waist, hips, neck, created_at').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(3),
    supabase.from('lifestyle_settings').select('*').eq('user_id', profile.id).maybeSingle(),
    supabase.from('health_conditions').select('*').eq('user_id', profile.id).maybeSingle(),
  ]);

  const body = bodyMetricsRes.data as any;
  const lifestyle = lifestyleRes.data as any;
  const health = healthRes.data as any;
  const history = (bodyHistoryRes.data || []) as any[];
  const bodyFat = body?.body_fat_percentage ?? body?.body_fat;
  const historyLines = history.map((item) => {
    const date = String(item.created_at || '').slice(0, 10);
    return `- ${date}: ${formatNumber(item.weight, 'n/a')}kg, body fat ${formatNumber(item.body_fat_percentage ?? item.body_fat, 'n/a')}%, eo ${formatNumber(item.waist, 'n/a')}cm`;
  });

  return [
    `Hồ sơ sức khỏe của ${profile.full_name || 'bạn'}`,
    '',
    `Cơ thể: ${formatNumber(body?.weight)}kg, ${formatNumber(body?.height)}cm, mục tiêu ${formatNumber(body?.target_weight)}kg, body fat ${formatNumber(bodyFat, 'n/a')}%, eo ${formatNumber(body?.waist, 'n/a')}cm.`,
    `Mục tiêu: ${lifestyle?.fitness_goal || 'chưa ghi'} | Tần suất: ${lifestyle?.weekly_workouts || 'chưa ghi'} buổi/tuần | Nước: ${lifestyle?.daily_water_goal || 2}L/ngày.`,
    `Sức khỏe: bệnh lý=${health?.health_condition || 'không ghi'}, chấn thương=${health?.injuries || 'không ghi'}, thuốc=${health?.medications || 'không ghi'}, stress=${health?.stress_level || 'chưa ghi'}, giấc ngủ=${health?.sleep_quality || 'chưa ghi'}.`,
    '',
    'Lịch sử chỉ số gần nhất:',
    ...(historyLines.length ? historyLines : ['Chưa có lịch sử chỉ số.']),
  ].join('\n');
};

export const buildCoachDataContext = async (userId: string) => {
  const today = getVietnamDateKey();
  const dateKeys = [today, addDaysToDateKey(today, -1), addDaysToDateKey(today, -2)];
  const weekStartKey = getWeekStartKey(today);
  const todayDayIndex = getVietnamDayIndex(today);

  const [bodyMetricsRes, bodyHistoryRes, lifestyleRes, healthRes, progressLogsRes, exerciseSessionsRes, weeklyPlansRes, foodPlansRes] = await Promise.all([
    supabase.from('body_metrics').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('body_metrics').select('weight, body_fat_percentage, body_fat, chest, waist, hips, neck, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(5),
    supabase.from('lifestyle_settings').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('health_conditions').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('daily_progress_logs').select('*').eq('user_id', userId).in('log_date', dateKeys).order('log_date', { ascending: false }),
    supabase
      .from('daily_exercise_sessions')
      .select('log_date, sets, reps, weight_kg, rest_seconds, is_completed, order_index, exercises:exercise_id(name, body_part, target_muscle, equipment)')
      .eq('user_id', userId)
      .in('log_date', dateKeys)
      .order('log_date', { ascending: false })
      .order('order_index', { ascending: true }),
    supabase.from('weekly_plans').select('id, name, description, week_start_date, created_at, updated_at').eq('user_id', userId).eq('week_start_date', weekStartKey).eq('plan_status', 'active').limit(20),
    supabase.from('weekly_food_plans').select('id, name, week_start_date, created_at, updated_at').eq('user_id', userId).eq('week_start_date', weekStartKey).eq('plan_status', 'active').limit(20),
  ]);

  const latestWorkoutPlan = ((weeklyPlansRes.data || []) as any[]).sort((a, b) =>
    new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime()
  )[0];
  const latestFoodPlan = ((foodPlansRes.data || []) as any[]).sort((a, b) =>
    new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime()
  )[0];

  const [weeklyExercisesRes, weeklyMealsRes] = await Promise.all([
    latestWorkoutPlan?.id
      ? supabase
        .from('weekly_plan_exercises')
        .select('day_of_week, sets, reps, weight_kg, rest_seconds, order_index, is_rest_day, exercises:exercise_id(name, body_part, target_muscle, equipment)')
        .eq('weekly_plan_id', latestWorkoutPlan.id)
        .order('day_of_week', { ascending: true })
        .order('order_index', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    latestFoodPlan?.id
      ? supabase
        .from('weekly_food_items')
        .select('day_of_week, meal_type, quantity, calories, protein, carbs, fat, is_rest_day, order_index, recipes:recipe_id(name, meal_type, serving_unit)')
        .eq('food_plan_id', latestFoodPlan.id)
        .order('day_of_week', { ascending: true })
        .order('order_index', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const bodyMetrics = bodyMetricsRes.data as any;
  const lifestyle = lifestyleRes.data as any;
  const health = healthRes.data as any;
  const progressLogs = ((progressLogsRes.data || []) as any[]);
  const exerciseSessions = ((exerciseSessionsRes.data || []) as any[]);
  const weeklyExercises = ((weeklyExercisesRes.data || []) as any[]);
  const weeklyMeals = ((weeklyMealsRes.data || []) as any[]);
  const bodyHistory = ((bodyHistoryRes.data || []) as any[]);

  const progressByDate = dateKeys.map((dateKey) => {
    const log = progressLogs.find((item) => item.log_date === dateKey);
    const sessions = exerciseSessions.filter((item) => item.log_date === dateKey);
    const done = sessions.filter((item) => item.is_completed).length;
    const names = compactLines(sessions.map((item) => {
      const exercise = item.exercises as any;
      const status = item.is_completed ? 'done' : 'pending';
      return `${exercise?.name || 'Bài tập'} ${item.sets || 0}x${item.reps || '-'} ${item.weight_kg || 0}kg rest ${item.rest_seconds || 60}s (${status})`;
    }), 8).join('; ') || 'chưa có bài tập';
    return `${dateKey}: water=${log?.water_intake_ml || 0}ml cal_in=${log?.calories_consumed || 0}kcal cal_burn=${log?.calories_burned || 0}kcal sleep=${log?.sleep_hours || 0}h workout=${done}/${sessions.length} items=${names}`;
  });

  const todayPlanLines = compactLines(
    weeklyExercises
      .filter((item) => item.day_of_week === todayDayIndex && !item.is_rest_day)
      .map((item) => {
        const exercise = item.exercises as any;
        return `${exercise?.name || 'Bài tập'} ${item.sets || 0}x${item.reps || '-'} ${item.weight_kg || 0}kg rest ${item.rest_seconds || 60}s`;
      }),
    10
  );
  const todayMealLines = compactLines(
    weeklyMeals
      .filter((item) => item.day_of_week === todayDayIndex && !item.is_rest_day)
      .map((item) => {
        const food = (item.recipes || item.foods) as any;
        const qty = Number(item.quantity || 1);
        return `${item.meal_type}: ${food?.name || 'Món ăn'} x${qty} (${Math.round(Number(item.calories || 0) * qty)}kcal, P${Math.round(Number(item.protein || 0) * qty)}g)`;
      }),
    12
  );
  const bodyHistoryLines = bodyHistory.map((item) => {
    const date = String(item.created_at || '').slice(0, 10);
    const bodyFat = item.body_fat_percentage ?? item.body_fat;
    return `${date}: weight=${formatNumber(item.weight)}kg, body_fat=${formatNumber(bodyFat, 'n/a')}%, waist=${formatNumber(item.waist, 'n/a')}cm`;
  });

  return [
    '[DU LIEU HO SO VA SUC KHOE]',
    `- body: weight=${formatNumber(bodyMetrics?.weight)}kg, height=${formatNumber(bodyMetrics?.height)}cm, target_weight=${formatNumber(bodyMetrics?.target_weight)}kg, body_fat=${formatNumber(bodyMetrics?.body_fat_percentage ?? bodyMetrics?.body_fat, 'n/a')}%, waist=${formatNumber(bodyMetrics?.waist, 'n/a')}cm`,
    `- lifestyle: goal=${lifestyle?.fitness_goal || 'n/a'}, activity=${lifestyle?.activity_level || 'n/a'}, weekly_workouts=${lifestyle?.weekly_workouts || 'n/a'}, duration=${lifestyle?.workout_duration || 'n/a'}min, location=${lifestyle?.workout_location || 'n/a'}, equipment=${lifestyle?.equipment_available || 'n/a'}, diet=${lifestyle?.diet_preference || 'n/a'}, water_goal=${lifestyle?.daily_water_goal || 2}L, target_calories=${lifestyle?.target_calories || 'n/a'}`,
    `- health: condition=${health?.health_condition || 'không ghi'}, injuries=${health?.injuries || 'không ghi'}, medications=${health?.medications || 'không ghi'}, stress=${health?.stress_level || 'n/a'}, sleep_quality=${health?.sleep_quality || 'n/a'}, smoke_drink=${health?.smoke_drink || 'n/a'}`,
    `- body_history: ${bodyHistoryLines.join(' | ') || 'chưa có lịch sử chỉ số'}`,
    '',
    '[TIEN DO 3 NGAY GAN NHAT]',
    ...progressByDate,
    '',
    `[LICH TAP TUAN HIEN TAI ${weekStartKey}]`,
    `- plan=${latestWorkoutPlan?.name || 'chưa có lịch tập tuần'}`,
    `- today_plan: ${todayPlanLines.join('; ') || 'chưa có bài tập hôm nay'}`,
    '',
    `[THUC DON TUAN HIEN TAI ${weekStartKey}]`,
    `- plan=${latestFoodPlan?.name || 'chưa có thực đơn tuần'}`,
    `- today_meals: ${todayMealLines.join('; ') || 'chưa có thực đơn hôm nay'}`,
  ].join('\n');
};

export const buildTodayStatus = async (userId: string) => {
  const today = getVietnamDateKey();
  const [lifestyleRes, todayLogRes, todaySessionsRes] = await Promise.all([
    supabase.from('lifestyle_settings').select('daily_water_goal').eq('user_id', userId).maybeSingle(),
    supabase.from('daily_progress_logs').select('*').eq('user_id', userId).eq('log_date', today).maybeSingle(),
    supabase.from('daily_exercise_sessions').select('is_completed, sets, reps, weight_kg, rest_seconds, exercises:exercise_id(name)').eq('user_id', userId).eq('log_date', today),
  ]);

  const waterIntake = todayLogRes.data?.water_intake_ml || 0;
  const waterTarget = Math.round((lifestyleRes.data?.daily_water_goal || 2) * 1000);
  const sessions = (todaySessionsRes.data || []) as any[];
  const exerciseLines = sessions.length
    ? sessions.map((item) => {
      const name = (item.exercises as any)?.name || 'Bài tập';
      const status = item.is_completed ? 'xong' : 'chưa xong';
      return `  ${name} ${item.sets || 0}x${item.reps || '-'} ${item.weight_kg || 0}kg nghỉ ${item.rest_seconds || 60}s (${status})`;
    }).join('\n')
    : '  Trống';

  return [
    `- Nước: ${waterIntake}ml / ${waterTarget}ml`,
    `- Calo: ${todayLogRes.data?.calories_consumed || 0} kcal`,
    `- Ngủ: ${todayLogRes.data?.sleep_hours || 'chưa ghi'} tiếng`,
    `- Bài tập (${sessions.length}):`,
    exerciseLines,
  ].join('\n');
};

export const processNaturalTracking = async (userId: string, message: string) => {
  const actionLog: string[] = [];
  const waterMatch = message.match(/(\d+(?:[.,]\d+)?)\s*(ml|l|lit|lít|liter)\b/i);
  if (waterMatch && /nước|nuoc|uống|uong|water/i.test(message)) {
    const raw = Number(String(waterMatch[1]).replace(',', '.'));
    const amountMl = /^(l|lit|lít|liter)$/i.test(waterMatch[2]) ? Math.round(raw * 1000) : Math.round(raw);
    if (Number.isFinite(amountMl) && amountMl > 0 && amountMl <= 5000) {
      const total = await addWaterIntake(userId, amountMl);
      actionLog.push(`Đã ghi nhận +${amountMl}ml nước. Tổng hôm nay: ${total}ml.`);
    }
  }

  const sleepMatch = message.match(/(\d+(?:[.,]\d+)?)\s*(tiếng|giờ|h|hour)\b/i);
  if (sleepMatch && /ngủ|ngu|sleep/i.test(message)) {
    const hours = Number(String(sleepMatch[1]).replace(',', '.'));
    if (Number.isFinite(hours) && hours > 0 && hours <= 16) {
      await updateDailyProgress(userId, { sleep_hours: hours });
      actionLog.push(`Đã ghi nhận ngủ ${hours} tiếng.`);
    }
  }

  const calMatch = message.match(/(\d+)\s*(calo|kcal|cal)\b/i);
  if (calMatch && /ăn|an|eat|nạp|nap|tiêu thụ|tieu thu|thêm|them|ghi|log|lưu|luu|save/i.test(message)) {
    const calories = Number(calMatch[1]);
    if (Number.isFinite(calories) && calories > 0 && calories <= 5000) {
      await incrementDailyCalories(userId, calories);
      actionLog.push(`Đã ghi nhận ${calories} kcal.`);
    }
  }

  return { actionLog: actionLog.join('\n') };
};

export const executeCoachCommand = async ({
  userId,
  command,
  amountMl,
  sleepHours,
}: {
  userId: string;
  command: string;
  amountMl?: number;
  sleepHours?: number;
}): Promise<CoachCommandResult> => {
  const profile = await getProfile(userId);
  const normalizedCommand = String(command || '').replace(/^\//, '').trim().toLowerCase();

  if (normalizedCommand === 'menu') {
    return {
      command: 'menu',
      reply: buildHelpText(),
      quickActions: [
        { label: 'Hôm nay', command: 'today' },
        { label: 'Ghi nước', command: 'water' },
        { label: 'Ghi ngủ', command: 'sleep' },
        { label: 'Bài tập', command: 'workout' },
        { label: 'Thực đơn', command: 'meals' },
        { label: 'Sức khỏe', command: 'health' },
      ],
    };
  }

  if (normalizedCommand === 'help') {
    return { command: 'help', reply: buildHelpText() };
  }

  if (normalizedCommand === 'today') {
    return { command: 'today', reply: await buildTodaySummary(profile) };
  }

  if (normalizedCommand === 'workout') {
    return { command: 'workout', reply: await buildWorkoutReport(profile) };
  }

  if (normalizedCommand === 'meals') {
    return { command: 'meals', reply: await buildMealReport(profile) };
  }

  if (normalizedCommand === 'health') {
    return { command: 'health', reply: await buildHealthReport(profile) };
  }

  if (normalizedCommand === 'water') {
    if (Number.isFinite(Number(amountMl)) && Number(amountMl) > 0) {
      const total = await addWaterIntake(userId, Math.round(Number(amountMl)));
      const snapshot = await getHydrationSnapshot(userId);
      const remainingMl = Math.max(0, snapshot.goalMl - total);
      return {
        command: 'water',
        reply: [
          'Đã ghi nhận nước uống',
          '',
          `+${Math.round(Number(amountMl))}ml vừa được lưu vào Fitly.`,
          `Tổng hôm nay: ${total}/${snapshot.goalMl}ml (${snapshot.percent}%).`,
          remainingMl > 0 ? `Còn khoảng ${remainingMl}ml để đạt mục tiêu.` : 'Bạn đã đạt mục tiêu nước hôm nay.',
        ].join('\n'),
        quickActions: WATER_ACTIONS,
      };
    }

    const snapshot = await getHydrationSnapshot(userId);
    return {
      command: 'water',
      reply: [
        'Chọn lượng nước muốn ghi nhận:',
        '',
        `Hôm nay: ${snapshot.currentMl}/${snapshot.goalMl}ml (${snapshot.percent}%).`,
      ].join('\n'),
      quickActions: WATER_ACTIONS,
    };
  }

  if (normalizedCommand === 'sleep') {
    if (Number.isFinite(Number(sleepHours)) && Number(sleepHours) > 0) {
      const hours = Math.max(1, Math.min(16, Number(sleepHours)));
      await updateDailyProgress(userId, { sleep_hours: hours });
      const sleepNote = hours < 6
        ? 'Thời lượng hơi thấp. Hôm nay nên ưu tiên phục hồi, tập nhẹ hơn nếu thấy mệt.'
        : hours <= 9
          ? 'Đây là mức ngủ tốt cho phục hồi và hiệu suất tập luyện.'
          : 'Ngủ nhiều hơn thường lệ. Nếu vẫn mệt, hãy theo dõi thêm chất lượng ngủ.';
      return {
        command: 'sleep',
        reply: ['Đã ghi nhận giấc ngủ', '', `Thời lượng: ${hours}h`, sleepNote].join('\n'),
        quickActions: SLEEP_ACTIONS,
      };
    }

    const snapshot = await getSleepSnapshot(userId);
    return {
      command: 'sleep',
      reply: [
        'Chọn thời lượng ngủ gần nhất:',
        '',
        `Mục tiêu: ${snapshot.targetSleepHours}h/đêm`,
        snapshot.yesterdaySleepHours ? `Hôm qua: ${snapshot.yesterdaySleepHours}h` : 'Hôm qua: chưa ghi nhận',
      ].join('\n'),
      quickActions: SLEEP_ACTIONS,
    };
  }

  if (normalizedCommand === 'clear') {
    await supabase
      .from('ai_chat_messages')
      .delete()
      .eq('user_id', userId);
    return {
      command: 'clear',
      reply: 'Đã xoá cuộc hội thoại AI Coach. Mình sẽ bắt đầu lại từ dữ liệu Fitly hiện tại.',
      clearHistory: true,
    };
  }

  return {
    command: 'help',
    reply: buildHelpText(),
  };
};
