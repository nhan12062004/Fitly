import { Tabs } from 'expo-router';

import { AppIcon } from '@/components/ui/app-icon';
import { tokens } from '@/theme/tokens';

export default function AppTabsLayout() {
  return (
    <Tabs screenOptions={{
      headerStyle: { backgroundColor: tokens.colors.canvas },
      headerTitleStyle: { color: tokens.colors.ink, fontWeight: '800' },
      headerShadowVisible: false,
      tabBarActiveTintColor: tokens.colors.lime,
      tabBarInactiveTintColor: tokens.colors.muted,
      tabBarStyle: { height: 70, paddingTop: 7, backgroundColor: tokens.colors.canvas, borderTopColor: tokens.colors.border },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '800' },
    }}>
      <Tabs.Screen name="home" options={{ title: 'Hôm nay', tabBarLabel: 'Hôm nay', tabBarIcon: ({ color, size }) => <AppIcon name="home" color={color} size={size} /> }} />
      <Tabs.Screen name="workout" options={{ title: 'Tập luyện', headerShown: false, tabBarLabel: 'Tập luyện', tabBarIcon: ({ color, size }) => <AppIcon name="workout" color={color} size={size} /> }} />
      <Tabs.Screen name="coach" options={{ title: 'AI Coach', headerShown: false, tabBarLabel: 'Coach', tabBarIcon: ({ color, size }) => <AppIcon name="coach" color={color} size={size} /> }} />
      <Tabs.Screen name="meals" options={{ title: 'Dinh dưỡng', headerShown: false, tabBarLabel: 'Dinh dưỡng', tabBarIcon: ({ color, size }) => <AppIcon name="meals" color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Hồ sơ', tabBarLabel: 'Hồ sơ', tabBarIcon: ({ color, size }) => <AppIcon name="profile" color={color} size={size} /> }} />
    </Tabs>
  );
}
