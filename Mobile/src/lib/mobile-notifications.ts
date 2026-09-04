import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

import { supabase } from '@/lib/supabase';

type NotificationsModule = typeof import('expo-notifications');

const SETTINGS_KEY = 'fitly-reminder-settings-v1';
const SCHEDULED_IDS_KEY = 'fitly-reminder-schedule-ids-v1';
const CHANNEL_ID = 'fitly-reminders';

export type ReminderSettings = {
  waterEnabled: boolean;
  waterTimes: string[];
  sleepEnabled: boolean;
  sleepTime: string;
  workoutEnabled: boolean;
  workoutTime: string;
  mealEnabled: boolean;
  mealTime: string;
  quietStart: string;
  quietEnd: string;
};

export const defaultReminderSettings: ReminderSettings = {
  waterEnabled: true,
  waterTimes: ['09:00', '11:00', '14:00', '16:00', '20:00'],
  sleepEnabled: true,
  sleepTime: '09:30',
  workoutEnabled: false,
  workoutTime: '07:00',
  mealEnabled: false,
  mealTime: '11:30',
  quietStart: '22:30',
  quietEnd: '07:00',
};

let notificationHandlerConfigured = false;

/** Avoid loading expo-notifications at all when this native client predates it. */
export const hasNativeNotifications = () => Boolean(requireOptionalNativeModule('ExpoPushTokenManager'));

const getNotifications = (): NotificationsModule | null => {
  if (!hasNativeNotifications()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
};

const parseTime = (value: string) => {
  const [rawHour, rawMinute] = value.split(':').map(Number);
  return { hour: Math.min(23, Math.max(0, Number.isFinite(rawHour) ? rawHour : 9)), minute: Math.min(59, Math.max(0, Number.isFinite(rawMinute) ? rawMinute : 0)) };
};

const dailyTrigger = (notifications: NotificationsModule, time: string): Parameters<NotificationsModule['scheduleNotificationAsync']>[0]['trigger'] => {
  const { hour, minute } = parseTime(time);
  return Platform.OS === 'ios'
    ? { type: notifications.SchedulableTriggerInputTypes.CALENDAR, hour, minute, repeats: true } as Parameters<NotificationsModule['scheduleNotificationAsync']>[0]['trigger']
    : { type: notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: CHANNEL_ID } as Parameters<NotificationsModule['scheduleNotificationAsync']>[0]['trigger'];
};

const isWithinQuietHours = (time: string, quietStart: string, quietEnd: string) => {
  const toMinutes = (value: string) => {
    const { hour, minute } = parseTime(value);
    return hour * 60 + minute;
  };
  const moment = toMinutes(time);
  const start = toMinutes(quietStart);
  const end = toMinutes(quietEnd);
  return start === end ? false : start < end ? moment >= start && moment < end : moment >= start || moment < end;
};

export async function initializeNativeNotifications() {
  const notifications = getNotifications();
  if (!notifications) return false;
  if (!notificationHandlerConfigured) {
    notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
    });
    notificationHandlerConfigured = true;
  }
  if (Platform.OS === 'android') {
    await notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Nhắc nhở Fitly',
      importance: notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 180, 120, 180],
      lightColor: '#B9FF3A',
    });
  }

  await Promise.allSettled([
    notifications.setNotificationCategoryAsync('fitly-water', [{ identifier: 'open-water', buttonTitle: 'Ghi nước' }]),
    notifications.setNotificationCategoryAsync('fitly-sleep', [{ identifier: 'open-sleep', buttonTitle: 'Ghi giấc ngủ' }]),
  ]);
  return true;
}

export async function loadReminderSettings(): Promise<ReminderSettings> {
  const raw = await SecureStore.getItemAsync(SETTINGS_KEY);
  if (!raw) return defaultReminderSettings;
  try {
    const parsed = JSON.parse(raw) as Partial<ReminderSettings>;
    return { ...defaultReminderSettings, ...parsed, waterTimes: Array.isArray(parsed.waterTimes) ? parsed.waterTimes.filter((time): time is string => typeof time === 'string') : defaultReminderSettings.waterTimes };
  } catch {
    return defaultReminderSettings;
  }
}

export async function saveReminderSettings(settings: ReminderSettings) {
  await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(settings));
}

export async function requestNotificationPermission() {
  const notifications = getNotifications();
  if (!notifications) return false;
  const current = await notifications.getPermissionsAsync();
  if (current.granted || current.ios?.status === notifications.IosAuthorizationStatus.PROVISIONAL) return true;
  const next = await notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
  return next.granted || next.ios?.status === notifications.IosAuthorizationStatus.PROVISIONAL;
}

/** Registers an Expo token after permission is granted. Safe to call at app start. */
export async function registerCurrentDeviceForPush() {
  const notifications = getNotifications();
  if (!notifications || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return null;
  const allowed = await requestNotificationPermission();
  if (!allowed) return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof projectId !== 'string' || !projectId) return null;
  const token = (await notifications.getExpoPushTokenAsync({ projectId })).data;
  const { error } = await supabase.rpc('register_mobile_push_device', {
    p_expo_push_token: token,
    p_platform: Platform.OS,
  });
  if (error) throw error;
  return token;
}

async function clearScheduledReminders() {
  const notifications = getNotifications();
  if (!notifications) return;
  const raw = await SecureStore.getItemAsync(SCHEDULED_IDS_KEY);
  const identifiers = raw ? JSON.parse(raw) as unknown : [];
  if (Array.isArray(identifiers)) await Promise.all(identifiers.filter((value): value is string => typeof value === 'string').map((identifier) => notifications.cancelScheduledNotificationAsync(identifier).catch(() => undefined)));
  await SecureStore.deleteItemAsync(SCHEDULED_IDS_KEY);
}

async function scheduleReminder(time: string, title: string, body: string, destination: string, categoryIdentifier?: string) {
  const notifications = getNotifications();
  if (!notifications) throw new Error('Bản ứng dụng này chưa hỗ trợ thông báo hệ thống. Hãy cài development build mới.');
  return notifications.scheduleNotificationAsync({ content: { title, body, sound: 'default', categoryIdentifier, data: { destination } }, trigger: dailyTrigger(notifications, time) });
}

export async function rescheduleLocalReminders(settings: ReminderSettings) {
  await clearScheduledReminders();
  const allowed = await requestNotificationPermission();
  if (!allowed) return false;

  const scheduled: Promise<string>[] = [];
  if (settings.waterEnabled) settings.waterTimes.filter((time) => !isWithinQuietHours(time, settings.quietStart, settings.quietEnd)).forEach((time) => scheduled.push(scheduleReminder(time, 'Nhắc uống nước', 'Dừng lại một chút và bổ sung nước cho cơ thể nhé.', '/tracking', 'fitly-water')));
  if (settings.sleepEnabled && !isWithinQuietHours(settings.sleepTime, settings.quietStart, settings.quietEnd)) scheduled.push(scheduleReminder(settings.sleepTime, 'Ghi lại giấc ngủ', 'Ghi số giờ ngủ để Fitly theo dõi nhịp phục hồi của bạn.', '/tracking', 'fitly-sleep'));
  if (settings.workoutEnabled && !isWithinQuietHours(settings.workoutTime, settings.quietStart, settings.quietEnd)) scheduled.push(scheduleReminder(settings.workoutTime, 'Buổi tập đã sẵn sàng', 'Dành một khoảng thời gian nhỏ cho mục tiêu hôm nay.', '/workout'));
  if (settings.mealEnabled && !isWithinQuietHours(settings.mealTime, settings.quietStart, settings.quietEnd)) scheduled.push(scheduleReminder(settings.mealTime, 'Đến giờ ghi bữa ăn', 'Ghi lại bữa ăn để theo dõi dinh dưỡng trong ngày.', '/meals'));

  const identifiers = await Promise.all(scheduled);
  await SecureStore.setItemAsync(SCHEDULED_IDS_KEY, JSON.stringify(identifiers));
  return true;
}
