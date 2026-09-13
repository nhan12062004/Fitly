import { useEffect } from 'react';
import { router } from 'expo-router';

import { clearScheduledReminders, hasNativeNotifications, initializeNativeNotifications, loadReminderSettings, registerCurrentDeviceForPush, rescheduleLocalReminders } from '@/lib/mobile-notifications';
import { useAuth } from '@/providers/auth-provider';

const validDestinations = new Set(['/tracking', '/workout', '/meals', '/coach', '/progress', '/notifications']);

export function NotificationBootstrap() {
  const { session, isLoading } = useAuth();
  const userId = session?.user.id;
  useEffect(() => {
    if (!hasNativeNotifications() || isLoading) return undefined;
    if (!userId) { void clearScheduledReminders().catch(() => undefined); return undefined; }
    let disposed = false;
    void initializeNativeNotifications().then(async () => {
      if (disposed) return;
      const settings = await loadReminderSettings();
      if (disposed) return;
      await rescheduleLocalReminders(settings, false);
      if (disposed) return;
      await registerCurrentDeviceForPush();
    }).catch(() => undefined);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Notifications = require('expo-notifications') as typeof import('expo-notifications');
      const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        const destination = response.notification.request.content.data?.destination;
        if (typeof destination === 'string' && validDestinations.has(destination)) router.push(destination as never);
      });
      return () => { disposed = true; subscription.remove(); };
    } catch {
      return () => { disposed = true; };
    }
  }, [userId, isLoading]);

  return null;
}
