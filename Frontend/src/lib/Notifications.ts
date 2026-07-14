import { supabase } from './Supabase';
import { ensureChallengeNotifications, syncChallengeCheckin } from './Challenges';

export type NotificationTone = 'workout' | 'nutrition' | 'coach' | 'progress' | 'system';

export interface UserNotification {
  id: string;
  user_id: string;
  tone: NotificationTone;
  title: string;
  message: string;
  href: string;
  source_type: string;
  source_id: string | null;
  dedupe_key: string;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

type NotificationUpsert = {
  user_id: string;
  tone: NotificationTone;
  title: string;
  message: string;
  href: string;
  source_type: string;
  source_id?: string | null;
  dedupe_key: string;
  metadata?: Record<string, unknown>;
  updated_at: string;
};

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';
const WATER_REMINDER_SLOTS = ['09:00', '11:00', '14:00', '16:00', '20:00', '22:00'] as const;
const WATER_MESSAGES = [
  'Bắt đầu ngày mới bằng vài ngụm nước để giữ năng lượng ổn định.',
  'Một nhịp nghỉ ngắn để bổ sung nước và giữ sự tập trung.',
  'Cơ thể đang cần nước để hỗ trợ vận động, trao đổi chất và phục hồi.',
  'Tạm dừng 30 giây. Uống chậm vài ngụm để duy trì hiệu suất trong ngày.',
  'Bổ sung nước vừa đủ cho buổi tối, nhẹ nhàng và không quá sát giờ ngủ.',
  'Kết ngày bằng một lượng nước nhỏ để cơ thể dễ chịu hơn khi nghỉ ngơi.'
] as const;
const SLEEP_REMINDER_SLOT = '09:30';

const getDatePartsInTimeZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  return {
    year: parts.find((p) => p.type === 'year')?.value || '1970',
    month: parts.find((p) => p.type === 'month')?.value || '01',
    day: parts.find((p) => p.type === 'day')?.value || '01'
  };
};

const getVietnamDateKey = (date = new Date()): string => {
  const { year, month, day } = getDatePartsInTimeZone(date, VIETNAM_TIMEZONE);
  return `${year}-${month}-${day}`;
};

const addDaysToDateKey = (dateKey: string, days: number): string => {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return getVietnamDateKey(date);
};

const getVietnamTimeParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: VIETNAM_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  return {
    hour: Number(parts.find((p) => p.type === 'hour')?.value || 0),
    minute: Number(parts.find((p) => p.type === 'minute')?.value || 0)
  };
};

const timeLabelToMinutes = (label: string): number => {
  const [hour, minute] = label.split(':').map(Number);
  return (Number(hour) || 0) * 60 + (Number(minute) || 0);
};

const getElapsedReminderSlots = (slots: readonly string[], date = new Date()): string[] => {
  const { hour, minute } = getVietnamTimeParts(date);
  const currentMinutes = hour * 60 + minute;
  return slots.filter((slot) => timeLabelToMinutes(slot) <= currentMinutes);
};

const formatNumber = (value: unknown, fallback = '0'): string => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(1);
};

const getWeekStartKey = (date = new Date()): string => {
  const localKey = getVietnamDateKey(date);
  const localDate = new Date(`${localKey}T00:00:00`);
  const day = localDate.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  localDate.setDate(localDate.getDate() + diff);
  return getVietnamDateKey(localDate);
};

const normalizeWaterGoalMl = (value: unknown): number => {
  const goal = Number(value);
  if (!Number.isFinite(goal) || goal <= 0) return 0;
  return Math.round(goal <= 20 ? goal * 1000 : goal);
};

const calculateWorkoutStreak = (completedDateKeys: string[], todayKey: string): number => {
  const completedSet = new Set(completedDateKeys);
  let streak = 0;
  let cursor = todayKey;

  if (!completedSet.has(cursor)) {
    cursor = addDaysToDateKey(cursor, -1);
  }

  while (completedSet.has(cursor)) {
    streak += 1;
    cursor = addDaysToDateKey(cursor, -1);
  }

  return streak;
};

export const fetchUserNotifications = async (userId: string, limit = 12): Promise<UserNotification[]> => {
  const { data, error } = await supabase
    .from('user_notifications')
    .select('*')
    .eq('user_id', userId)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []) as UserNotification[];
};

export const markNotificationRead = async (userId: string, notificationId: string) => {
  const { error } = await supabase
    .from('user_notifications')
    .update({ read_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', userId);

  if (error) throw error;
};

export const archiveNotification = async (userId: string, notificationId: string) => {
  const completedAt = new Date().toISOString();
  const { error } = await supabase
    .from('user_notifications')
    .update({
      read_at: completedAt,
      expires_at: completedAt,
      updated_at: completedAt,
    })
    .eq('id', notificationId)
    .eq('user_id', userId);

  if (error) throw error;
};

export const markAllUserNotificationsRead = async (userId: string) => {
  const { error } = await supabase
    .from('user_notifications')
    .update({ read_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);

  if (error) throw error;
};

export const recordWaterFromNotification = async (userId: string, amountMl = 250): Promise<number> => {
  const todayKey = getVietnamDateKey();
  const [progressRes, lifestyleRes] = await Promise.all([
    supabase
      .from('daily_progress_logs')
      .select('water_intake_ml, sleep_hours')
      .eq('user_id', userId)
      .eq('log_date', todayKey)
      .maybeSingle(),
    supabase
      .from('lifestyle_settings')
      .select('daily_water_goal')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  if (progressRes.error) throw progressRes.error;
  if (lifestyleRes.error) throw lifestyleRes.error;

  const currentMl = Math.max(0, Number(progressRes.data?.water_intake_ml) || 0);
  const goalMl = normalizeWaterGoalMl(lifestyleRes.data?.daily_water_goal);
  const remainingMl = goalMl > 0 ? Math.max(0, goalMl - currentMl) : amountMl;
  const addedMl = remainingMl > 0 ? Math.min(amountMl, remainingMl) : amountMl;
  const nextMl = currentMl + addedMl;

  const { error } = await supabase
    .from('daily_progress_logs')
    .upsert({
      user_id: userId,
      log_date: todayKey,
      water_intake_ml: nextMl,
    }, { onConflict: 'user_id,log_date' });

  if (error) throw error;

  await syncChallengeCheckin(userId, 'water').catch((challengeError) => {
    console.warn('Challenge water check-in sync failed:', challengeError);
  });

  window.dispatchEvent(new CustomEvent('fitly:water-updated', {
    detail: { waterIntake: nextMl / 1000 }
  }));

  return nextMl;
};

export const recordSleepFromNotification = async (userId: string, sleepHours: number): Promise<number> => {
  const todayKey = getVietnamDateKey();
  const normalizedHours = Math.max(0, Math.min(12, Number(sleepHours) || 0));

  const { error } = await supabase
    .from('daily_progress_logs')
    .upsert({
      user_id: userId,
      log_date: todayKey,
      sleep_hours: normalizedHours,
    }, { onConflict: 'user_id,log_date' });

  if (error) throw error;
  await syncChallengeCheckin(userId, 'sleep').catch((challengeError) => {
    console.warn('Challenge sleep check-in sync failed:', challengeError);
  });
  return normalizedHours;
};

export const ensureActionableNotifications = async (userId: string) => {
  const todayKey = getVietnamDateKey();
  const weekStartKey = getWeekStartKey();
  const twoWeeksAgoKey = addDaysToDateKey(todayKey, -14);

  const [
    profileRes,
    lifestyleRes,
    progressRes,
    yesterdayProgressRes,
    healthRes,
    todayExercisesRes,
    latestAdjustmentRes,
    latestWorkoutPlanRes,
    completedExerciseRes,
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('lifestyle_settings')
      .select('daily_water_goal, workout_duration')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('daily_progress_logs')
      .select('water_intake_ml')
      .eq('user_id', userId)
      .eq('log_date', todayKey)
      .maybeSingle(),
    supabase
      .from('daily_progress_logs')
      .select('sleep_hours')
      .eq('user_id', userId)
      .eq('log_date', addDaysToDateKey(todayKey, -1))
      .maybeSingle(),
    supabase
      .from('health_conditions')
      .select('sleep_hours, sleep_quality')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('daily_exercise_sessions')
      .select('id, is_completed, estimated_kcal')
      .eq('user_id', userId)
      .eq('log_date', todayKey)
      .order('order_index', { ascending: true }),
    supabase
      .from('ai_plan_adjustments')
      .select('id, plan_type, reason, status, created_at')
      .eq('user_id', userId)
      .gte('created_at', `${weekStartKey}T00:00:00+07:00`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('weekly_plans')
      .select('id, name, generated_by, updated_at, created_at')
      .eq('user_id', userId)
      .eq('week_start_date', weekStartKey)
      .eq('generated_by', 'ai')
      .eq('plan_status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('daily_exercise_sessions')
      .select('log_date')
      .eq('user_id', userId)
      .eq('is_completed', true)
      .gte('log_date', twoWeeksAgoKey)
      .order('log_date', { ascending: false }),
  ]);

  const now = new Date().toISOString();
  const rows: NotificationUpsert[] = [];
  const displayName = String(profileRes.data?.full_name || 'bạn');

  const todayExercises = todayExercisesRes.data || [];
  if (!todayExercisesRes.error && todayExercises.length > 0) {
    const completed = todayExercises.filter((item: any) => item.is_completed).length;
    const remaining = Math.max(0, todayExercises.length - completed);
    const estimatedKcal = todayExercises.reduce((sum: number, item: any) => sum + Math.max(0, Number(item.estimated_kcal) || 0), 0);
    const workoutDuration = Math.max(0, Number(lifestyleRes.data?.workout_duration) || 0);
    rows.push({
      user_id: userId,
      tone: 'workout',
      title: remaining > 0 ? 'Lịch tập hôm nay đã sẵn sàng' : 'Bạn đã hoàn thành lịch tập hôm nay',
      message: remaining > 0
        ? `${remaining}/${todayExercises.length} bài còn lại${workoutDuration ? `, khoảng ${workoutDuration} phút` : ''}${estimatedKcal ? `, ước tính ${estimatedKcal} kcal` : ''}.`
        : `${todayExercises.length} bài đã hoàn tất. Tiến độ hôm nay đã được cập nhật.`,
      href: '/exercises',
      source_type: 'daily_exercise_sessions',
      dedupe_key: `workout:${todayKey}`,
      metadata: { log_date: todayKey, total: todayExercises.length, completed, estimated_kcal: estimatedKcal },
      updated_at: now,
    });
  }

  if (!lifestyleRes.error && !progressRes.error) {
    const waterGoalMl = normalizeWaterGoalMl(lifestyleRes.data?.daily_water_goal);
    const waterIntakeMl = Math.max(0, Number(progressRes.data?.water_intake_ml) || 0);
    if (waterGoalMl > 0) {
      const remainingMl = Math.max(0, waterGoalMl - waterIntakeMl);
      const waterPercent = Math.min(100, Math.round((waterIntakeMl / Math.max(1, waterGoalMl)) * 100));
      getElapsedReminderSlots(WATER_REMINDER_SLOTS).forEach((slot, slotIndex) => {
        rows.push({
          user_id: userId,
          tone: 'nutrition',
          title: `Fitly Daily Check-in · ${slot}`,
          message: [
            `Chào ${displayName}, ${WATER_MESSAGES[slotIndex]}`,
            `Nước hôm nay: ${waterIntakeMl}/${waterGoalMl}ml · ${waterPercent}%.`,
            remainingMl > 0
              ? `Còn ${remainingMl}ml để đạt mục tiêu.`
              : 'Mục tiêu nước hôm nay đã hoàn thành.',
            'Ghi nhanh lượng nước vừa uống:'
          ].join(' '),
          href: '/overview',
          source_type: 'daily_progress_logs',
          dedupe_key: `water:${todayKey}:${slot}`,
          metadata: {
            log_date: todayKey,
            slot,
            slot_index: slotIndex,
            water_goal_ml: waterGoalMl,
            water_intake_ml: waterIntakeMl,
            water_percent: waterPercent,
          },
          updated_at: now,
        });
      });
    }
  }

  if (!healthRes.error && !progressRes.error && getElapsedReminderSlots([SLEEP_REMINDER_SLOT]).length > 0) {
    const todaySleepHours = Number((progressRes.data as any)?.sleep_hours || 0);
    const yesterdaySleepHours = Number(yesterdayProgressRes.data?.sleep_hours || 0);
    if (!todaySleepHours) {
      const targetSleepHours = Number(healthRes.data?.sleep_hours || 8);
      const sleepQuality = String(healthRes.data?.sleep_quality || 'chưa ghi');
      rows.push({
        user_id: userId,
        tone: 'progress',
        title: `Fitly Recovery Check-in · ${SLEEP_REMINDER_SLOT}`,
        message: [
          `Chào ${displayName}, ghi lại giấc ngủ để Fitly theo dõi phục hồi và điều chỉnh nhịp tập chính xác hơn.`,
          `Mục tiêu: ${formatNumber(targetSleepHours, '8')}h/đêm.`,
          `Chất lượng đã khai báo: ${sleepQuality}.`,
          yesterdaySleepHours ? `Hôm qua: ${formatNumber(yesterdaySleepHours)}h.` : 'Hôm qua: chưa ghi nhận.',
          'Đêm qua bạn ngủ bao lâu?'
        ].join(' '),
        href: '/overview',
        source_type: 'daily_progress_logs',
        dedupe_key: `sleep:${todayKey}:${SLEEP_REMINDER_SLOT}`,
        metadata: {
          log_date: todayKey,
          slot: SLEEP_REMINDER_SLOT,
          target_sleep_hours: targetSleepHours,
          sleep_quality: sleepQuality,
          yesterday_sleep_hours: yesterdaySleepHours,
        },
        updated_at: now,
      });
    }
  }

  if (!progressRes.error && Number((progressRes.data as any)?.sleep_hours || 0) > 0) {
    await supabase
      .from('user_notifications')
      .update({ expires_at: now, updated_at: now })
      .eq('user_id', userId)
      .eq('dedupe_key', `sleep:${todayKey}:${SLEEP_REMINDER_SLOT}`);
  }

  const latestAdjustment = latestAdjustmentRes.data;
  const latestWorkoutPlan = latestWorkoutPlanRes.data;
  if (!latestAdjustmentRes.error && latestAdjustment) {
    rows.push({
      user_id: userId,
      tone: 'coach',
      title: latestAdjustment.status === 'proposed' ? 'AI Coach có đề xuất mới' : 'AI Coach đã cập nhật kế hoạch',
      message: String(latestAdjustment.reason || 'Kế hoạch tuần này đã có điều chỉnh mới.').slice(0, 140),
      href: '/smart-planner',
      source_type: 'ai_plan_adjustments',
      source_id: latestAdjustment.id,
      dedupe_key: `coach-adjustment:${latestAdjustment.id}`,
      metadata: { plan_type: latestAdjustment.plan_type, status: latestAdjustment.status },
      updated_at: now,
    });
  } else if (!latestWorkoutPlanRes.error && latestWorkoutPlan) {
    rows.push({
      user_id: userId,
      tone: 'coach',
      title: 'AI Coach đã tạo lịch tuần này',
      message: `${latestWorkoutPlan.name || 'Kế hoạch tập'} đã sẵn sàng để bạn bắt đầu.`,
      href: '/smart-planner',
      source_type: 'weekly_plans',
      source_id: latestWorkoutPlan.id,
      dedupe_key: `coach-week:${weekStartKey}`,
      metadata: { week_start_date: weekStartKey },
      updated_at: now,
    });
  }

  if (!completedExerciseRes.error) {
    const completedDateKeys = Array.from(new Set((completedExerciseRes.data || []).map((item: any) => String(item.log_date || '')).filter(Boolean)));
    const streak = calculateWorkoutStreak(completedDateKeys, todayKey);
    if (streak >= 2) {
      rows.push({
        user_id: userId,
        tone: 'progress',
        title: 'Chuỗi tập đang rất ổn',
        message: `Bạn đã duy trì ${streak} ngày liên tiếp. Giữ nhịp này nhé.`,
        href: '/progress',
        source_type: 'daily_exercise_sessions',
        dedupe_key: `streak:${todayKey}`,
        metadata: { streak, log_date: todayKey },
        updated_at: now,
      });
    }
  }

  if (rows.length === 0) {
    await ensureChallengeNotifications(userId).catch((challengeError) => {
      console.warn('Challenge notification sync failed:', challengeError);
    });
    return;
  }

  await supabase
    .from('user_notifications')
    .update({ expires_at: now, updated_at: now })
    .eq('user_id', userId)
    .eq('dedupe_key', `water:${todayKey}`);

  const { error } = await supabase
    .from('user_notifications')
    .upsert(rows, { onConflict: 'user_id,dedupe_key' });

  if (error) throw error;

  await ensureChallengeNotifications(userId).catch((challengeError) => {
    console.warn('Challenge notification sync failed:', challengeError);
  });
};
