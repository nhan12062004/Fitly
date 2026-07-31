import { Redirect, Slot } from 'expo-router';

import { LoadingScreen } from '@/components/ui/loading-screen';
import { useAuth } from '@/providers/auth-provider';

export default function ProtectedAppLayout() {
  const { isLoading, session } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!session) return <Redirect href="/sign-in" />;
  return <Slot />;
}
