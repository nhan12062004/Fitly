import { Redirect } from 'expo-router';

import { LoadingScreen } from '@/components/ui/loading-screen';
import { useAuth } from '@/providers/auth-provider';

export default function IndexRoute() {
  const { isLoading, session } = useAuth();
  if (isLoading) return <LoadingScreen />;
  return <Redirect href={session ? '/(app)/(tabs)/home' : '/sign-in'} />;
}
