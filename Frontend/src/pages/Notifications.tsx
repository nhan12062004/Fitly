import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, CalendarCheck, CheckCheck, CheckCircle2, ChevronRight, Droplet, Flame, Loader2, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/Supabase';
import {
  loadNotificationSnapshot,
  markAllUserNotificationsRead,
  markNotificationRead,
  recordSleepFromNotification,
  recordWaterFromNotification,
  type NotificationTone,
  type UserNotification,
} from '../lib/Notifications';

type NotificationFilter = 'all' | 'unread' | NotificationTone;

const FILTERS: Array<{ id: NotificationFilter; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'unread', label: 'Chưa đọc' },
  { id: 'workout', label: 'Lịch tập' },
  { id: 'nutrition', label: 'Dinh dưỡng' },
  { id: 'coach', label: 'AI Coach' },
  { id: 'progress', label: 'Tiến độ' },
  { id: 'system', label: 'Hệ thống' },
];

const TONE_META: Record<NotificationTone, { Icon: React.ElementType; bg: string; color: string; label: string }> = {
  workout: { Icon: CalendarCheck, bg: 'bg-accent/10', color: 'text-accent', label: 'Lịch tập' },
  nutrition: { Icon: Droplet, bg: 'bg-info/10', color: 'text-info', label: 'Dinh dưỡng' },
  coach: { Icon: MessageSquare, bg: 'bg-ai/10', color: 'text-ai', label: 'AI Coach' },
  progress: { Icon: Flame, bg: 'bg-warning/10', color: 'text-warning', label: 'Tiến độ' },
  system: { Icon: CheckCircle2, bg: 'bg-bg-tertiary', color: 'text-text-secondary', label: 'Hệ thống' },
};

const formatNotificationTime = (isoDate: string): string => {
  const then = new Date(isoDate).getTime();
  const diffMs = Date.now() - then;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (!Number.isFinite(then)) return 'Vừa xong';
  if (diffMs < minute) return 'Vừa xong';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} phút trước`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} giờ trước`;
  if (diffMs < day * 2) return 'Hôm qua';
  return `${Math.floor(diffMs / day)} ngày trước`;
};

const isWaterNotification = (item: UserNotification): boolean => {
  return item.tone === 'nutrition' && item.dedupe_key.startsWith('water:');
};

const isSleepNotification = (item: UserNotification): boolean => {
  return item.dedupe_key.startsWith('sleep:');
};

const WATER_QUICK_AMOUNTS = [250, 500, 750, 1000];
const SLEEP_QUICK_HOURS = [4, 5, 6, 7, 8, 9, 10];

export default function Notifications() {
  const { user, refreshTick } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [activeFilter, setActiveFilter] = useState<NotificationFilter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [recordingActionId, setRecordingActionId] = useState<string | null>(null);

  const unreadCount = notifications.filter((item) => !item.read_at).length;

  const loadNotifications = useCallback(async (syncActionable = false) => {
    if (!user?.id) {
      setNotifications([]);
      setIsLoading(false);
      return;
    }

    try {
      const items = await loadNotificationSnapshot(user.id,syncActionable);
      setNotifications(items);
    } catch (error) {
      console.error('Notifications page load error:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadNotifications(true);
  }, [loadNotifications, refreshTick]);

  useEffect(() => {
    if (!user?.id) return;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadNotifications(true);
    }, 60000);
    return () => window.clearInterval(intervalId);
  }, [loadNotifications, user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`notifications_page_${user.id}_${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${user.id}` }, () => {
        void loadNotifications(false);
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadNotifications, user?.id]);

  const filteredNotifications = useMemo(() => {
    if (activeFilter === 'all') return notifications;
    if (activeFilter === 'unread') return notifications.filter((item) => !item.read_at);
    return notifications.filter((item) => item.tone === activeFilter);
  }, [activeFilter, notifications]);

  const filterCounts = useMemo(() => {
    const counts: Record<NotificationFilter, number> = {
      all: notifications.length,
      unread: unreadCount,
      workout: 0,
      nutrition: 0,
      coach: 0,
      progress: 0,
      system: 0,
    };

    notifications.forEach((item) => {
      counts[item.tone] += 1;
    });

    return counts;
  }, [notifications, unreadCount]);

  const markAllRead = async () => {
    if (!user?.id || unreadCount === 0) return;
    const readAt = new Date().toISOString();
    setNotifications((items) => items.map((item) => ({ ...item, read_at: item.read_at || readAt })));
    try {
      await markAllUserNotificationsRead(user.id);
      await loadNotifications(false);
    } catch (error) {
      console.error('Notifications page mark all read error:', error);
      await loadNotifications(false);
    }
  };

  const openNotification = async (item: UserNotification) => {
    if (user?.id && !item.read_at) {
      const readAt = new Date().toISOString();
      setNotifications((items) => items.map((notification) => (
        notification.id === item.id ? { ...notification, read_at: readAt } : notification
      )));
      try {
        await markNotificationRead(user.id, item.id);
      } catch (error) {
        console.error('Notifications page mark read error:', error);
      }
    }
    navigate(item.href);
  };

  const recordWater = async (item: UserNotification, amountMl: number) => {
    if (!user?.id || recordingActionId) return;
    setRecordingActionId(`${item.id}:water:${amountMl}`);
    const readAt = new Date().toISOString();
    setNotifications((items) => items.map((notification) => (
      notification.id === item.id ? { ...notification, read_at: notification.read_at || readAt } : notification
    )));
    try {
      await recordWaterFromNotification(user.id, amountMl);
      await markNotificationRead(user.id, item.id);
      await loadNotifications(false);
    } catch (error) {
      console.error('Notifications page water record error:', error);
      await loadNotifications(false);
    } finally {
      setRecordingActionId(null);
    }
  };

  const recordSleep = async (item: UserNotification, sleepHours: number) => {
    if (!user?.id || recordingActionId) return;
    setRecordingActionId(`${item.id}:sleep:${sleepHours}`);
    const readAt = new Date().toISOString();
    setNotifications((items) => items.map((notification) => (
      notification.id === item.id ? { ...notification, read_at: notification.read_at || readAt } : notification
    )));
    try {
      await recordSleepFromNotification(user.id, sleepHours);
      await markNotificationRead(user.id, item.id);
      await loadNotifications(false);
    } catch (error) {
      console.error('Notifications page sleep record error:', error);
      await loadNotifications(false);
    } finally {
      setRecordingActionId(null);
    }
  };

  return (
    <div className="dashboard-page-shell flex flex-col gap-4 pb-4 text-sm md:gap-5 md:pb-6 lg:pb-7">
      <div className="flex flex-col gap-3 border-b border-border-primary pb-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-text-primary md:text-2xl">Thông báo</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-accent px-3 text-xs font-semibold text-text-inverse transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-45"
          >
            <CheckCheck className="h-4 w-4" />
            Đánh dấu đã đọc
          </button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto border-b border-border-primary pb-3 custom-scrollbar">
        {FILTERS.map((filter) => {
          const isActive = activeFilter === filter.id;
          return (
            <button
              key={filter.id}
              type="button"
              onClick={() => setActiveFilter(filter.id)}
              className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 border-b-2 px-1 text-xs font-semibold transition-colors ${
                isActive
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {filter.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${isActive ? 'bg-accent/10 text-accent' : 'bg-bg-tertiary text-text-tertiary'}`}>
                {filterCounts[filter.id]}
              </span>
            </button>
          );
        })}
      </div>

      <section className="min-h-[22rem]">
        {isLoading ? (
          <div className="flex min-h-[22rem] flex-col items-center justify-center px-4 text-center">
            <Loader2 className="mb-3 h-8 w-8 animate-spin text-text-tertiary" />
            <p className="text-sm font-semibold text-text-primary">Đang tải thông báo</p>
            <p className="mt-1 text-xs text-text-tertiary">Đồng bộ dữ liệu mới nhất của bạn...</p>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="flex min-h-[22rem] flex-col items-center justify-center px-4 text-center">
            <Bell className="mb-3 h-9 w-9 text-text-tertiary" />
            <p className="text-sm font-semibold text-text-primary">Không có thông báo phù hợp</p>
            <p className="mt-1 max-w-md text-xs text-text-tertiary">Thử đổi bộ lọc hoặc quay lại sau khi có cập nhật mới.</p>
          </div>
        ) : (
          <div className="divide-y divide-border-primary border-y border-border-primary">
            {filteredNotifications.map((item) => {
              const meta = TONE_META[item.tone];
              const Icon = meta.Icon;
              const isRead = Boolean(item.read_at);

              return (
                <div
                  key={item.id}
                  className={`group flex w-full flex-col gap-3 py-4 text-left transition-colors hover:bg-bg-tertiary md:px-2 lg:flex-row lg:items-start ${
                    isRead ? 'opacity-75' : 'bg-bg-tertiary/40'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => openNotification(item)}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                  >
                    <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${meta.bg}`}>
                      <Icon className={`h-4.5 w-4.5 ${meta.color}`} />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-text-primary group-hover:text-accent">{item.title}</span>
                            {!isRead && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />}
                          </span>
                          <span className="mt-1 block text-xs font-semibold uppercase tracking-[0.14em] text-text-tertiary">
                            {meta.label} · {formatNotificationTime(item.updated_at || item.created_at)}
                          </span>
                        </span>
                        <ChevronRight className="hidden h-4 w-4 shrink-0 text-text-tertiary transition-colors group-hover:text-accent sm:block" />
                      </span>
                      <span className="mt-2 block max-w-3xl text-sm leading-6 text-text-secondary">{item.message}</span>
                    </span>
                  </button>

                  {(isWaterNotification(item) || isSleepNotification(item)) && isRead && (
                    <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-accent/20 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent lg:self-start">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Đã ghi
                    </div>
                  )}

                  {isWaterNotification(item) && !isRead && (
                    <div className="flex shrink-0 flex-wrap gap-1.5 pl-13 lg:max-w-[15rem] lg:justify-end lg:pl-0">
                      {WATER_QUICK_AMOUNTS.map((amountMl) => {
                        const actionId = `${item.id}:water:${amountMl}`;
                        return (
                          <button
                            key={amountMl}
                            type="button"
                            onClick={() => recordWater(item, amountMl)}
                            disabled={Boolean(recordingActionId)}
                            className="inline-flex h-8 min-w-16 items-center justify-center rounded-full bg-info/10 px-3 text-xs font-semibold text-info transition-colors hover:bg-info/15 disabled:cursor-default disabled:opacity-60"
                          >
                            {recordingActionId === actionId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : `+${amountMl}ml`}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {isSleepNotification(item) && !isRead && (
                    <div className="flex shrink-0 flex-wrap gap-1.5 pl-13 lg:max-w-[15rem] lg:justify-end lg:pl-0">
                      {SLEEP_QUICK_HOURS.map((sleepHours) => {
                        const actionId = `${item.id}:sleep:${sleepHours}`;
                        return (
                          <button
                            key={sleepHours}
                            type="button"
                            onClick={() => recordSleep(item, sleepHours)}
                            disabled={Boolean(recordingActionId)}
                            className="inline-flex h-8 min-w-12 items-center justify-center rounded-full bg-warning/10 px-3 text-xs font-semibold text-warning transition-colors hover:bg-warning/15 disabled:cursor-default disabled:opacity-60"
                          >
                            {recordingActionId === actionId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : `${sleepHours}${sleepHours >= 10 ? 'h+' : 'h'}`}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
