import { Tabs } from 'expo-router';

import { tokens } from '@/theme/tokens';

export default function AppTabsLayout() {
  return (
    <Tabs screenOptions={{
      headerStyle: { backgroundColor: tokens.colors.canvas },
      headerTitleStyle: { color: tokens.colors.ink, fontWeight: '800' },
      headerShadowVisible: false,
      tabBarActiveTintColor: tokens.colors.lime,
      tabBarInactiveTintColor: tokens.colors.muted,
      tabBarStyle: { backgroundColor: tokens.colors.surface, borderTopColor: tokens.colors.border },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
    }}>
      <Tabs.Screen name="home" options={{ title: 'Hôm nay', tabBarLabel: 'Hôm nay' }} />
      <Tabs.Screen name="workout" options={{ title: 'Tập luyện', tabBarLabel: 'Tập luyện' }} />
      <Tabs.Screen name="coach" options={{ title: 'AI Coach', tabBarLabel: 'Coach' }} />
      <Tabs.Screen name="meals" options={{ title: 'Dinh dưỡng', tabBarLabel: 'Dinh dưỡng' }} />
      <Tabs.Screen name="profile" options={{ title: 'Hồ sơ', tabBarLabel: 'Hồ sơ' }} />
    </Tabs>
  );
}
