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
      <Stack.Screen name="workout/[id]" options={{ presentation: 'card' }} />
    </Stack>
  );
}
