import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@/providers/auth-provider';
import { NotificationBootstrap } from '@/components/app/notification-bootstrap';
import { DataProvider } from '@/providers/data-provider';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider value={DarkTheme}>
        <StatusBar style="light" />
        <AuthProvider>
          <DataProvider>
          <NotificationBootstrap />
          <Stack screenOptions={{ headerShown: false }} />
          </DataProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
