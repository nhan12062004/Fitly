import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@/providers/auth-provider';
import { NotificationBootstrap } from '@/components/app/notification-bootstrap';
import { DataProvider } from '@/providers/data-provider';
import { StartupSplash } from '@/components/app/startup-splash';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

function AppContent() {
  const [showSplash, setShowSplash] = useState(true);
  const finishStartup = useCallback(() => setShowSplash(false), []);

  return (
    <View style={styles.container}>
      <View
        style={[styles.container, { pointerEvents: showSplash ? 'none' : 'auto' }]}
        accessibilityElementsHidden={showSplash}
        importantForAccessibility={showSplash ? 'no-hide-descendants' : 'auto'}
      >
        <NotificationBootstrap />
        <Stack screenOptions={{ headerShown: false }} />
      </View>
      {showSplash && <StartupSplash onFinish={finishStartup} />}
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider value={DarkTheme}>
        <StatusBar style="light" />
        <AuthProvider>
          <DataProvider>
            <AppContent />
          </DataProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
});
