import { supabase } from '@/lib/supabase';

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';

export type WellnessSnapshot = {
  dateKey: string;
  waterIntakeMl: number;
  waterGoalMl: number;
  sleepHours: number | null;
  sleepGoalHours: number;
  sleepQuality: string | null;
};

export type NotificationTone = 'workout' | 'nutrition' | 'coach' | 'progress' | 'system';

export type UserNotification = {
  id: string;
  tone: NotificationTone;
  title: string;
  message: string;
  href: string;
  dedupeKey: string;
  metadata: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const asPositiveNumber = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

const normalizeWaterGoal = (value: unknown) => {
  const amount = asPositiveNumber(value);
  return amount > 0 && amount <= 20 ? Math.round(amount * 1000) : Math.round(amount);
};

export const vietnamDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

export async function loadWellnessSnapshot(dateKey = vietnamDateKey()): Promise<WellnessSnapshot> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!authData.user) throw new Error('Phiên đăng nhập đã hết hạn.');

  const userId = authData.user.id;
  const [dailyResult, lifestyleResult, healthResult] = await Promise.all([
    supabase.from('daily_progress_logs').select('water_intake_ml, sleep_hours').eq('user_id', userId).eq('log_date', dateKey).maybeSingle(),
    supabase.from('lifestyle_settings').select('daily_water_goal').eq('user_id', userId).maybeSingle(),
    supabase.from('health_conditions').select('sleep_hours, sleep_quality').eq('user_id', userId).maybeSingle(),
  ]);

  const firstError = [dailyResult.error, lifestyleResult.error, healthResult.error].find(Boolean);
  if (firstError) throw firstError;

  const hours = Number(dailyResult.data?.sleep_hours);
  return {
    dateKey,
    waterIntakeMl: Math.max(0, Number(dailyResult.data?.water_intake_ml) || 0),
    waterGoalMl: normalizeWaterGoal(lifestyleResult.data?.daily_water_goal),
    sleepHours: Number.isFinite(hours) && hours > 0 ? hours : null,
    sleepGoalHours: asPositiveNumber(healthResult.data?.sleep_hours, 8),
    sleepQuality: typeof healthResult.data?.sleep_quality === 'string' ? healthResult.data.sleep_quality : null,
  };
}

async function requireUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Phiên đăng nhập đã hết hạn.');
  return data.user.id;
}

export async function addWaterIntake(amountMl: number, dateKey = vietnamDateKey()) {
  const amount = Math.round(Number(amountMl));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Lượng nước cần lớn hơn 0 ml.');

  const userId = await requireUserId();
  const { data: current, error: readError } = await supabase
    .from('daily_progress_logs')
    .select('water_intake_ml')
    .eq('user_id', userId)
    .eq('log_date', dateKey)
    .maybeSingle();
  if (readError) throw readError;

  const waterIntakeMl = Math.max(0, Number(current?.water_intake_ml) || 0) + amount;
  const { error } = await supabase.from('daily_progress_logs').upsert({ user_id: userId, log_date: dateKey, water_intake_ml: waterIntakeMl }, { onConflict: 'user_id,log_date' });
  if (error) throw error;
  return waterIntakeMl;
}

export async function recordSleepHours(hours: number, dateKey = vietnamDateKey()) {
  const sleepHours = Math.round(Number(hours) * 10) / 10;
  if (!Number.isFinite(sleepHours) || sleepHours < 0 || sleepHours > 16) throw new Error('Giấc ngủ cần nằm trong khoảng 0 đến 16 giờ.');

  const userId = await requireUserId();
  const { error } = await supabase.from('daily_progress_logs').upsert({ user_id: userId, log_date: dateKey, sleep_hours: sleepHours }, { onConflict: 'user_id,log_date' });
  if (error) throw error;
  return sleepHours;
}

export async function loadUnreadNotificationCount(): Promise<number> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return 0;

  const { count, error } = await supabase
    .from('user_notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', authData.user.id)
    .is('read_at', null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

  if (error) return 0;
  return Math.max(0, count ?? 0);
}

export async function loadUserNotifications(limit = 60): Promise<UserNotification[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('user_notifications')
    .select('id, tone, title, message, href, dedupe_key, metadata, read_at, created_at, updated_at')
    .eq('user_id', userId)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((item) => ({
    id: item.id,
    tone: item.tone as NotificationTone,
    title: item.dedupe_key.startsWith('water:') ? 'Nhắc uống nước' : item.dedupe_key.startsWith('sleep:') ? 'Ghi lại giấc ngủ' : item.title,
    message: item.message,
    href: item.href,
    dedupeKey: item.dedupe_key,
    metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata as Record<string, unknown> : {},
    readAt: item.read_at,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }));
}

export async function markUserNotificationRead(notificationId: string) {
  const userId = await requireUserId();
  const now = new Date().toISOString();
  const { error } = await supabase.from('user_notifications').update({ read_at: now, updated_at: now }).eq('id', notificationId).eq('user_id', userId);
  if (error) throw error;
}

export async function markAllUserNotificationsRead() {
  const userId = await requireUserId();
  const now = new Date().toISOString();
  const { error } = await supabase.from('user_notifications').update({ read_at: now, updated_at: now }).eq('user_id', userId).is('read_at', null);
  if (error) throw error;
}
