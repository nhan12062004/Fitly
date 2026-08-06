import { Redirect, Stack } from 'expo-router';

import { LoadingScreen } from '@/components/ui/loading-screen';
import { useAuth } from '@/providers/auth-provider';

export default function ProtectedAppLayout() {
  const { isLoading, session } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!session) return <Redirect href="/sign-in" />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="recipe/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="progress" options={{ presentation: 'card' }} />
      <Stack.Screen name="profile/edit" options={{ presentation: 'card' }} />
      <Stack.Screen name="tracking" options={{ presentation: 'card' }} />
      <Stack.Screen name="notifications" options={{ presentation: 'card' }} />
      <Stack.Screen name="reminders" options={{ presentation: 'card' }} />
      <Stack.Screen name="challenges" options={{ presentation: 'card' }} />
      <Stack.Screen name="challenges/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="workout/detail/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="workout/[id]" options={{ presentation: 'card' }} />
    </Stack>
  );
}
