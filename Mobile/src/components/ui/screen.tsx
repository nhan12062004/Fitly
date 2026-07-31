import type { PropsWithChildren } from 'react';
import { ScrollView, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { tokens } from '@/theme/tokens';

type ScreenProps = PropsWithChildren<{
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}>;

export function Screen({ children, scroll = true, contentStyle }: ScreenProps) {
  const content = [styles.content, contentStyle];
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      {scroll ? <ScrollView contentContainerStyle={content}>{children}</ScrollView> : children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: tokens.colors.canvas },
  content: { flexGrow: 1, padding: tokens.spacing.xl, gap: tokens.spacing.lg },
});
