import TelegramBot, { type InlineKeyboardMarkup, type Message } from 'node-telegram-bot-api';
import { supabase } from './config/Supabase';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { synchronizeTrainingProfileContext } from './services/trainingProfileContextService';
import { verifyTelegramLinkToken } from './lib/telegramLinkToken';
import {
  buildExerciseEligibilityContext,
  getExerciseEligibilityDecision,
} from './services/exerciseCatalogService';
import { callCoachCompletion, COACH_RESPONSE_STYLE_RULES } from './services/ai/coachConversationService';
import { fetchRealtimeMarketPrices, isMarketPriceQuery } from './services/ai/marketPriceService';
import {
  analyzeMealPhotoCalories,
  answerVoiceCoachQuestion,
  transcribeTelegramAudio,
} from './services/ai/coachMediaService';
import {
  buildMealPlanningCatalog,
  calculateNutritionMacroTargets,
  completeAiMealDay,
  getMealSlotsForCount,
  optimizeMealPlanQuantities,
  resolveMealsPerDay,
} from './services/mealPlanningService';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';

// === BỘ NHỚ HỘI THOẠI ===
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

type LinkedProfile = {
  id: string;
  full_name?: string | null;
  gender?: string | null;
  telegram_notify_water?: boolean;
  telegram_notify_sleep?: boolean;
  telegram_notify_workout?: boolean;
};

type LinkedTelegramUserRow = {
  id: string;
  full_name?: string | null;
  telegram_chat_id: string;
  telegram_notify_water?: boolean;
  telegram_notify_sleep?: boolean;
  telegram_notify_workout?: boolean;
  updated_at?: string | null;
  created_at?: string | null;
};

type PendingMealEstimate = {
  userId?: string;
  foodName: string;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  source: 'telegram_photo_ai' | 'telegram_voice_ai';
  confidence: 'low' | 'medium' | 'high';
  imageUrl?: string;
  telegramFileId?: string;
  transcript?: string;
  rawReply: string;
  createdAt: number;
};

const conversationStore = new Map<number, ChatMessage[]>();
const pendingMealEstimateStore = new Map<number, PendingMealEstimate>();
const MAX_HISTORY = 20; // Giữ tối đa 20 tin nhắn gần nhất
const HISTORY_TTL_MS = 2 * 60 * 60 * 1000; // Xóa sau 2 giờ không hoạt động
const PENDING_MEAL_TTL_MS = 45 * 60 * 1000;
const TELEGRAM_MEDIA_MAX_BYTES = Number(process.env.TELEGRAM_MEDIA_MAX_BYTES || 20 * 1024 * 1024);

const getTelegramExerciseEligibilityDecision = async (userId: string, exercise: unknown) => {
  const [profileRes, lifestyleRes, healthRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('lifestyle_settings').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('health_conditions').select('*').eq('user_id', userId).maybeSingle(),
  ]);
  const error = [profileRes.error, lifestyleRes.error, healthRes.error].find(Boolean);
  if (error) throw error;
  const safetyContext = {
    profile: profileRes.data || null,
    lifestyle: lifestyleRes.data || null,
    health: healthRes.data || null,
  };
  return getExerciseEligibilityDecision(
    exercise,
    buildExerciseEligibilityContext(safetyContext),
  );
};

function getHistory(chatId: number): ChatMessage[] {
  const history = conversationStore.get(chatId) || [];
  const now = Date.now();
  // Lọc bỏ tin nhắn quá cũ
  const fresh = history.filter(m => now - m.timestamp < HISTORY_TTL_MS);
  if (fresh.length !== history.length) conversationStore.set(chatId, fresh);
  return fresh;
}

function addToHistory(chatId: number, role: 'user' | 'assistant', content: string) {
  const history = getHistory(chatId);
  history.push({ role, content, timestamp: Date.now() });
  // Giữ tối đa MAX_HISTORY tin
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  conversationStore.set(chatId, history);
}

function clearHistory(chatId: number) {
  conversationStore.delete(chatId);
}

function normalizeFoodName(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getPendingMealEstimate(chatId: number): PendingMealEstimate | null {
  const pending = pendingMealEstimateStore.get(chatId);
  if (!pending) return null;
  if (Date.now() - pending.createdAt > PENDING_MEAL_TTL_MS) {
    pendingMealEstimateStore.delete(chatId);
    return null;
  }
  return pending;
}

function setPendingMealEstimate(chatId: number, estimate: PendingMealEstimate) {
  pendingMealEstimateStore.set(chatId, estimate);
}

function clearPendingMealEstimate(chatId: number) {
  pendingMealEstimateStore.delete(chatId);
}

// Các khung giờ nhắc uống nước (9h, 11h, 14h, 16h, 20h, 22h)
const REMINDER_HOURS = ['0 9 * * *', '0 11 * * *', '0 14 * * *', '0 16 * * *', '0 20 * * *', '0 22 * * *'];

const WATER_MESSAGES = [
  "Bắt đầu ngày mới bằng vài ngụm nước để giữ năng lượng ổn định.",
  "Một nhịp nghỉ ngắn để bổ sung nước và giữ sự tập trung.",
  "Cơ thể đang cần nước để hỗ trợ vận động, trao đổi chất và phục hồi.",
  "Tạm dừng 30 giây. Uống chậm vài ngụm để duy trì hiệu suất trong ngày.",
  "Bổ sung nước vừa đủ cho buổi tối, nhẹ nhàng và không quá sát giờ ngủ.",
  "Kết ngày bằng một lượng nước nhỏ để cơ thể dễ chịu hơn khi nghỉ ngơi."
];
const WATER_PER_CONFIRM_ML = 250;

let botInstance: TelegramBot | null = null;
let remindersInitialized = false;
const reminderTasks: Array<{ stop: () => void }> = [];
let pollingStartRequested = false;

function isEnvEnabled(value: string | undefined): boolean {
  return ['true', '1', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isTelegramPollingEnabled(): boolean {
  if (process.env.TELEGRAM_ENABLE_POLLING === 'false' || process.env.TELEGRAM_FORCE_ENABLE === 'false') {
    return false;
  }
  return true;
}

function startTelegramPolling(bot: TelegramBot) {
  if (pollingStartRequested) return;
  pollingStartRequested = true;

  bot.deleteWebHook()
    .catch((err: any) => {
      console.warn('⚠️ Không thể xóa Telegram webhook cũ trước khi polling:', err?.message || err);
    })
    .finally(() => {
      bot.startPolling()
        .then(() => {
          console.log('✅ Telegram polling đã bật — bot đang lắng nghe tin nhắn và nút bấm.');
        })
        .catch((err: any) => {
          if (err?.code === 'ETELEGRAM' && String(err?.message || '').includes('409')) {
            console.error('⚠️ Telegram 409 Conflict: Có 2 instance bot đang kết nối cùng lúc (do Render đang deploy bản mới hoặc backend local đang chạy). Bot sẽ tự thử lại.');
          } else {
            console.error('❌ Không thể bật Telegram polling:', err?.message || err);
          }
        });
    });
}

function getVietnamDateKey(date = new Date()): string {
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
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getWeekStartKey(dateKey = getVietnamDateKey()): string {
  const date = new Date(`${dateKey}T00:00:00`);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getVietnamDayIndex(dateKey = getVietnamDateKey()): number {
  const day = new Date(`${dateKey}T00:00:00`).getDay();
  return day === 0 ? 6 : day - 1;
}

function formatNumber(value: unknown, fallback = '?') {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? String(Math.round(numberValue * 10) / 10) : fallback;
}

function compactLines(lines: string[], maxLines: number) {
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines), `... và ${lines.length - maxLines} mục khác`];
}

async function getLinkedTelegramUsers() {
  const { data: users, error } = await supabase
    .from('profiles')
    .select('telegram_chat_id, full_name, id, telegram_notify_water, telegram_notify_sleep, telegram_notify_workout, updated_at, created_at')
    .not('telegram_chat_id', 'is', null)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false, nullsFirst: false });

  if (error) throw error;
  const dedupedUsers = new Map<string, LinkedTelegramUserRow>();
  let duplicateCount = 0;

  for (const user of (users || []) as LinkedTelegramUserRow[]) {
    if (!user.telegram_chat_id) continue;
    if (dedupedUsers.has(user.telegram_chat_id)) {
      duplicateCount += 1;
      continue;
    }
    dedupedUsers.set(user.telegram_chat_id, user);
  }

  if (duplicateCount > 0) {
    console.warn(`⚠️ Telegram reminder deduped ${duplicateCount} duplicated profile link(s) by telegram_chat_id.`);
  }

  return Array.from(dedupedUsers.values());
}

async function getLinkedProfileByChatId(chatId: number): Promise<LinkedProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, gender, telegram_notify_water, telegram_notify_sleep, telegram_notify_workout, updated_at, created_at')
    .eq('telegram_chat_id', chatId.toString())
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(2);

  if (error) throw error;
  if (!data?.length) return null;
  if (data.length > 1) {
    console.warn(`⚠️ Multiple profiles linked to Telegram chat ${chatId}. Using the most recently updated profile.`);
  }
  return data[0] || null;
}

async function acquireReminderDispatchLock(reminderType: 'water' | 'sleep', slotLabel: string) {
  const reminderDate = getVietnamDateKey();
  const reminderKey = `${reminderType}:${reminderDate}:${slotLabel}`;
  const { error } = await supabase
    .from('telegram_reminder_dispatches')
    .insert({
      reminder_key: reminderKey,
      reminder_type: reminderType,
      reminder_date: reminderDate,
      slot_label: slotLabel,
    });

  if (!error) {
    return { acquired: true, reminderKey };
  }

  if (error.code === '23505') {
    return { acquired: false, reminderKey };
  }

  throw error;
}

async function updateDailyProgress(userId: string, updates: Record<string, number | string>, targetDate = getVietnamDateKey()) {
  const logDate = targetDate || getVietnamDateKey();
  const { data: existingLog, error: existingLogError } = await supabase
    .from('daily_progress_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('log_date', logDate)
    .limit(1)
    .maybeSingle();

  if (existingLogError) throw existingLogError;

  const saveResult = existingLog?.id
    ? await supabase
      .from('daily_progress_logs')
      .update(updates)
      .eq('id', existingLog.id)
    : await supabase
      .from('daily_progress_logs')
      .insert({
        user_id: userId,
        log_date: logDate,
        ...updates,
      });

  if (saveResult.error) throw saveResult.error;
}

async function addWaterIntake(userId: string, amountMl: number, targetDate = getVietnamDateKey()) {
  const logDate = targetDate || getVietnamDateKey();
  const { data: existingLog, error: existingLogError } = await supabase
    .from('daily_progress_logs')
    .select('id, water_intake_ml')
    .eq('user_id', userId)
    .eq('log_date', logDate)
    .limit(1)
    .maybeSingle();

  if (existingLogError) throw existingLogError;

  const nextWaterIntakeMl = (existingLog?.water_intake_ml || 0) + amountMl;
  await updateDailyProgress(userId, { water_intake_ml: nextWaterIntakeMl }, logDate);
  return nextWaterIntakeMl;
}

async function getHydrationSnapshot(userId: string, targetDate = getVietnamDateKey()) {
  const logDate = targetDate || getVietnamDateKey();
  const [logRes, lifestyleRes] = await Promise.all([
    supabase
      .from('daily_progress_logs')
      .select('water_intake_ml')
      .eq('user_id', userId)
      .eq('log_date', logDate)
      .maybeSingle(),
    supabase
      .from('lifestyle_settings')
      .select('daily_water_goal')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  const currentMl = logRes.data?.water_intake_ml || 0;
  const goalMl = Math.round((lifestyleRes.data?.daily_water_goal || 2) * 1000);
  const percent = Math.min(100, Math.round((currentMl / Math.max(goalMl, 1)) * 100));
  return { today: logDate, currentMl, goalMl, percent };
}

async function getSleepSnapshot(userId: string, targetDate = getVietnamDateKey()) {
  const logDate = targetDate || getVietnamDateKey();
  const yesterday = addDaysToDateKey(logDate, -1);
  const [todayLogRes, yesterdayLogRes, healthRes] = await Promise.all([
    supabase
      .from('daily_progress_logs')
      .select('sleep_hours')
      .eq('user_id', userId)
      .eq('log_date', logDate)
      .maybeSingle(),
    supabase
      .from('daily_progress_logs')
      .select('sleep_hours')
      .eq('user_id', userId)
      .eq('log_date', yesterday)
      .maybeSingle(),
    supabase
      .from('health_conditions')
      .select('sleep_hours, sleep_quality')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  return {
    today: logDate,
    yesterday,
    todaySleepHours: todayLogRes.data?.sleep_hours || 0,
    yesterdaySleepHours: yesterdayLogRes.data?.sleep_hours || 0,
    targetSleepHours: Number(healthRes.data?.sleep_hours || 8),
    sleepQuality: healthRes.data?.sleep_quality || 'chưa ghi',
  };
}

async function getTodayWorkoutReminderSnapshot(userId: string) {
  const today = getVietnamDateKey();
  const todayDayIndex = getVietnamDayIndex(today);
  const weekStartKey = getWeekStartKey(today);

  const sessionsRes = await supabase
    .from('daily_exercise_sessions')
    .select('is_completed, order_index, exercises:exercise_id(name)')
    .eq('user_id', userId)
    .eq('log_date', today)
    .order('order_index', { ascending: true });

  const sessions = (sessionsRes.data || []) as any[];
  if (sessions.length > 0) {
    const completedCount = sessions.filter((item) => item.is_completed).length;
    const names = compactLines(
      sessions.map((item) => `${item.is_completed ? '✓' : '•'} ${(item.exercises as any)?.name || 'Bài tập'}`),
      6
    );

    return [
      'Bài tập hôm nay',
      `${completedCount}/${sessions.length} bài đã hoàn thành`,
      ...names,
    ];
  }

  const plansRes = await supabase
    .from('weekly_plans')
    .select('id, name, created_at, updated_at')
    .eq('user_id', userId)
    .eq('week_start_date', weekStartKey)
    .eq('plan_status', 'active')
    .limit(20);

  const latestPlan = ((plansRes.data || []) as any[]).sort((a, b) =>
    new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime()
  )[0];

  if (!latestPlan?.id) {
    return ['Bài tập hôm nay', 'Chưa có lịch tập trong Fitly.'];
  }

  const planItemsRes = await supabase
    .from('weekly_plan_exercises')
    .select('sets, reps, is_rest_day, order_index, exercises:exercise_id(name)')
    .eq('weekly_plan_id', latestPlan.id)
    .eq('day_of_week', todayDayIndex)
    .order('order_index', { ascending: true });

  const planItems = ((planItemsRes.data || []) as any[]).filter((item) => !item.is_rest_day);
  if (!planItems.length) {
    return ['Bài tập hôm nay', 'Hôm nay là ngày nghỉ theo lịch tập.'];
  }

  const planLines = compactLines(
    planItems.map((item) => `• ${(item.exercises as any)?.name || 'Bài tập'} ${item.sets || 0}x${item.reps || '-'}`),
    6
  );

  return [
    `Bài tập hôm nay${latestPlan.name ? ` · ${latestPlan.name}` : ''}`,
    ...planLines,
  ];
}

function buildHydrationReminderText(
  user: { full_name?: string | null },
  message: string,
  snapshot: Awaited<ReturnType<typeof getHydrationSnapshot>>,
  workoutLines: string[] = []
) {
  const remainingMl = Math.max(0, snapshot.goalMl - snapshot.currentMl);
  const progressLine = `${snapshot.currentMl}/${snapshot.goalMl}ml · ${snapshot.percent}%`;
  return [
    'Fitly Daily Check-in',
    `Chào ${user.full_name || 'bạn'},`,
    message,
    '',
    ...(workoutLines.length ? [...workoutLines, ''] : []),
    'Nước hôm nay',
    progressLine,
    remainingMl > 0
      ? `Còn ${remainingMl}ml để đạt mục tiêu.`
      : 'Mục tiêu nước hôm nay đã hoàn thành.',
    '',
    'Ghi nhanh lượng nước vừa uống:',
  ].join('\n');
}

function buildSleepReminderText(user: { full_name?: string | null }, snapshot: Awaited<ReturnType<typeof getSleepSnapshot>>) {
  return [
    'Fitly Recovery Check-in',
    `Chào ${user.full_name || 'bạn'},`,
    'Ghi lại giấc ngủ để Fitly theo dõi phục hồi và điều chỉnh nhịp tập chính xác hơn.',
    '',
    'Giấc ngủ',
    `Mục tiêu: ${formatNumber(snapshot.targetSleepHours, '8')}h/đêm`,
    `Chất lượng đã khai báo: ${snapshot.sleepQuality}`,
    snapshot.yesterdaySleepHours
      ? `Hôm qua: ${snapshot.yesterdaySleepHours}h`
      : 'Hôm qua: chưa ghi nhận',
    '',
    'Đêm qua bạn ngủ bao lâu?',
  ].join('\n');
}

function buildSettingsKeyboard(profile: LinkedProfile): InlineKeyboardMarkup {
  const waterActive = profile.telegram_notify_water !== false;
  const sleepActive = profile.telegram_notify_sleep !== false;
  const workoutActive = profile.telegram_notify_workout !== false;

  return {
    inline_keyboard: [
      [
        {
          text: `💧 Nhắc uống nước: ${waterActive ? 'BẬT ✅' : 'TẮT ❌'}`,
          callback_data: 'setting_toggle_water',
        },
      ],
      [
        {
          text: `😴 Nhắc giấc ngủ: ${sleepActive ? 'BẬT ✅' : 'TẮT ❌'}`,
          callback_data: 'setting_toggle_sleep',
        },
      ],
      [
        {
          text: `🏋️ Nhắc bài tập: ${workoutActive ? 'BẬT ✅' : 'TẮT ❌'}`,
          callback_data: 'setting_toggle_workout',
        },
      ],
      [
        {
          text: '❌ Đóng cài đặt',
          callback_data: 'setting_close',
        },
      ],
    ],
  };
}

function buildSettingsText(profile: LinkedProfile) {
  const waterActive = profile.telegram_notify_water !== false;
  const sleepActive = profile.telegram_notify_sleep !== false;
  const workoutActive = profile.telegram_notify_workout !== false;

  return [
    '⚙️ CÀI ĐẶT THÔNG BÁO TELEGRAM',
    `Chào ${profile.full_name || 'bạn'}, bạn có thể bật/tắt các loại thông báo tự động từ Fitly AI Coach:`,
    '',
    `• 💧 Nhắc uống nước: ${waterActive ? 'BẬT ✅' : 'TẮT ❌'}`,
    `• 😴 Nhắc giấc ngủ: ${sleepActive ? 'BẬT ✅' : 'TẮT ❌'}`,
    `• 🏋️ Nhắc bài tập: ${workoutActive ? 'BẬT ✅' : 'TẮT ❌'}`,
    '',
    'Chạm vào các nút bên dưới để bật hoặc tắt trực tiếp:',
  ].join('\n');
}

async function sendSettingsMenu(bot: TelegramBot, chatId: number, existingProfile?: LinkedProfile | null) {
  const profile = existingProfile ?? (await getLinkedProfileByChatId(chatId).catch(() => null));
  if (!profile) {
    await bot.sendMessage(
      chatId,
      '❌ Bạn chưa liên kết tài khoản Fitly.\nVui lòng vào ứng dụng Fitly và nhấn "Kết nối Telegram Bot" trước khi cài đặt thông báo.'
    );
    return;
  }
  await bot.sendMessage(chatId, buildSettingsText(profile), {
    reply_markup: buildSettingsKeyboard(profile),
  });
}

function buildMainMenuKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '📊 Hôm nay', callback_data: 'menu_today' },
        { text: '💧 Ghi nước', callback_data: 'menu_water' },
      ],
      [
        { text: '😴 Ghi ngủ', callback_data: 'menu_sleep' },
        { text: '🧠 Hỏi AI Coach', callback_data: 'menu_coach' },
      ],
      [
        { text: '🏋️ Bài tập', callback_data: 'menu_workout' },
        { text: '🍽️ Thực đơn', callback_data: 'menu_meals' },
      ],
      [
        { text: '❤️ Sức khỏe', callback_data: 'menu_health' },
        { text: '⚙️ Cài đặt', callback_data: 'menu_settings' },
      ],
      [
        { text: 'ℹ️ Hướng dẫn', callback_data: 'menu_help' },
      ],
    ],
  };
}

function buildWaterKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '+250ml', callback_data: 'water_add_250' },
        { text: '+500ml', callback_data: 'water_add_500' },
      ],
      [
        { text: '+750ml', callback_data: 'water_add_750' },
        { text: '+1000ml', callback_data: 'water_add_1000' },
      ],
      [
        { text: '📊 Tiến độ hôm nay', callback_data: 'menu_today' },
        { text: '🧠 Hỏi Coach', callback_data: 'menu_coach' },
      ],
    ],
  };
}

function buildSleepKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '4h', callback_data: 'sleep_4' },
        { text: '5h', callback_data: 'sleep_5' },
        { text: '6h', callback_data: 'sleep_6' },
      ],
      [
        { text: '7h', callback_data: 'sleep_7' },
        { text: '8h', callback_data: 'sleep_8' },
        { text: '9h', callback_data: 'sleep_9' },
      ],
      [
        { text: '10h+', callback_data: 'sleep_10' },
        { text: '📊 Tiến độ hôm nay', callback_data: 'menu_today' },
      ],
    ],
  };
}

function buildHelpText(isLinked: boolean) {
  const linkedText = isLinked
    ? 'Tài khoản của bạn đã liên kết. Bot có thể ghi nhận dữ liệu trực tiếp vào Fitly.'
    : 'Bạn chưa liên kết tài khoản. Hãy dùng nút "Kết nối Telegram Bot" trong ứng dụng Fitly.';

  return [
    'Fitly AI Coach',
    linkedText,
    '',
    'Lệnh nhanh:',
    '/menu - mở bảng điều khiển',
    '/setting - cài đặt bật/tắt thông báo',
    '/today - xem tiến độ hôm nay',
    '/water - ghi nhanh lượng nước',
    '/sleep - ghi nhanh giấc ngủ',
    '/workout - xem bài tập gần đây và hôm nay',
    '/meals - xem thực đơn hôm nay',
    '/health - xem chỉ số sức khỏe/hồ sơ',
    '/clear - xoá ngữ cảnh trò chuyện',
    '',
    'Bạn cũng có thể nhắn tự nhiên, ví dụ:',
    '- Tôi uống 500ml nước',
    '- Tôi ngủ 7.5h',
    '- Hôm qua tôi tập bài gì?',
    '- Hôm trước đó tôi ngủ bao lâu?',
    '- Thực đơn hôm nay của tôi có gì?',
    '- Chỉ số sức khỏe của tôi đang thế nào?',
    '- Hôm nay nên tập gì?',
  ].join('\n');
}

async function buildTodaySummary(profile: LinkedProfile) {
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
    `📊 Tiến độ hôm nay (${today})`,
    `👤 ${profile.full_name || 'Bạn'}`,
    '',
    `💧 Nước: ${waterMl} / ${waterGoalMl}ml`,
    `🔥 Calo nạp: ${calories}${targetCalories ? ` / ${targetCalories} kcal` : ' kcal'}`,
    `😴 Ngủ: ${sleepHours ? `${sleepHours}h` : 'chưa ghi'}`,
    `🏋️ Bài tập: ${completedSessions}/${sessions.length} hoàn thành`,
  ].join('\n');
}

async function buildCoachDataContext(userId: string) {
  const today = getVietnamDateKey();
  const dateKeys = [today, addDaysToDateKey(today, -1), addDaysToDateKey(today, -2)];
  const weekStartKey = getWeekStartKey(today);
  const todayDayIndex = getVietnamDayIndex(today);

  const [
    bodyMetricsRes,
    bodyHistoryRes,
    lifestyleRes,
    healthRes,
    progressLogsRes,
    exerciseSessionsRes,
    weeklyPlansRes,
    foodPlansRes,
  ] = await Promise.all([
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

    return [
      `${dateKey}:`,
      `water=${log?.water_intake_ml || 0}ml`,
      `cal_in=${log?.calories_consumed || 0}kcal`,
      `cal_burn=${log?.calories_burned || 0}kcal`,
      `sleep=${log?.sleep_hours || 0}h`,
      `workout=${done}/${sessions.length}`,
      `items=${names}`,
    ].join(' ');
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

  const weekWorkoutLines = compactLines(
    weeklyExercises.map((item) => {
      if (item.is_rest_day) return `day ${item.day_of_week}: nghỉ`;
      const exercise = item.exercises as any;
      return `day ${item.day_of_week}: ${exercise?.name || 'Bài tập'} ${item.sets || 0}x${item.reps || '-'}`;
    }),
    24
  );

  const todayMealLines = compactLines(
    weeklyMeals
      .filter((item) => item.day_of_week === todayDayIndex && !item.is_rest_day)
      .map((item) => {
        const recipe = (item.recipes || item.foods) as any;
        const qty = Number(item.quantity || 1);
        return `${item.meal_type}: ${recipe?.name || 'Món ăn'} x${qty} (${Math.round(Number(item.calories || 0) * qty)}kcal, P${Math.round(Number(item.protein || 0) * qty)}g)`;
      }),
    12
  );

  const weekMealLines = compactLines(
    weeklyMeals.map((item) => {
      if (item.is_rest_day) return `day ${item.day_of_week}: nghỉ`;
      const recipe = (item.recipes || item.foods) as any;
      return `day ${item.day_of_week} ${item.meal_type}: ${recipe?.name || 'Món ăn'} x${item.quantity || 1}`;
    }),
    28
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
    `- week_plan: ${weekWorkoutLines.join(' | ') || 'chưa có dữ liệu'}`,
    '',
    `[THUC DON TUAN HIEN TAI ${weekStartKey}]`,
    `- plan=${latestFoodPlan?.name || 'chưa có thực đơn tuần'}`,
    `- today_meals: ${todayMealLines.join('; ') || 'chưa có thực đơn hôm nay'}`,
    `- week_meals: ${weekMealLines.join(' | ') || 'chưa có dữ liệu'}`,
  ].join('\n');
}

async function buildWorkoutReport(profile: LinkedProfile) {
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
      return `${item.is_completed ? '✅' : '⬜'} ${exercise?.name || 'Bài tập'} ${item.sets || 0}x${item.reps || '-'} ${item.weight_kg || 0}kg`;
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
    `🏋️ Bài tập của ${profile.full_name || 'bạn'}`,
    '',
    '3 ngày gần nhất:',
    ...recentLines,
    '',
    `Lịch hôm nay (${today})${latestPlan?.name ? ` - ${latestPlan.name}` : ''}:`,
    todayPlan.length ? todayPlan.join('\n') : 'Chưa có lịch tập hôm nay trong Fitly.',
  ].join('\n');
}

async function buildTelegramRuleBasedMealSuggestion(profile: LinkedProfile) {
  const [profileRes, bodyMetricsRes, lifestyleRes, healthRes, foodsRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', profile.id).maybeSingle(),
    supabase.from('body_metrics').select('weight').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('lifestyle_settings').select('*').eq('user_id', profile.id).maybeSingle(),
    supabase.from('health_conditions').select('*').eq('user_id', profile.id).maybeSingle(),
    supabase
      .from('recipes')
      .select('id, name, meal_type, calories, protein, carbs, fat, serving_unit, goal_type, allergens, dietary_restrictions, diet_styles, is_active, price_level')
      .eq('is_active', true)
      .limit(320),
  ]);
  const error = [profileRes.error, bodyMetricsRes.error, lifestyleRes.error, healthRes.error, foodsRes.error].find(Boolean);
  if (error) throw error;

  const lifestyle = lifestyleRes.data || {};
  const health = healthRes.data || {};
  const mealsPerDay = resolveMealsPerDay(lifestyle.meals_per_day);
  const foods = buildMealPlanningCatalog(foodsRes.data as any[], {
    profile: profileRes.data || profile,
    lifestyle,
    health,
    mealsPerDay,
    targetCalories: Number(lifestyle.target_calories || 0),
  }, 72);
  const nutritionTargets = calculateNutritionMacroTargets({
    targetCalories: lifestyle.target_calories,
    fitnessGoal: lifestyle.fitness_goal,
    dietPreference: lifestyle.diet_preference,
    weightKg: bodyMetricsRes.data?.weight,
  });
  const items = optimizeMealPlanQuantities(
    completeAiMealDay([], foods, mealsPerDay),
    foods,
    nutritionTargets,
    mealsPerDay,
  );
  const foodById = new Map(foods.map((food: any) => [String(food.id), food]));
  const slots = Array.from(new Set(getMealSlotsForCount(mealsPerDay)));
  const lines = slots.flatMap((mealType) => {
    const names = items
      .filter((item) => item.meal_type === mealType)
      .map((item) => {
        const food = foodById.get(item.food_id);
        const unit = String(food?.serving_unit || 'phần');
        const amount = unit.includes('100g') || unit.includes('100 g')
          ? `${Math.round(item.quantity * 100)}g`
          : item.quantity === 1 ? unit : `${item.quantity} x ${unit}`;
        return `${food?.name || 'Món ăn'} (${amount})`;
      });
    return names.length ? [`- ${mealType}: ${names.join(' + ')}`] : [];
  });
  if (!lines.length) return 'Mình chưa tìm được đủ món an toàn trong catalog để gợi ý hôm nay.';

  return [
    'Gợi ý tạm thời theo hồ sơ của bạn (chưa lưu thành meal plan):',
    ...lines,
    '',
    'Mở Fitly và chọn “Tạo thực đơn AI” để lưu thực đơn này vào kế hoạch.',
  ].join('\n');
}

async function buildMealReport(profile: LinkedProfile) {
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
    return `🍽️ Thực đơn hôm nay\n\nMình chưa thấy thực đơn tuần hiện tại trong Fitly.\n\n${await buildTelegramRuleBasedMealSuggestion(profile)}`;
  }

  const itemsRes = await supabase
    .from('weekly_food_items')
    .select('day_of_week, meal_type, quantity, calories, protein, carbs, fat, is_rest_day, order_index, recipes:recipe_id(name, meal_type, serving_unit)')
    .eq('food_plan_id', latestPlan.id)
    .eq('day_of_week', todayDayIndex)
    .order('order_index', { ascending: true });

  const items = ((itemsRes.data || []) as any[]).filter((item) => !item.is_rest_day);
  if (items.length === 0) {
    return `🍽️ Thực đơn hôm nay (${today})\n\nHôm nay đang được đánh dấu nghỉ hoặc chưa có món ăn trong meal plan.\n\n${await buildTelegramRuleBasedMealSuggestion(profile)}`;
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
    const recipe = (item.recipes || item.foods) as any;
    const qty = Number(item.quantity || 1);
    return `- ${item.meal_type}: ${recipe?.name || 'Món ăn'} x${qty} ${recipe?.serving_unit || ''} (${Math.round(Number(item.calories || 0) * qty)} kcal, P${Math.round(Number(item.protein || 0) * qty)}g)`;
  }), 12);

  return [
    `🍽️ Thực đơn hôm nay (${today})`,
    latestPlan.name || 'Meal plan',
    '',
    ...mealLines,
    '',
    `Tổng: ${Math.round(totals.kcal)} kcal | Protein ${Math.round(totals.protein)}g | Carb ${Math.round(totals.carbs)}g | Fat ${Math.round(totals.fat)}g`,
  ].join('\n');
}

async function buildHealthReport(profile: LinkedProfile) {
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
    `❤️ Hồ sơ sức khỏe của ${profile.full_name || 'bạn'}`,
    '',
    `Cơ thể: ${formatNumber(body?.weight)}kg, ${formatNumber(body?.height)}cm, mục tiêu ${formatNumber(body?.target_weight)}kg, body fat ${formatNumber(bodyFat, 'n/a')}%, eo ${formatNumber(body?.waist, 'n/a')}cm.`,
    `Mục tiêu: ${lifestyle?.fitness_goal || 'chưa ghi'} | Tần suất: ${lifestyle?.weekly_workouts || 'chưa ghi'} buổi/tuần | Nước: ${lifestyle?.daily_water_goal || 2}L/ngày.`,
    `Sức khỏe: bệnh lý=${health?.health_condition || 'không ghi'}, chấn thương=${health?.injuries || 'không ghi'}, thuốc=${health?.medications || 'không ghi'}, stress=${health?.stress_level || 'chưa ghi'}, giấc ngủ=${health?.sleep_quality || 'chưa ghi'}.`,
    '',
    'Lịch sử chỉ số gần nhất:',
    ...(historyLines.length ? historyLines : ['Chưa có lịch sử chỉ số.']),
  ].join('\n');
}

async function sendLongMessage(bot: TelegramBot, chatId: number, text: string) {
  const maxLength = 3900;
  if (text.length <= maxLength) {
    await bot.sendMessage(chatId, text);
    return;
  }

  for (let start = 0; start < text.length; start += maxLength) {
    await bot.sendMessage(chatId, text.slice(start, start + maxLength));
  }
}

type TelegramMediaKind = 'photo' | 'voice' | 'audio';

type TelegramMediaInfo = {
  kind: TelegramMediaKind;
  fileId: string;
  fileName: string;
  fileSize?: number;
  caption?: string;
};

function truncateTelegramText(value: string, maxLength: number) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function getVietnamHour(date = new Date()) {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: VIETNAM_TIMEZONE,
    hour: '2-digit',
    hour12: false,
  }).format(date);
  return Number(hour);
}

function inferMealTypeFromText(value: string): PendingMealEstimate['mealType'] {
  const normalized = normalizeFoodName(value);
  if (/\b(sang|breakfast|an sang)\b/.test(normalized)) return 'breakfast';
  if (/\b(trua|lunch|an trua)\b/.test(normalized)) return 'lunch';
  if (/\b(toi|dinner|an toi)\b/.test(normalized)) return 'dinner';
  if (/\b(phu|snack|an vat)\b/.test(normalized)) return 'snack';

  const hour = getVietnamHour();
  if (hour >= 5 && hour < 10) return 'breakfast';
  if (hour >= 10 && hour < 15) return 'lunch';
  if (hour >= 17 && hour < 22) return 'dinner';
  return 'snack';
}

function midpointFromMatch(first: string, second?: string) {
  const left = Number(first);
  const right = Number(second || first);
  if (!Number.isFinite(left)) return 0;
  if (!Number.isFinite(right)) return Math.round(left);
  return Math.round((left + right) / 2);
}

function extractCaloriesEstimate(value: string) {
  const text = String(value || '').replace(/,/g, '.');
  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:-|–|—|đến|den|to)\s*(\d+(?:\.\d+)?)\s*(?:kcal|calo|cal)\b/i);
  if (range) return midpointFromMatch(range[1], range[2]);
  const exact = text.match(/(\d+(?:\.\d+)?)\s*(?:kcal|calo|cal)\b/i);
  return exact ? Math.round(Number(exact[1])) : 0;
}

function extractMacroEstimate(value: string, labels: string[]) {
  const normalized = normalizeFoodName(String(value || '').replace(/,/g, '.'));
  const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = normalized.match(new RegExp(`(?:${labelPattern})[^0-9]{0,24}(\\d+(?:\\.\\d+)?)(?:\\s*(?:-|den|to)\\s*(\\d+(?:\\.\\d+)?))?\\s*g?\\b`, 'i'));
  return match ? midpointFromMatch(match[1], match[2]) : 0;
}

function extractFoodNameFromEstimate(reply: string, fallback?: string) {
  const fallbackText = String(fallback || '').trim();
  const lines = String(reply || '')
    .split('\n')
    .map((line) => line.replace(/^[-*•\d.\s]+/, '').trim())
    .filter(Boolean);
  const candidate = lines.find((line) => {
    const normalized = normalizeFoodName(line);
    return (
      normalized.length >= 8 &&
      normalized.length <= 140 &&
      /(mon|thanh phan|nhin thay|thay|co ve|gom)/i.test(normalized) &&
      !/(kcal|calo|protein|carb|fat|chat beo|dam)/i.test(normalized)
    );
  }) || lines.find((line) => {
    const normalized = normalizeFoodName(line);
    return normalized.length >= 8 && normalized.length <= 100 && !/(kcal|calo|protein|carb|fat)/i.test(normalized);
  });

  const cleaned = String(candidate || fallbackText || 'Bua an tu Telegram')
    .replace(/^(mon|cac mon|thanh phan|minh thay|mình thấy|nhin thay|nhìn thấy|co ve|có vẻ)\s*[:：-]?\s*/i, '')
    .replace(/^(trong anh|trong ảnh|bua nay|bữa này)\s*[:：-]?\s*/i, '')
    .trim();

  return truncateTelegramText(cleaned || 'Bua an tu Telegram', 120);
}

function inferEstimateConfidence(reply: string): PendingMealEstimate['confidence'] {
  const normalized = normalizeFoodName(reply);
  if (/khong ro|mo|kho nhin|thieu|uoc luong thap|low/.test(normalized)) return 'low';
  if (/ro|tuong doi chac|high|tin cay cao/.test(normalized)) return 'high';
  return 'medium';
}

function buildPendingMealEstimate({
  userId,
  reply,
  fallbackName,
  source,
  imageUrl,
  telegramFileId,
  transcript,
}: {
  userId?: string;
  reply: string;
  fallbackName?: string;
  source: PendingMealEstimate['source'];
  imageUrl?: string;
  telegramFileId?: string;
  transcript?: string;
}): PendingMealEstimate | null {
  const calories = extractCaloriesEstimate(reply);
  if (!calories) return null;
  const combinedText = [fallbackName, transcript, reply].filter(Boolean).join('\n');
  return {
    userId,
    foodName: extractFoodNameFromEstimate(reply, fallbackName || transcript),
    mealType: inferMealTypeFromText(combinedText),
    calories,
    protein: extractMacroEstimate(reply, ['protein', 'dam', 'chat dam', 'p']),
    carbs: extractMacroEstimate(reply, ['carbs', 'carb', 'tinh bot', 'duong bot', 'c']),
    fat: extractMacroEstimate(reply, ['fat', 'chat beo', 'beo', 'f']),
    source,
    confidence: inferEstimateConfidence(reply),
    imageUrl,
    telegramFileId,
    transcript,
    rawReply: reply,
    createdAt: Date.now(),
  };
}

function isPendingMealSaveRequest(message: string) {
  const normalized = normalizeFoodName(message);
  const wantsSave = /\b(ghi|luu|log|save|them|cong)\b/.test(normalized);
  const mentionsMeal = /\b(bua|mon|calo|kcal|cal|nay|hom nay|an)\b/.test(normalized);
  return wantsSave && mentionsMeal;
}

function getTelegramMediaInfo(msg: Message): TelegramMediaInfo | null {
  const caption = String(msg.caption || '').trim();
  const largestPhoto = msg.photo?.length ? msg.photo[msg.photo.length - 1] : null;
  if (largestPhoto?.file_id) {
    return {
      kind: 'photo',
      fileId: largestPhoto.file_id,
      fileName: 'telegram-meal-photo.jpg',
      fileSize: largestPhoto.file_size,
      caption,
    };
  }

  if (msg.voice?.file_id) {
    return {
      kind: 'voice',
      fileId: msg.voice.file_id,
      fileName: 'telegram-voice.ogg',
      fileSize: msg.voice.file_size,
      caption,
    };
  }

  if (msg.audio?.file_id) {
    return {
      kind: 'audio',
      fileId: msg.audio.file_id,
      fileName: 'telegram-audio.mp3',
      fileSize: msg.audio.file_size,
      caption,
    };
  }

  const document = msg.document;
  if (document?.file_id && document.mime_type?.startsWith('image/')) {
    return {
      kind: 'photo',
      fileId: document.file_id,
      fileName: document.file_name || 'telegram-meal-photo.jpg',
      fileSize: document.file_size,
      caption,
    };
  }

  if (document?.file_id && document.mime_type?.startsWith('audio/')) {
    return {
      kind: 'audio',
      fileId: document.file_id,
      fileName: document.file_name || 'telegram-audio.mp3',
      fileSize: document.file_size,
      caption,
    };
  }

  return null;
}

async function getLinkedProfileAndContext(chatId: number) {
  const profile = await getLinkedProfileByChatId(chatId).catch((error: any) => {
    console.error('[TELEGRAM_MEDIA] Failed to load linked profile:', error?.message || error);
    return null;
  });

  const coachContext = profile?.id
    ? await buildCoachDataContext(profile.id).catch((error: any) => {
      console.warn('[TELEGRAM_MEDIA] Failed to build coach context:', error?.message || error);
      return '';
    })
    : '';

  return { profile, coachContext };
}

async function incrementDailyCalories(userId: string, logDate: string, calories: number) {
  const { data: existingLog } = await supabase
    .from('daily_progress_logs')
    .select('id, calories_consumed')
    .eq('user_id', userId)
    .eq('log_date', logDate)
    .maybeSingle();

  if (existingLog) {
    const { error } = await supabase.from('daily_progress_logs')
      .update({ calories_consumed: (Number(existingLog.calories_consumed) || 0) + calories })
      .eq('id', existingLog.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('daily_progress_logs')
      .insert({ user_id: userId, log_date: logDate, calories_consumed: calories });
    if (error) throw error;
  }
}

async function upsertUserCustomFood(userId: string, estimate: PendingMealEstimate, calories: number) {
  const normalizedName = normalizeFoodName(estimate.foodName) || `custom-${Date.now()}`;
  const { data: existing, error: selectError } = await supabase
    .from('user_custom_foods')
    .select('id, usage_count')
    .eq('user_id', userId)
    .eq('normalized_name', normalizedName)
    .maybeSingle();

  if (selectError) {
    console.warn('[TELEGRAM_MEAL_LOG] user_custom_foods select failed:', selectError.message);
    return null;
  }

  const nowIso = new Date().toISOString();
  const payload = {
    name: estimate.foodName,
    normalized_name: normalizedName,
    serving_description: '1 bua/khau phan uoc tinh tu Telegram',
    calories,
    protein: estimate.protein || 0,
    carbs: estimate.carbs || 0,
    fat: estimate.fat || 0,
    source: estimate.source,
    confidence: estimate.confidence,
    image_url: estimate.imageUrl || null,
    telegram_file_id: estimate.telegramFileId || null,
    last_used_at: nowIso,
    updated_at: nowIso,
  };

  if (existing?.id) {
    const { data, error } = await supabase
      .from('user_custom_foods')
      .update({
        ...payload,
        usage_count: (Number(existing.usage_count) || 0) + 1,
      })
      .eq('id', existing.id)
      .select('id')
      .maybeSingle();
    if (error) {
      console.warn('[TELEGRAM_MEAL_LOG] user_custom_foods update failed:', error.message);
      return null;
    }
    return data?.id || existing.id;
  }

  const { data, error } = await supabase
    .from('user_custom_foods')
    .insert({
      user_id: userId,
      ...payload,
      usage_count: 1,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    console.warn('[TELEGRAM_MEAL_LOG] user_custom_foods insert failed:', error.message);
    return null;
  }
  return data?.id || null;
}

async function insertDailyMealLog(userId: string, logDate: string, estimate: PendingMealEstimate, customFoodId: string | null, calories: number) {
  const fullPayload = {
    user_id: userId,
    weekly_food_item_id: null,
    food_id: null,
    custom_food_id: customFoodId,
    custom_food_name: estimate.foodName,
    log_date: logDate,
    meal_type: estimate.mealType,
    quantity: 1,
    calories,
    protein: estimate.protein || 0,
    carbs: estimate.carbs || 0,
    fat: estimate.fat || 0,
    is_completed: true,
    eaten_at: new Date().toISOString(),
    source: estimate.source,
    confidence: estimate.confidence,
    image_url: estimate.imageUrl || null,
    telegram_file_id: estimate.telegramFileId || null,
    notes: estimate.transcript ? truncateTelegramText(estimate.transcript, 1000) : null,
    ai_estimate: {
      source: estimate.source,
      confidence: estimate.confidence,
      raw_reply: estimate.rawReply,
      transcript: estimate.transcript || null,
      image_url: estimate.imageUrl || null,
      telegram_file_id: estimate.telegramFileId || null,
    },
  };

  const { error } = await supabase.from('daily_meal_logs').insert(fullPayload);
  if (!error) return { detailSaved: true, customColumnsSaved: true };

  console.warn('[TELEGRAM_MEAL_LOG] daily_meal_logs full insert failed, retrying minimal payload:', error.message);
  const minimalPayload = {
    user_id: userId,
    weekly_food_item_id: null,
    food_id: null,
    log_date: logDate,
    meal_type: estimate.mealType,
    quantity: 1,
    calories,
    protein: estimate.protein || 0,
    carbs: estimate.carbs || 0,
    fat: estimate.fat || 0,
    is_completed: true,
    eaten_at: new Date().toISOString(),
  };
  const retry = await supabase.from('daily_meal_logs').insert(minimalPayload);
  if (retry.error) {
    console.warn('[TELEGRAM_MEAL_LOG] daily_meal_logs minimal insert failed:', retry.error.message);
    return { detailSaved: false, customColumnsSaved: false };
  }
  return { detailSaved: true, customColumnsSaved: false };
}

async function saveConfirmedMealEstimate(userId: string, chatId: number, caloriesOverride?: number) {
  const estimate = getPendingMealEstimate(chatId);
  if (!estimate || (estimate.userId && estimate.userId !== userId)) return null;

  const logDate = getVietnamDateKey();
  const calories = Math.max(1, Math.round(Number(caloriesOverride || estimate.calories || 0)));
  const customFoodId = await upsertUserCustomFood(userId, estimate, calories);
  const detailResult = await insertDailyMealLog(userId, logDate, estimate, customFoodId, calories);
  await incrementDailyCalories(userId, logDate, calories);
  clearPendingMealEstimate(chatId);

  const macroParts = [
    estimate.protein ? `P${Math.round(estimate.protein)}g` : '',
    estimate.carbs ? `C${Math.round(estimate.carbs)}g` : '',
    estimate.fat ? `F${Math.round(estimate.fat)}g` : '',
  ].filter(Boolean);
  const detailNote = detailResult.detailSaved
    ? 'da luu chi tiet vao daily_meal_logs'
    : 'da cong tong kcal, nhung chua luu duoc chi tiet bua an';
  const customNote = customFoodId ? 'va cap nhat user_custom_foods' : 'custom food chua duoc tao do DB chua san sang';

  return [
    `Da luu bua "${estimate.foodName}" (${calories} kcal${macroParts.length ? `, ${macroParts.join(', ')}` : ''})`,
    `${detailNote} ${customNote}.`,
  ].join(' ');
}

async function handleTelegramMediaMessage(bot: TelegramBot, msg: Message): Promise<boolean> {
  const media = getTelegramMediaInfo(msg);
  if (!media) return false;

  const chatId = msg.chat.id;
  const fileSize = Number(media.fileSize || 0);
  if (fileSize > TELEGRAM_MEDIA_MAX_BYTES) {
    await bot.sendMessage(chatId, 'File này hơi lớn cho demo hiện tại. Vui lòng gửi ảnh/ghi âm ngắn hơn.');
    return true;
  }

  try {
    await bot.sendChatAction(chatId, 'typing');
    const fileUrl = await bot.getFileLink(media.fileId);
    const { profile, coachContext } = await getLinkedProfileAndContext(chatId);
    const profileName = profile?.full_name || msg.from?.first_name || msg.from?.username || 'khách hàng';
    const history = getHistory(chatId).map((item) => ({ role: item.role, content: item.content }));

    if (media.kind === 'photo') {
      let reply = await analyzeMealPhotoCalories({
        imageUrl: fileUrl,
        userQuestion: media.caption,
        profileName,
        coachContext,
        history,
      });
      const pendingEstimate = buildPendingMealEstimate({
        userId: profile?.id,
        reply,
        fallbackName: media.caption || 'Bua an tu anh Telegram',
        source: 'telegram_photo_ai',
        imageUrl: fileUrl,
        telegramFileId: media.fileId,
      });
      if (pendingEstimate) {
        setPendingMealEstimate(chatId, pendingEstimate);
        reply = [
          reply,
          '',
          `Lưu bữa: nhắn "ghi ${pendingEstimate.calories} kcal".`,
        ].join('\n');
      }
      const userHistoryText = `[Anh bua an] ${media.caption || 'Hoi uoc tinh calories tu anh bua an.'}`;
      addToHistory(chatId, 'user', userHistoryText);
      addToHistory(chatId, 'assistant', reply);
      await sendLongMessage(bot, chatId, reply);
      return true;
    }

    const transcript = await transcribeTelegramAudio({
      fileUrl,
      fileName: media.fileName,
      language: 'vi',
      prompt: 'Nguoi dung Fitly noi tieng Viet ve bua an, calories, tap luyen hoac suc khoe.',
    });
    let reply = await answerVoiceCoachQuestion({
      transcript,
      userQuestion: media.caption,
      profileName,
      coachContext,
      history,
    });
    const pendingEstimate = buildPendingMealEstimate({
      userId: profile?.id,
      reply,
      fallbackName: media.caption,
      source: 'telegram_voice_ai',
      telegramFileId: media.fileId,
      transcript,
    });
    if (pendingEstimate) {
      setPendingMealEstimate(chatId, pendingEstimate);
      reply = [
        reply,
        '',
        `Lưu bữa: nhắn "ghi ${pendingEstimate.calories} kcal".`,
      ].join('\n');
    }
    const responseText = [
      `Mình nghe được: "${truncateTelegramText(transcript, 280)}"`,
      '',
      reply,
    ].join('\n');
    addToHistory(chatId, 'user', `[Ghi am] ${transcript}`);
    addToHistory(chatId, 'assistant', reply);
    await sendLongMessage(bot, chatId, responseText);
    return true;
  } catch (error: any) {
    console.error('[TELEGRAM_MEDIA] Failed to process media:', error?.message || error);
    const fallback = media.kind === 'photo'
      ? 'Mình chưa phân tích được ảnh bữa ăn này. Hãy thử gửi ảnh rõ hơn hoặc mô tả món ăn bằng text/ghi âm.'
      : 'Mình chưa xử lý được ghi âm này. Hãy thử ghi âm ngắn hơn hoặc nhắn nội dung bằng text.';
    await bot.sendMessage(chatId, fallback);
    return true;
  }
}

async function sendMainMenu(bot: TelegramBot, chatId: number, profile?: LinkedProfile | null) {
  const resolvedProfile = profile ?? await getLinkedProfileByChatId(chatId).catch(() => null);
  const greeting = resolvedProfile?.full_name ? `Chào ${resolvedProfile.full_name}.` : 'Chào bạn.';
  await bot.sendMessage(
    chatId,
    `${greeting}\nChọn một thao tác nhanh hoặc nhắn trực tiếp câu hỏi cho AI Coach.`,
    { reply_markup: buildMainMenuKeyboard() }
  );
}

async function requireLinkedProfile(bot: TelegramBot, chatId: number, queryId?: string) {
  const profile = await getLinkedProfileByChatId(chatId);
  if (!profile) {
    const message = 'Không tìm thấy tài khoản Fitly liên kết. Hãy kết nối Telegram Bot trong ứng dụng trước.';
    if (queryId) {
      await bot.answerCallbackQuery(queryId, { text: message });
    } else {
      await bot.sendMessage(chatId, message);
    }
    return null;
  }
  return profile;
}

export async function sendWaterReminders(bot: TelegramBot, slotIndex = 0) {
  const users = await getLinkedTelegramUsers();
  if (users.length === 0) {
    console.warn('⚠️ Nhắc uống nước: không có user nào liên kết Telegram.');
    return { sent: 0, failed: 0, total: 0 };
  }

  const message = WATER_MESSAGES[slotIndex % WATER_MESSAGES.length];
  let sent = 0;
  let failed = 0;

  for (const user of users) {
    if (user.telegram_notify_water === false) {
      continue; // Bỏ qua nếu người dùng đã tắt nhắc uống nước
    }
    try {
      const shouldIncludeWorkout = slotIndex === 0 && user.telegram_notify_workout !== false;
      const [snapshot, workoutLines] = await Promise.all([
        getHydrationSnapshot(user.id),
        shouldIncludeWorkout ? getTodayWorkoutReminderSnapshot(user.id) : Promise.resolve([] as string[]),
      ]);
      await bot.sendMessage(user.telegram_chat_id, buildHydrationReminderText(user, message, snapshot, workoutLines), {
        reply_markup: buildWaterKeyboard(),
      });
      sent += 1;
    } catch (err: any) {
      failed += 1;
      console.error('❌ Không gửi được nhắc nước tới mot tai khoan Telegram:', err.message);
    }
  }

  console.log(`💧 Đã gửi nhắc uống nước: ${sent}/${users.length} (slot ${slotIndex})`);
  return { sent, failed, total: users.length };
}

export async function sendSleepReminders(bot: TelegramBot) {
  const users = await getLinkedTelegramUsers();
  if (users.length === 0) {
    console.warn('⚠️ Hỏi giấc ngủ: không có user nào liên kết Telegram.');
    return { sent: 0, failed: 0, total: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const user of users) {
    if (user.telegram_notify_sleep === false) {
      continue; // Bỏ qua nếu người dùng đã tắt hỏi giấc ngủ
    }
    try {
      const snapshot = await getSleepSnapshot(user.id);
      await bot.sendMessage(
        user.telegram_chat_id,
        buildSleepReminderText(user, snapshot),
        {
          reply_markup: buildSleepKeyboard(),
        }
      );
      sent += 1;
    } catch (err: any) {
      failed += 1;
      console.error('❌ Không gửi được câu hỏi giấc ngủ tới mot tai khoan Telegram:', err.message);
    }
  }

  console.log(`😴 Đã gửi câu hỏi giấc ngủ: ${sent}/${users.length}`);
  return { sent, failed, total: users.length };
}

export async function getTelegramReminderStatus() {
  const users = await getLinkedTelegramUsers().catch(() => []);
  const botActive = !!token;
  return {
    botConfigured: !!token,
    botActive,
    runtime: process.env.NODE_ENV || 'development',
    pollingEnabled: botActive && isTelegramPollingEnabled(),
    remindersEnabled: botActive && process.env.TELEGRAM_ENABLE_REMINDERS !== 'false',
    serviceRoleConfigured: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    linkedUsers: users.length,
    reminderHours: ['09:00', '11:00', '14:00', '16:00', '20:00', '22:00'],
    sleepQuestionAt: '09:30',
    timezone: VIETNAM_TIMEZONE,
  };
}

const setupDailyReminders = (bot: TelegramBot) => {
  if (process.env.TELEGRAM_ENABLE_REMINDERS === 'false') {
    console.warn('⚠️ TELEGRAM_ENABLE_REMINDERS=false — bỏ qua lịch nhắc tự động.');
    return;
  }

  // 1. Nhắc uống nước (nhiều khung giờ)
  REMINDER_HOURS.forEach((schedule, index) => {
    const reminderTask = cron.schedule(
      schedule,
      async () => {
        console.log(`⏰ Cron nhắc uống nước (${schedule}) lúc ${new Date().toLocaleString('vi-VN', { timeZone: VIETNAM_TIMEZONE })}`);
        try {
          const dispatchLock = await acquireReminderDispatchLock('water', schedule);
          if (!dispatchLock.acquired) {
            console.warn(`⚠️ Bỏ qua nhắc uống nước trùng cho ${dispatchLock.reminderKey}.`);
            return;
          }
          await sendWaterReminders(bot, index);
        } catch (err: any) {
          console.error('❌ Lỗi gửi nhắc nhở nước:', err.message);
        }
      },
      { timezone: VIETNAM_TIMEZONE }
    );
    reminderTasks.push(reminderTask);
  });

  // 2. Hỏi về thời lượng giấc ngủ (9h30 sáng)
  const sleepReminderTask = cron.schedule(
    '30 9 * * *',
    async () => {
      console.log(`⏰ Cron hỏi giấc ngủ lúc ${new Date().toLocaleString('vi-VN', { timeZone: VIETNAM_TIMEZONE })}`);
      try {
        const dispatchLock = await acquireReminderDispatchLock('sleep', '09:30');
        if (!dispatchLock.acquired) {
          console.warn(`⚠️ Bỏ qua câu hỏi giấc ngủ trùng cho ${dispatchLock.reminderKey}.`);
          return;
        }
        await sendSleepReminders(bot);
      } catch (err: any) {
        console.error('❌ Lỗi gửi câu hỏi giấc ngủ:', err.message);
      }
    },
    { timezone: VIETNAM_TIMEZONE }
  );
  reminderTasks.push(sleepReminderTask);

  console.log('📅 Đã thiết lập lịch nhắc nhở Nước & Giấc ngủ (Asia/Ho_Chi_Minh).');
};

const setupCallbackHandlers = (bot: TelegramBot) => {
  bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat.id;
    const data = query.data;

    if (!chatId || !data) return;

    if (data === 'menu_help') {
      try {
        const profile = await getLinkedProfileByChatId(chatId).catch(() => null);
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(chatId, buildHelpText(!!profile), { reply_markup: buildMainMenuKeyboard() });
      } catch (err: any) {
        console.error('❌ Lỗi menu help:', err.message);
        await bot.answerCallbackQuery(query.id, { text: 'Có lỗi khi mở hướng dẫn.' });
      }
      return;
    }

    if (data === 'menu_settings') {
      try {
        await bot.answerCallbackQuery(query.id);
        await sendSettingsMenu(bot, chatId);
      } catch (err: any) {
        console.error('❌ Lỗi mở cài đặt:', err.message);
        await bot.answerCallbackQuery(query.id, { text: 'Có lỗi khi mở cài đặt.' });
      }
      return;
    }

    if (data === 'setting_close') {
      try {
        await bot.answerCallbackQuery(query.id, { text: 'Đã đóng bảng cài đặt.' });
        if (query.message?.message_id) {
          await bot.deleteMessage(chatId, query.message.message_id).catch(async () => {
            await bot.editMessageText('✅ Đã đóng bảng cài đặt thông báo.', {
              chat_id: chatId,
              message_id: query.message!.message_id,
            });
          });
        }
      } catch (err: any) {
        console.error('❌ Lỗi đóng cài đặt:', err.message);
      }
      return;
    }

    if (data === 'setting_toggle_water' || data === 'setting_toggle_sleep' || data === 'setting_toggle_workout') {
      try {
        const profile = await getLinkedProfileByChatId(chatId);
        if (!profile) {
          await bot.answerCallbackQuery(query.id, { text: 'Chưa liên kết tài khoản Fitly.' });
          return;
        }

        const fieldMap = {
          setting_toggle_water: 'telegram_notify_water',
          setting_toggle_sleep: 'telegram_notify_sleep',
          setting_toggle_workout: 'telegram_notify_workout',
        } as const;

        const targetField = fieldMap[data as keyof typeof fieldMap];
        const currentValue = profile[targetField] !== false;
        const newValue = !currentValue;

        const { error: updateErr } = await supabase
          .from('profiles')
          .update({ [targetField]: newValue, updated_at: new Date().toISOString() })
          .eq('id', profile.id);

        if (updateErr) throw updateErr;

        const updatedProfile: LinkedProfile = {
          ...profile,
          [targetField]: newValue,
        };

        const labelMap = {
          setting_toggle_water: 'Nhắc uống nước',
          setting_toggle_sleep: 'Nhắc giấc ngủ',
          setting_toggle_workout: 'Nhắc bài tập',
        };

        await bot.answerCallbackQuery(query.id, {
          text: `Đã ${newValue ? 'bật ✅' : 'tắt ❌'} ${labelMap[data as keyof typeof labelMap]}!`,
        });

        if (query.message?.message_id) {
          await bot.editMessageText(buildSettingsText(updatedProfile), {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: buildSettingsKeyboard(updatedProfile),
          });
        }
      } catch (err: any) {
        console.error('❌ Lỗi chuyển đổi cài đặt thông báo:', err.message);
        await bot.answerCallbackQuery(query.id, { text: 'Có lỗi xảy ra khi lưu cài đặt.' });
      }
      return;
    }

    if (data === 'menu_water') {
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(chatId, 'Chọn lượng nước muốn ghi nhận:', { reply_markup: buildWaterKeyboard() });
      return;
    }

    if (data === 'menu_sleep') {
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(chatId, 'Chọn thời lượng ngủ gần nhất:', { reply_markup: buildSleepKeyboard() });
      return;
    }

    if (data === 'menu_coach') {
      await bot.answerCallbackQuery(query.id);
      await bot.sendMessage(chatId, 'Bạn cứ nhắn câu hỏi trực tiếp cho AI Coach. Ví dụ: "Hôm nay tôi nên tập gì?" hoặc "Tối nay ăn gì để đủ protein?"');
      return;
    }

    if (data === 'menu_workout' || data === 'menu_meals' || data === 'menu_health') {
      try {
        const userProfile = await requireLinkedProfile(bot, chatId, query.id);
        if (!userProfile) return;
        await bot.answerCallbackQuery(query.id);
        const report = data === 'menu_workout'
          ? await buildWorkoutReport(userProfile)
          : data === 'menu_meals'
            ? await buildMealReport(userProfile)
            : await buildHealthReport(userProfile);
        await bot.sendMessage(chatId, report, { reply_markup: buildMainMenuKeyboard() });
      } catch (err: any) {
        console.error('❌ Lỗi mở dữ liệu nhanh:', err.message);
        await bot.answerCallbackQuery(query.id, { text: 'Có lỗi khi lấy dữ liệu.' });
      }
      return;
    }

    if (data === 'menu_today') {
      try {
        const userProfile = await requireLinkedProfile(bot, chatId, query.id);
        if (!userProfile) return;
        await bot.answerCallbackQuery(query.id);
        const summary = await buildTodaySummary(userProfile);
        await bot.sendMessage(chatId, summary, { reply_markup: buildMainMenuKeyboard() });
      } catch (err: any) {
        console.error('❌ Lỗi xem tiến độ hôm nay:', err.message);
        await bot.answerCallbackQuery(query.id, { text: 'Có lỗi khi lấy dữ liệu hôm nay.' });
      }
      return;
    }

    if (data === 'water_done' || data.startsWith('water_add_')) {
      const amountMl = data === 'water_done' ? WATER_PER_CONFIRM_ML : parseInt(data.replace('water_add_', ''), 10);
      if (!Number.isFinite(amountMl) || amountMl <= 0) {
        await bot.answerCallbackQuery(query.id, { text: 'Lượng nước không hợp lệ.' });
        return;
      }

      try {
        const userProfile = await requireLinkedProfile(bot, chatId, query.id);
        if (!userProfile) return;

        // Tính ngày mà thông báo/tin nhắn này được gửi đi (tránh việc click lại tin nhắn hôm qua bị lưu nhầm vào hôm nay)
        const messageTimeMs = query.message?.date ? query.message.date * 1000 : Date.now();
        const targetDateKey = getVietnamDateKey(new Date(messageTimeMs));
        const todayDateKey = getVietnamDateKey();
        const isPastDate = targetDateKey !== todayDateKey;

        const nextWaterIntakeMl = await addWaterIntake(userProfile.id, amountMl, targetDateKey);
        const snapshot = await getHydrationSnapshot(userProfile.id, targetDateKey);
        const dateLabel = isPastDate ? `ngày ${targetDateKey}` : 'hôm nay';

        await bot.answerCallbackQuery(query.id, {
          text: `Đã ghi nhận +${amountMl}ml (${dateLabel}). Tổng: ${nextWaterIntakeMl}/${snapshot.goalMl}ml.`
        });

        if (query.message?.message_id) {
          const remainingMl = Math.max(0, snapshot.goalMl - nextWaterIntakeMl);
          await bot.editMessageText([
            `✅ Đã ghi nhận nước uống (${dateLabel})`,
            '',
            `+${amountMl}ml vừa được lưu vào Fitly (${dateLabel}).`,
            `Tổng ${dateLabel}: ${nextWaterIntakeMl}/${snapshot.goalMl}ml (${snapshot.percent}%).`,
            remainingMl > 0
              ? `Còn khoảng ${remainingMl}ml để đạt mục tiêu.`
              : `Đã đạt mục tiêu nước ${dateLabel}.`,
          ].join('\n'), {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: buildMainMenuKeyboard(),
          });
        }
      } catch (err: any) {
        console.error('❌ Lỗi lưu nước uống:', err.message);
        await bot.answerCallbackQuery(query.id, { text: 'Có lỗi khi lưu dữ liệu.' });
      }

      return;
    }

    if (data.startsWith('sleep_')) {
      const hours = parseInt(data.replace('sleep_', ''));
      if (!Number.isFinite(hours) || hours <= 0) {
        await bot.answerCallbackQuery(query.id, { text: 'Thời lượng ngủ không hợp lệ.' });
        return;
      }

      try {
        const userProfile = await requireLinkedProfile(bot, chatId, query.id);
        if (!userProfile) {
          return;
        }

        const messageTimeMs = query.message?.date ? query.message.date * 1000 : Date.now();
        const targetDateKey = getVietnamDateKey(new Date(messageTimeMs));
        const todayDateKey = getVietnamDateKey();
        const isPastDate = targetDateKey !== todayDateKey;
        const dateLabel = isPastDate ? `ngày ${targetDateKey}` : 'hôm nay';

        await updateDailyProgress(userProfile.id, { sleep_hours: hours }, targetDateKey);
        const sleepNote = hours < 6
          ? 'Thời lượng hơi thấp. Nên ưu tiên phục hồi, tập nhẹ hơn nếu thấy mệt.'
          : hours <= 9
            ? 'Đây là mức ngủ tốt cho phục hồi và hiệu suất tập luyện.'
            : 'Ngủ nhiều hơn thường lệ. Nếu vẫn mệt, hãy theo dõi thêm chất lượng ngủ.';

        await bot.answerCallbackQuery(query.id, { text: `Đã ghi nhận ${hours}h ngủ (${dateLabel})! 🎉` });
        await bot.editMessageText([
          `✅ Đã ghi nhận giấc ngủ (${dateLabel})`,
          '',
          `Thời lượng: ${hours}h (${dateLabel})`,
          sleepNote,
          '',
          'Dữ liệu đã được cập nhật vào Fitly.',
        ].join('\n'), {
          chat_id: chatId,
          message_id: query.message?.message_id,
          reply_markup: buildMainMenuKeyboard(),
        });
      } catch (err: any) {
        console.error('❌ Lỗi lưu giấc ngủ:', err.message);
        await bot.answerCallbackQuery(query.id, { text: 'Có lỗi khi lưu dữ liệu.' });
      }
    }
  });
};

export const initTelegramBot = () => {
  if (process.env.TELEGRAM_BOT_ENABLED === 'false') {
    console.log('ℹ️ Telegram Bot đã tắt trên môi trường này (TELEGRAM_BOT_ENABLED=false).');
    return null;
  }

  if (!token) {
    console.warn('⚠️ TELEGRAM_BOT_TOKEN không tồn tại. Bot sẽ không được khởi chạy.');
    return null;
  }

  if (botInstance) {
    console.warn('⚠️ Telegram bot đã được khởi tạo — bỏ qua lần init trùng (tránh lỗi 409).');
    return botInstance;
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('⚠️ Thiếu SUPABASE_SERVICE_ROLE_KEY — cron nhắc nhở có thể không đọc được danh sách user.');
  }

  const enablePolling = isTelegramPollingEnabled();
  botInstance = new TelegramBot(token, { polling: false });

  if (enablePolling) {
    botInstance.on('polling_error', (err: any) => {
      if (err?.code === 'ETELEGRAM' && String(err?.message || '').includes('409')) {
        console.warn('⚠️ Telegram 409 Conflict: Có 2 instance bot đang kết nối cùng lúc (xảy ra vài giây khi Render deploy bản mới). Bot sẽ tự động kết nối lại.');
      } else {
        console.error('❌ Telegram polling_error:', err?.message || err);
      }
    });
  }

  const bot = botInstance;
  console.log('🤖 Telegram Bot [Render] đang chạy' + (enablePolling ? ' — sẽ bật polling sau khi gắn handlers.' : ' — chỉ gửi nhắc.'));

  bot.setMyCommands([
    { command: 'menu', description: 'Mở bảng điều khiển Fitly' },
    { command: 'today', description: 'Xem tiến độ hôm nay' },
    { command: 'workout', description: 'Xem bài tập gần đây và hôm nay' },
    { command: 'meals', description: 'Xem thực đơn hôm nay' },
    { command: 'health', description: 'Xem hồ sơ sức khỏe và chỉ số' },
    { command: 'water', description: 'Ghi nhanh lượng nước' },
    { command: 'sleep', description: 'Ghi nhanh giấc ngủ' },
    { command: 'help', description: 'Xem hướng dẫn sử dụng bot' },
    { command: 'clear', description: 'Xóa ngữ cảnh trò chuyện AI' },
  ]).catch((err: any) => {
    console.error('❌ Không thể cập nhật Telegram commands:', err?.message || err);
  });

  // Thiết lập lịch nhắc nhở (chỉ một lần)
  if (!remindersInitialized) {
    setupDailyReminders(bot);
    setupCallbackHandlers(bot);
    remindersInitialized = true;
  }

  // Lệnh /remindtest - gửi thử nhắc nhở cho chính user này
  bot.onText(/\/remindtest/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const profile = await getLinkedProfileByChatId(chatId).catch(() => null);
      const hydrationSnapshot = profile
        ? await getHydrationSnapshot(profile.id)
        : { today: getVietnamDateKey(), currentMl: 0, goalMl: 2000, percent: 0 };
      const sleepSnapshot = profile
        ? await getSleepSnapshot(profile.id)
        : { today: getVietnamDateKey(), yesterday: addDaysToDateKey(getVietnamDateKey(), -1), todaySleepHours: 0, yesterdaySleepHours: 0, targetSleepHours: 8, sleepQuality: 'chưa ghi' };

      await bot.sendMessage(chatId, buildHydrationReminderText(profile || { full_name: msg.from?.first_name }, '[TEST] Đây là mẫu nhắc uống nước mới.', hydrationSnapshot), {
        reply_markup: buildWaterKeyboard(),
      });
      await bot.sendMessage(chatId, buildSleepReminderText(profile || { full_name: msg.from?.first_name }, sleepSnapshot), {
        reply_markup: buildSleepKeyboard(),
      });
    } catch (err: any) {
      bot.sendMessage(chatId, `❌ Không gửi được nhắc thử: ${err.message}`);
    }
  });

  bot.onText(/\/(menu|startmenu)/, async (msg) => {
    await sendMainMenu(bot, msg.chat.id);
  });

  bot.onText(/\/help/, async (msg) => {
    const profile = await getLinkedProfileByChatId(msg.chat.id).catch(() => null);
    await bot.sendMessage(msg.chat.id, buildHelpText(!!profile), { reply_markup: buildMainMenuKeyboard() });
  });

  bot.onText(/\/today/, async (msg) => {
    try {
      const profile = await requireLinkedProfile(bot, msg.chat.id);
      if (!profile) return;
      const summary = await buildTodaySummary(profile);
      await bot.sendMessage(msg.chat.id, summary, { reply_markup: buildMainMenuKeyboard() });
    } catch (err: any) {
      console.error('❌ Lỗi /today:', err.message);
      await bot.sendMessage(msg.chat.id, 'Không lấy được tiến độ hôm nay. Vui lòng thử lại sau.');
    }
  });

  bot.onText(/\/workout/, async (msg) => {
    try {
      const profile = await requireLinkedProfile(bot, msg.chat.id);
      if (!profile) return;
      await bot.sendMessage(msg.chat.id, await buildWorkoutReport(profile), { reply_markup: buildMainMenuKeyboard() });
    } catch (err: any) {
      console.error('❌ Lỗi /workout:', err.message);
      await bot.sendMessage(msg.chat.id, 'Không lấy được dữ liệu bài tập. Vui lòng thử lại sau.');
    }
  });

  bot.onText(/\/meals/, async (msg) => {
    try {
      const profile = await requireLinkedProfile(bot, msg.chat.id);
      if (!profile) return;
      await bot.sendMessage(msg.chat.id, await buildMealReport(profile), { reply_markup: buildMainMenuKeyboard() });
    } catch (err: any) {
      console.error('❌ Lỗi /meals:', err.message);
      await bot.sendMessage(msg.chat.id, 'Không lấy được thực đơn. Vui lòng thử lại sau.');
    }
  });

  bot.onText(/\/health/, async (msg) => {
    try {
      const profile = await requireLinkedProfile(bot, msg.chat.id);
      if (!profile) return;
      await bot.sendMessage(msg.chat.id, await buildHealthReport(profile), { reply_markup: buildMainMenuKeyboard() });
    } catch (err: any) {
      console.error('❌ Lỗi /health:', err.message);
      await bot.sendMessage(msg.chat.id, 'Không lấy được hồ sơ sức khỏe. Vui lòng thử lại sau.');
    }
  });

  bot.onText(/\/(setting|settings)/, async (msg) => {
    await sendSettingsMenu(bot, msg.chat.id);
  });

  bot.onText(/\/water/, async (msg) => {
    const profile = await getLinkedProfileByChatId(msg.chat.id).catch(() => null);
    if (profile) {
      const snapshot = await getHydrationSnapshot(profile.id);
      await bot.sendMessage(msg.chat.id, buildHydrationReminderText(profile, 'Bạn có thể ghi nhanh lượng nước vừa uống.', snapshot), { reply_markup: buildWaterKeyboard() });
      return;
    }
    await bot.sendMessage(msg.chat.id, 'Chọn lượng nước muốn ghi nhận:', { reply_markup: buildWaterKeyboard() });
  });

  bot.onText(/\/sleep/, async (msg) => {
    const profile = await getLinkedProfileByChatId(msg.chat.id).catch(() => null);
    if (profile) {
      const snapshot = await getSleepSnapshot(profile.id);
      await bot.sendMessage(msg.chat.id, buildSleepReminderText(profile, snapshot), { reply_markup: buildSleepKeyboard() });
      return;
    }
    await bot.sendMessage(msg.chat.id, 'Chọn thời lượng ngủ gần nhất:', { reply_markup: buildSleepKeyboard() });
  });

  // Lệnh /status - kiểm tra trạng thái nhắc nhở
  bot.onText(/\/status/, async (msg) => {
    const status = await getTelegramReminderStatus();
    bot.sendMessage(
      msg.chat.id,
      `📊 Trạng thái Fitly Bot\n` +
        `- Môi trường: ${status.runtime}\n` +
        `- Bot active: ${status.botActive ? 'CÓ' : 'KHÔNG (chỉ Render)'}\n` +
        `- Liên kết Telegram: ${status.linkedUsers} user\n` +
        `- Nhắc tự động: ${status.remindersEnabled ? 'BẬT' : 'TẮT'}\n` +
        `- Polling chat: ${status.pollingEnabled ? 'BẬT' : 'TẮT'}\n` +
        `- Service role DB: ${status.serviceRoleConfigured ? 'OK' : 'THIẾU'}\n` +
        `- Giờ nhắc nước: ${status.reminderHours.join(', ')}\n` +
        `- Hỏi giấc ngủ: ${status.sleepQuestionAt}\n` +
        `- Múi giờ: ${status.timezone}`
    );
  });

  // Xử lý lệnh /start (kèm hoặc không kèm token liên kết, hỗ trợ suffix @botusername và khoảng trắng)
  bot.onText(/\/start(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const rawParam = match ? match[1]?.trim() : null;

    // Nếu có tham số và tham số đó không phải là username (@...)
    if (rawParam && !rawParam.startsWith('@')) {
      try {
        const verifiedToken = verifyTelegramLinkToken(rawParam);
        if (!verifiedToken?.userId) {
          await bot.sendMessage(chatId, '❌ Link liên kết không hợp lệ hoặc đã hết hạn. Vui lòng quay lại ứng dụng Fitly và nhấn "Kết nối Telegram Bot" để lấy link mới.');
          return;
        }
        const userId = verifiedToken.userId;

        const { error: unlinkDuplicateChatError } = await supabase
          .from('profiles')
          .update({ telegram_chat_id: null })
          .eq('telegram_chat_id', chatId.toString())
          .neq('id', userId);

        if (unlinkDuplicateChatError) throw unlinkDuplicateChatError;

        // Kiểm tra trước: có user này trong DB không
        const { data: existingProfile, error: checkError } = await supabase
          .from('profiles')
          .select('id, full_name')
          .eq('id', userId)
          .maybeSingle();

        if (checkError) throw checkError;

        if (!existingProfile) {
          await bot.sendMessage(chatId, '❌ Không tìm thấy tài khoản trong hệ thống.\n\nVui lòng:\n1. Đảm bảo bạn đã tạo hồ sơ trên website\n2. Đăng nhập và vào Cài đặt\n3. Nhấn lại nút "Kết nối Telegram Bot"');
          return;
        }

        // Cập nhật telegram_chat_id
        const { data: updatedData, error } = await supabase
          .from('profiles')
          .update({ telegram_chat_id: chatId.toString() })
          .eq('id', userId)
          .select();

        if (error) throw error;

        if (!updatedData || updatedData.length === 0) {
          throw new Error('Không thể cập nhật database (0 dòng bị ảnh hưởng). Lỗi này thường do backend thiếu SUPABASE_SERVICE_ROLE_KEY nên RLS trên Supabase từ chối quyền ghi.');
        }

        await bot.sendMessage(chatId, `🎉 Chúc mừng ${existingProfile.full_name || 'bạn'}!\n\nTài khoản Fitly của bạn đã được liên kết thành công.\n\nTừ giờ, tôi sẽ gửi báo cáo tập luyện và lời nhắc AI trực tiếp tại đây cho bạn. 💪`);
        await sendSettingsMenu(bot, chatId, existingProfile);
        await sendMainMenu(bot, chatId, existingProfile);
        return;
      } catch (err: any) {
        console.error('❌ Lỗi liên kết Telegram /start:', err.message);
        await bot.sendMessage(chatId, `❌ Lỗi xảy ra: ${err.message}\n\nVui lòng thử lại hoặc liên hệ hỗ trợ.`);
        return;
      }
    }

    // Trường hợp /start thông thường (không có token)
    try {
      const profile = await getLinkedProfileByChatId(chatId).catch(() => null);
      if (profile) {
        await bot.sendMessage(chatId, `🎉 Chào mừng ${profile.full_name || 'bạn'} quay lại với Fitly AI Coach! 💪`);
      } else {
        await bot.sendMessage(
          chatId,
          '🚀 Chào mừng bạn đến với Fitly AI Coach!\nTôi là trợ lý sức khỏe cá nhân của bạn, giúp theo dõi giấc ngủ, nước uống, dinh dưỡng và tập luyện.\n\nĐể cá nhân hóa và ghi dữ liệu tự động, hãy nhấn nút "Kết nối Telegram Bot" trong phần Cài đặt của ứng dụng Fitly nhé!'
        );
      }
      await sendMainMenu(bot, chatId, profile);
    } catch (err: any) {
      console.error('❌ Lỗi gửi menu /start:', err.message);
      await bot.sendMessage(chatId, 'Chào mừng bạn đến với Fitly AI Coach!\nVui lòng chọn một chức năng dưới đây:').catch(() => {});
      await sendMainMenu(bot, chatId).catch(() => {});
    }
  });

  // Lệnh /clear - Xóa lịch sử cuộc trò chuyện
  bot.onText(/\/clear/, (msg) => {
    clearHistory(msg.chat.id);
    bot.sendMessage(msg.chat.id, '🧹 Đã xóa lịch sử trò chuyện. Bạn có thể bắt đầu cuộc hội thoại mới!');
  });

  // Xử lý tin nhắn thông thường với AI
  bot.on('message', async (msg) => {
    const handledMedia = await handleTelegramMediaMessage(bot, msg);
    if (handledMedia) return;

    if (msg.text?.startsWith('/') || !msg.text) return;

    const chatId = msg.chat.id;
    const userMessage = msg.text;
    const senderName = msg.from?.first_name || msg.from?.username || 'User';

    try {
      // 1. Hiển thị trạng thái "đang gõ..."
      bot.sendChatAction(chatId, 'typing');

      // 2. Tìm thông tin người dùng từ DB dựa trên chatId
      console.log('💬 [CHAT] Received Telegram message');
      let userProfile: LinkedProfile | null = null;
      try {
        userProfile = await getLinkedProfileByChatId(chatId);
      } catch (profileError: any) {
        console.error(`❌ [CHAT] Lỗi truy vấn profiles:`, profileError.message);
        bot.sendMessage(chatId, 'Lỗi kết nối cơ sở dữ liệu. Vui lòng thử lại sau.');
        return;
      }

      if (!userProfile) {
        console.warn('⚠️ [CHAT] No linked profile found for Telegram chat.');
      }

      if (userProfile?.id) {
        console.log('✅ [CHAT] Linked profile found.');
        const today = getVietnamDateKey();

        // === PRE-PROCESSING: Phát hiện ý định ghi nước uống ===
        let actionLog = ""; // Ghi lại hành động đã thực hiện để báo cho AI
        const waterMatch = userMessage.match(/(\d+)\s*(ml|lít|lit|l)\b/i);
        if (waterMatch && /uống|nước|drink|water|thêm|cộng|log/i.test(userMessage)) {
          let waterMl = parseInt(waterMatch[1]);
          const unit = waterMatch[2].toLowerCase();
          if (unit === 'lít' || unit === 'lit' || unit === 'l') waterMl *= 1000;

          const { data: existingLog } = await supabase
            .from('daily_progress_logs')
            .select('id, water_intake_ml')
            .eq('user_id', userProfile.id)
            .eq('log_date', today)
            .maybeSingle();

          if (existingLog) {
            await supabase.from('daily_progress_logs')
              .update({ water_intake_ml: (existingLog.water_intake_ml || 0) + waterMl })
              .eq('id', existingLog.id);
          } else {
            await supabase.from('daily_progress_logs')
              .insert({ user_id: userProfile.id, log_date: today, water_intake_ml: waterMl });
          }
          actionLog += `✅ Đã ghi nhận ${waterMl}ml nước.\n`;
        }

        // === PRE-PROCESSING: Hoàn thành bài tập ===
        if (/hoàn thành|xong|done|finish|complete/i.test(userMessage) && /tất cả|all/i.test(userMessage)) {
          await supabase.from('daily_exercise_sessions')
            .update({ is_completed: true })
            .eq('user_id', userProfile.id)
            .eq('log_date', today);
          actionLog += `✅ Đã đánh dấu hoàn thành TẤT CẢ bài tập hôm nay.\n`;
        } else if (/hoàn thành|xong|done|finish|complete/i.test(userMessage)) {
          // Tìm tên bài tập trong tin nhắn
          const cleanMsg = userMessage.replace(/hoàn thành|xong|done|finish|complete|bài tập|bài/gi, '').trim();
          if (cleanMsg.length > 1) {
            const { data: matchedSessions } = await supabase
              .from('daily_exercise_sessions')
              .select('id, exercises:exercise_id(name)')
              .eq('user_id', userProfile.id)
              .eq('log_date', today)
              .eq('is_completed', false);
            
            if (matchedSessions) {
              const found = matchedSessions.find((s: any) => 
                (s.exercises as any)?.name?.toLowerCase().includes(cleanMsg.toLowerCase())
              );
              if (found) {
                await supabase.from('daily_exercise_sessions')
                  .update({ is_completed: true })
                  .eq('id', found.id);
                actionLog += `✅ Đã hoàn thành bài "${(found.exercises as any)?.name}".\n`;
              }
            }
          }
        }

        // === PRE-PROCESSING: Thêm bài tập (với sets/reps/kg/rest) ===
        if (/thêm|add/i.test(userMessage) && /bài tập|bài|exercise/i.test(userMessage)) {
          // Trích xuất thông số từ tin nhắn
          const setsMatch = userMessage.match(/(\d+)\s*(sets?|hiệp|set)/i);
          const repsMatch = userMessage.match(/(\d+)\s*(reps?|lần|rep)/i);
          const kgMatch = userMessage.match(/(\d+\.?\d*)\s*(kg|kí|ký)/i);
          const restMatch = userMessage.match(/(\d+)\s*(s|giây|sec|phút)/i);
          const shortMatch = userMessage.match(/(\d+)\s*x\s*(\d+)/i); // pattern 4x10

          const requestedSets = setsMatch ? parseInt(setsMatch[1]) : (shortMatch ? parseInt(shortMatch[1]) : 3);
          const sets = Math.max(1, Math.min(6, Number.isFinite(requestedSets) ? requestedSets : 3));
          const reps = repsMatch ? repsMatch[1] : (shortMatch ? shortMatch[2] : '12');
          const parsedWeightKg = kgMatch ? parseFloat(kgMatch[1]) : 0;
          const weightKg = Math.max(0, Math.min(500, Number.isFinite(parsedWeightKg) ? parsedWeightKg : 0));
          let restSeconds = 0;
          if (restMatch) {
            restSeconds = parseInt(restMatch[1]);
            if (/phút/i.test(restMatch[2])) restSeconds *= 60;
          } else {
            restSeconds = 60;
          }
          restSeconds = Math.max(30, Math.min(300, Number.isFinite(restSeconds) ? restSeconds : 60));

          // Tách tên bài tập (bỏ các keyword và số liệu)
          const cleanMsg = userMessage
            .replace(/thêm|add|cho tôi|giúp|bài tập|bài|exercise|hôm nay/gi, '')
            .replace(/\d+\s*(sets?|hiệp|reps?|lần|kg|kí|ký|s|giây|sec|phút|x\d+)/gi, '')
            .replace(/nghỉ|rest/gi, '')
            .trim();

          if (cleanMsg.length > 1) {
            const { data: exercise } = await supabase
              .from('exercises')
              .select('id, name, body_part, target_muscle, secondary_muscles, equipment, training_locations, difficulty, min_experience_months, progression_level, movement_pattern, goal_type, contraindications, calories_per_minute')
              .ilike('name', `%${cleanMsg}%`)
              .limit(1)
              .maybeSingle();
            
            const eligibility = exercise
              ? await getTelegramExerciseEligibilityDecision(userProfile.id, exercise)
              : null;
            if (exercise && eligibility?.eligible) {
              const { data: maxOrder } = await supabase
                .from('daily_exercise_sessions')
                .select('order_index')
                .eq('user_id', userProfile.id)
                .eq('log_date', today)
                .order('order_index', { ascending: false })
                .limit(1)
                .maybeSingle();

              await supabase.from('daily_exercise_sessions').insert({
                user_id: userProfile.id,
                exercise_id: exercise.id,
                log_date: today,
                sets,
                reps: String(reps),
                weight_kg: weightKg,
                rest_seconds: restSeconds,
                is_completed: false,
                order_index: Number(maxOrder?.order_index ?? -1) + 1
              });
              actionLog += `✅ Đã thêm "${exercise.name}" (${sets}x${reps} | ${weightKg}kg | nghỉ ${restSeconds}s).\n`;
            } else if (exercise) {
              actionLog += `⚠️ Bài "${exercise.name}" chưa phù hợp với nơi tập, dụng cụ, kinh nghiệm hoặc điều kiện an toàn hiện tại.\n`;
            } else {
              actionLog += `⚠️ Không tìm thấy bài "${cleanMsg}" trong thư viện.\n`;
            }
          }
        }

        // === PRE-PROCESSING: Xóa bài tập ===
        if (/xóa|xoá|bỏ|remove|delete/i.test(userMessage) && /bài tập|bài|exercise/i.test(userMessage)) {
          const cleanMsg = userMessage.replace(/xóa|xoá|bỏ|remove|delete|cho tôi|giúp|bài tập|bài|exercise|hôm nay/gi, '').trim();
          if (cleanMsg.length > 1) {
            const { data: sessions } = await supabase
              .from('daily_exercise_sessions')
              .select('id, exercises:exercise_id(name)')
              .eq('user_id', userProfile.id)
              .eq('log_date', today);
            
            if (sessions) {
              const found = sessions.find((s: any) =>
                (s.exercises as any)?.name?.toLowerCase().includes(cleanMsg.toLowerCase())
              );
              if (found) {
                await supabase.from('daily_exercise_sessions').delete().eq('id', found.id);
                actionLog += `✅ Đã xóa bài "${(found.exercises as any)?.name}" khỏi lịch hôm nay.\n`;
              }
            }
          }
        }

        // === PRE-PROCESSING: Chỉnh sửa thông số bài tập ===
        if (/chỉnh|sửa|đổi|update|edit|thay đổi/i.test(userMessage) && /bài|exercise|sets?|reps?|kg|hiệp|lần/i.test(userMessage)) {
          const setsMatch = userMessage.match(/(\d+)\s*(sets?|hiệp|set)/i);
          const repsMatch = userMessage.match(/(\d+)\s*(reps?|lần|rep)/i);
          const kgMatch = userMessage.match(/(\d+\.?\d*)\s*(kg|kí|ký)/i);
          const restMatch = userMessage.match(/(\d+)\s*(s|giây|sec|phút)/i);
          const shortMatch = userMessage.match(/(\d+)\s*x\s*(\d+)/i);

          // Tách tên bài
          const cleanMsg = userMessage
            .replace(/chỉnh|sửa|đổi|update|edit|thay đổi|cho tôi|giúp|bài tập|bài|exercise|hôm nay|thành/gi, '')
            .replace(/\d+\s*(sets?|hiệp|reps?|lần|kg|kí|ký|s|giây|sec|phút|x\d+)/gi, '')
            .replace(/nghỉ|rest/gi, '')
            .trim();

          if (cleanMsg.length > 1) {
            const { data: sessions } = await supabase
              .from('daily_exercise_sessions')
              .select('id, sets, reps, weight_kg, rest_seconds, exercises:exercise_id(name)')
              .eq('user_id', userProfile.id)
              .eq('log_date', today);

            if (sessions) {
              const found = sessions.find((s: any) =>
                (s.exercises as any)?.name?.toLowerCase().includes(cleanMsg.toLowerCase())
              );
              if (found) {
                const updates: any = {};
                if (setsMatch) updates.sets = parseInt(setsMatch[1]);
                else if (shortMatch) updates.sets = parseInt(shortMatch[1]);
                if (repsMatch) updates.reps = repsMatch[1];
                else if (shortMatch) updates.reps = shortMatch[2];
                if (kgMatch) updates.weight_kg = parseFloat(kgMatch[1]);
                if (restMatch) {
                  updates.rest_seconds = parseInt(restMatch[1]);
                  if (/phút/i.test(restMatch[2])) updates.rest_seconds *= 60;
                }

                if (Object.keys(updates).length > 0) {
                  await supabase.from('daily_exercise_sessions')
                    .update(updates)
                    .eq('id', found.id);
                  const parts = [];
                  if (updates.sets || updates.reps) parts.push(`${updates.sets || found.sets}x${updates.reps || found.reps}`);
                  if (updates.weight_kg !== undefined) parts.push(`${updates.weight_kg}kg`);
                  if (updates.rest_seconds) parts.push(`nghỉ ${updates.rest_seconds}s`);
                  actionLog += `✅ Đã cập nhật "${(found.exercises as any)?.name}" → ${parts.join(' | ')}.\n`;
                }
              }
            }
          }
        }

        const calMatch = userMessage.match(/(\d+)\s*(calo|kcal|cal)\b/i);
        const pendingMealEstimate = getPendingMealEstimate(chatId);
        const canSavePendingMeal = !!pendingMealEstimate && isPendingMealSaveRequest(userMessage);
        if ((calMatch && /ăn|eat|nạp|tiêu thụ|thêm|ghi|log|lưu|luu|save/i.test(userMessage)) || canSavePendingMeal) {
          const calories = calMatch ? parseInt(calMatch[1]) : Number(pendingMealEstimate?.calories || 0);
          const mealSaveLog = pendingMealEstimate
            ? await saveConfirmedMealEstimate(userProfile.id, chatId, calories)
            : null;

          if (mealSaveLog) {
            actionLog += `✅ ${mealSaveLog}\n`;
          } else {
            await incrementDailyCalories(userProfile.id, today, calories);
            actionLog += `✅ Đã ghi nhận ${calories} kcal.\n`;
          }
        }

        // === PRE-PROCESSING: Ghi giấc ngủ ===
        const sleepMatch = userMessage.match(/(\d+\.?\d*)\s*(tiếng|giờ|h|hour)/i);
        if (sleepMatch && /ngủ|sleep/i.test(userMessage)) {
          const hours = parseFloat(sleepMatch[1]);
          const { data: existingLog } = await supabase
            .from('daily_progress_logs')
            .select('id')
            .eq('user_id', userProfile.id)
            .eq('log_date', today)
            .maybeSingle();

          if (existingLog) {
            await supabase.from('daily_progress_logs')
              .update({ sleep_hours: hours })
              .eq('id', existingLog.id);
          } else {
            await supabase.from('daily_progress_logs')
              .insert({ user_id: userProfile.id, log_date: today, sleep_hours: hours });
          }
          actionLog += `✅ Đã ghi nhận ngủ ${hours} tiếng.\n`;
        }

        // Nếu đã liên kết, lấy thêm thông tin chi tiết và dữ liệu tracking hôm nay
        const [bodyMetrics, lifestyle, health, todayLog, todaySessions] = await Promise.all([
          supabase.from('body_metrics').select('*').eq('user_id', userProfile.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('lifestyle_settings').select('*').eq('user_id', userProfile.id).maybeSingle(),
          supabase.from('health_conditions').select('*').eq('user_id', userProfile.id).maybeSingle(),
          supabase.from('daily_progress_logs').select('*').eq('user_id', userProfile.id).eq('log_date', today).maybeSingle(),
          supabase.from('daily_exercise_sessions').select('is_completed, sets, reps, weight_kg, rest_seconds, exercises:exercise_id(name)').eq('user_id', userProfile.id).eq('log_date', today)
        ]);

        let todayStatus = "";
        const waterIntake = todayLog.data?.water_intake_ml || 0;
        const waterTarget = (lifestyle.data?.daily_water_goal || 2) * 1000;
        todayStatus += `- Nước: ${waterIntake}ml / ${waterTarget}ml\n`;
        todayStatus += `- Calo: ${todayLog.data?.calories_consumed || 0} kcal\n`;
        todayStatus += `- Ngủ: ${todayLog.data?.sleep_hours || 'chưa ghi'} tiếng\n`;

        if (todaySessions.data && todaySessions.data.length > 0) {
           const exercisesText = todaySessions.data.map((s: any) => {
             const name = (s.exercises as any)?.name || 'Bài tập';
             const status = s.is_completed ? '✅' : '⬜';
             return `${name} ${s.sets || 0}x${s.reps || '-'} ${s.weight_kg || 0}kg nghỉ${s.rest_seconds || 60}s ${status}`;
           });
           todayStatus += `- Bài tập (${todaySessions.data.length}):\n  ${exercisesText.join("\n  ")}\n`;
        } else {
           todayStatus += `- Bài tập: Trống\n`;
        }

        const trainingContext = await synchronizeTrainingProfileContext({
          userId: userProfile.id,
          profile: userProfile,
          lifestyle: lifestyle.data,
          health: health.data,
        });
        const trainingLifestyle = trainingContext.lifestyle;
        const weeklyWorkoutDays = trainingContext.trainingPrescription.weeklyWorkouts;
        const coachDataContext = await buildCoachDataContext(userProfile.id);

        let marketPriceContext = '';
        if (isMarketPriceQuery(userMessage)) {
          const priceData = await fetchRealtimeMarketPrices(userMessage);
          if (priceData && priceData.summary) {
            marketPriceContext = `[DỮ LIỆU GIÁ THỊ TRƯỜNG THỜI GIAN THỰC TRA CỨU TỪ WEB HÔM NAY (${priceData.searchedAt})]:\n${priceData.summary}\n`;
          }
        }

        // === XÂY DỰNG SYSTEM PROMPT CHUYÊN NGHIỆP ===
        const systemPrompt = `Bạn là "Fitly AI" — Huấn luyện viên cá nhân của ứng dụng Fitly.

[HỒ SƠ KHÁCH HÀNG]
- Tên: ${userProfile.full_name || 'Học viên'}
- Cân nặng: ${bodyMetrics.data?.weight || '?'}kg | Chiều cao: ${bodyMetrics.data?.height || '?'}cm
- Mục tiêu cân nặng: ${bodyMetrics.data?.target_weight || '?'}kg
- Mục tiêu tập: ${trainingLifestyle.fitness_goal || 'Nâng cao sức khỏe'}
- Trình độ: ${trainingLifestyle.experience_level || 'Chưa rõ'} | Tần suất tập: ${weeklyWorkoutDays} ngày/tuần
- Nơi tập: ${trainingLifestyle.workout_location || '?'} | Dụng cụ: ${trainingLifestyle.equipment_available || '?'}
- Thời lượng/buổi: ${trainingLifestyle.workout_duration || '?'} phút
- Budget: ${trainingLifestyle.budget_level || 'TB'}
- Bệnh lý: ${health.data?.health_condition || 'Không'} | Chấn thương: ${health.data?.injuries || 'Không'}
- Dị ứng: ${health.data?.allergies || 'Không'}

[QUY TẮC LẬP KẾ HOẠCH TẬP]
- Khi đề xuất lịch tập theo tuần, phân bổ đúng ${weeklyWorkoutDays} ngày tập và các ngày còn lại là nghỉ/phục hồi.

[TIẾN ĐỘ HÔM NAY ${today}]
${todayStatus}
${actionLog ? `[HỆ THỐNG VỪA THỰC HIỆN]\n${actionLog}` : ''}

[DU LIEU FITLY MO RONG]
${coachDataContext}
${marketPriceContext}

[QUY TAC SU DUNG DU LIEU]
- Khi người dùng hỏi "mai", "ngày mai", "tomorrow", dùng ngày mai (${addDaysToDateKey(today, 1)}) và day_of_week index = ${(getVietnamDayIndex(today) + 1) % 7} trong lịch tuần để trả lời.
- Khi người dùng hỏi "hôm qua", dùng ngày ${addDaysToDateKey(today, -1)} trong dữ liệu 3 ngày gần nhất.
- Khi người dùng hỏi "hôm kia", "hôm trước đó" hoặc "ngày kia trước", dùng ngày ${addDaysToDateKey(today, -2)}.
- Khi hỏi bài tập, ưu tiên daily_exercise_sessions nếu hỏi tiến độ đã tập; ưu tiên lịch tập tuần nếu hỏi hôm nay/tuần này nên tập gì.
- Khi hỏi thực đơn, dùng thực đơn tuần hiện tại và today_meals/week_meals. Nếu chưa có thực đơn, nói rõ chưa có dữ liệu và đề xuất phương án tạm thời.
- Khi hỏi chỉ số sức khỏe/cơ thể, dùng body, body_history, health và lifestyle; không tự bịa chỉ số thiếu.
- Nếu dữ liệu không có trong context, nói "mình chưa thấy dữ liệu này trong Fitly" rồi đề xuất cách ghi/cập nhật.
${COACH_RESPONSE_STYLE_RULES}

[PHONG CÁCH BỔ SUNG]
- Ưu tiên dữ liệu thật trong hồ sơ và tiến độ hôm nay; nếu thiếu dữ liệu, nói rõ giả định.
- Nếu hệ thống vừa ghi nhận hành động, xác nhận ngắn gọn trước rồi mới tư vấn.
- Khi lập bài tập/thực đơn, đưa ra bước cụ thể, sets/reps/rest hoặc khẩu phần/kcal/protein nếu có thể.
- Không chẩn đoán bệnh. Với đau ngực, chóng mặt, chấn thương nặng hoặc triệu chứng bất thường, khuyên ngừng tập và gặp bác sĩ.
- Tuyệt đối không bảo người dùng tham khảo/hỏi/gặp chuyên gia dinh dưỡng, dietitian, nutritionist hay nutrition expert.
- Nếu yêu cầu mơ hồ, hỏi tối đa 1 câu làm rõ; nếu vẫn có thể, đưa phương án mặc định an toàn.
- Luôn cá nhân hóa dựa trên hồ sơ khách hàng ở trên.`;

        // Xây dựng messages array với lịch sử hội thoại
        const history = getHistory(chatId);
        const responseText = await callCoachCompletion({
          systemPrompt,
          history: history.map((m) => ({ role: m.role, content: m.content })),
          userMessage,
          temperature: 0.7,
          maxTokens: 650,
        });

        // Lưu cả tin nhắn user và assistant vào bộ nhớ
        addToHistory(chatId, 'user', userMessage);
        addToHistory(chatId, 'assistant', responseText);

        // Gửi trả lời lại cho người dùng
        await sendLongMessage(bot, chatId, responseText);

      } else {
        // Người dùng chưa liên kết tài khoản
        console.log(`ℹ️ [CHAT] User chưa liên kết Telegram. Gợi ý liên kết.`);
        const guestSystemPrompt = `Bạn là "Fitly AI" — Huấn luyện viên cá nhân của ứng dụng Fitly.
Người dùng này CHƯA liên kết Telegram với tài khoản Fitly.
Hãy trả lời thân thiện, chuyên nghiệp, ngắn gọn. Nếu họ hỏi về fitness/dinh dưỡng thì vẫn trả lời nhưng nhắc nhẹ rằng nên liên kết tài khoản để được cá nhân hóa tốt hơn.
${COACH_RESPONSE_STYLE_RULES}
Tuyệt đối không bảo người dùng tham khảo/hỏi/gặp chuyên gia dinh dưỡng, dietitian, nutritionist hay nutrition expert.
Không chẩn đoán bệnh; với dấu hiệu nguy hiểm hoặc chấn thương nặng, khuyên gặp bác sĩ.
⚠️ HƯỚNG DẪN KẾT NỐI:
1. Vào website Fitly → Đăng nhập
2. Bấm Cài đặt (⚙️) ở thanh bên → Chọn "Kết nối Telegram Bot"
3. Bot này sẽ mở → Ngay lập tức BẤMSTART ở dưới cùng để hoàn tất liên kết.`;

        const history = getHistory(chatId);
        const responseText = await callCoachCompletion({
          systemPrompt: guestSystemPrompt,
          history: history.map((m) => ({ role: m.role, content: m.content })),
          userMessage,
          temperature: 0.7,
          maxTokens: 650,
        });

        addToHistory(chatId, 'user', userMessage);
        addToHistory(chatId, 'assistant', responseText);

        await sendLongMessage(bot, chatId, responseText);
      }

    } catch (err: any) {
      console.error('❌ Lỗi AI Telegram:', err.message);
      bot.sendMessage(chatId, 'Rất xin lỗi, hiện tại hệ thống AI đang bảo trì. Vui lòng thử lại sau ít phút nhé! 🔧');
    }
  });

  if (enablePolling) {
    startTelegramPolling(bot);
  } else {
    console.warn('⚠️ Telegram polling đang TẮT. Bot chỉ gửi được nhắc, không nhận được tin nhắn hoặc nút bấm.');
  }

  return bot;
};

export const stopTelegramBot = async () => {
  reminderTasks.splice(0).forEach((task) => task.stop());
  remindersInitialized = false;

  const bot = botInstance;
  botInstance = null;
  if (!bot) return;

  try {
    await bot.stopPolling();
  } catch (error: any) {
    console.warn('⚠️ Không thể dừng Telegram polling sạch sẽ:', error?.message || error);
  }
};
