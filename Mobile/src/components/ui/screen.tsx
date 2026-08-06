import type { PropsWithChildren } from 'react';
import { RefreshControl, ScrollView, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { tokens } from '@/theme/tokens';

type ScreenProps = PropsWithChildren<{
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  refreshing?: boolean;
  onRefresh?: () => void;
}>;

export function Screen({ children, scroll = true, contentStyle, refreshing = false, onRefresh }: ScreenProps) {
  const content = [styles.content, contentStyle];
  const pullToRefresh = onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[tokens.colors.lime]} tintColor={tokens.colors.lime} progressBackgroundColor="#151A16" /> : undefined;
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      {scroll ? <ScrollView contentContainerStyle={content} refreshControl={pullToRefresh}>{children}</ScrollView> : children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: tokens.colors.canvas },
  content: { flexGrow: 1, padding: tokens.spacing.xl, gap: tokens.spacing.lg },
});
