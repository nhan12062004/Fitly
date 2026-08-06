import { useEffect } from 'react';
import { router } from 'expo-router';

import { hasNativeNotifications, initializeNativeNotifications, registerCurrentDeviceForPush } from '@/lib/mobile-notifications';

const validDestinations = new Set(['/tracking', '/workout', '/meals', '/coach', '/progress', '/notifications']);

export function NotificationBootstrap() {
  useEffect(() => {
    if (!hasNativeNotifications()) return undefined;
    void initializeNativeNotifications().then(() => registerCurrentDeviceForPush()).catch(() => undefined);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Notifications = require('expo-notifications') as typeof import('expo-notifications');
      const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        const destination = response.notification.request.content.data?.destination;
        if (typeof destination === 'string' && validDestinations.has(destination)) router.push(destination as never);
      });
      return () => subscription.remove();
    } catch {
      return undefined;
    }
  }, []);

  return null;
}
