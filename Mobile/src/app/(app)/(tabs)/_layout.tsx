import { useEffect, useState, type ComponentProps } from 'react';
import { Tabs } from 'expo-router';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/app-icon';
import { tokens } from '@/theme/tokens';

type TabIconName = Parameters<typeof AppIcon>[0]['name'];
type TabBarRenderer = NonNullable<ComponentProps<typeof Tabs>['tabBar']>;
type BottomTabBarProps = Parameters<TabBarRenderer>[0];

const tabMeta: Record<string, { label: string; icon: TabIconName }> = {
  home: { label: 'Hôm nay', icon: 'home' },
  workout: { label: 'Tập luyện', icon: 'workout' },
  coach: { label: 'Coach', icon: 'coach' },
  meals: { label: 'Dinh dưỡng', icon: 'meals' },
  profile: { label: 'Hồ sơ', icon: 'profile' },
};

function FitlyTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  if (keyboardVisible) return null;

  return (
    <View style={[styles.tabBarOuter, { paddingBottom: Math.max(insets.bottom, 5) }]}>
      <View style={styles.tabBar}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const meta = tabMeta[route.name];
          if (!meta) return null;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          return <Pressable key={route.key} accessibilityRole="button" accessibilityState={focused ? { selected: true } : {}} accessibilityLabel={meta.label} onPress={onPress} onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })} style={({ pressed }) => [styles.tabItem, pressed && styles.tabPressed]}>
            {focused ? <View style={styles.activeIndicator} /> : null}
            <View style={styles.iconBubble}><AppIcon name={meta.icon} color={focused ? tokens.colors.lime : '#8E9891'} size={21} strokeWidth={focused ? 2.2 : 1.9} /></View>
            <Text numberOfLines={1} style={[styles.label, focused && styles.labelActive]}>{meta.label}</Text>
          </Pressable>;
        })}
      </View>
    </View>
  );
}

export default function AppTabsLayout() {
  return (
    <Tabs tabBar={(props) => <FitlyTabBar {...props} />} screenOptions={{
      headerStyle: { backgroundColor: tokens.colors.canvas },
      headerTitleStyle: { color: tokens.colors.ink, fontWeight: '800' },
      headerShadowVisible: false,
      tabBarHideOnKeyboard: true,
      sceneStyle: { backgroundColor: tokens.colors.canvas },
    }}>
      <Tabs.Screen name="home" options={{ title: 'Hôm nay', headerShown: false }} />
      <Tabs.Screen name="workout" options={{ title: 'Tập luyện', headerShown: false }} />
      <Tabs.Screen name="coach" options={{ title: 'AI Coach', headerShown: false }} />
      <Tabs.Screen name="meals" options={{ title: 'Dinh dưỡng', headerShown: false }} />
      <Tabs.Screen name="profile" options={{ title: 'Hồ sơ', headerShown: false }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBarOuter: { backgroundColor: '#111412' },
  tabBar: { flexDirection: 'row', height: Platform.select({ ios: 50, default: 56 }), backgroundColor: '#111412', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#303630' },
  tabItem: { position: 'relative', flex: 1, alignItems: 'center', justifyContent: 'center', gap: 1, paddingTop: 3 },
  tabPressed: { opacity: 0.64 },
  activeIndicator: { position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: tokens.colors.lime },
  iconBubble: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  label: { color: '#8E9891', fontSize: 9, fontWeight: '800' },
  labelActive: { color: tokens.colors.lime, fontWeight: '900' },
});
