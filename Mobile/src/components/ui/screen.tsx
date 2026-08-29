import type { PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { tokens } from '@/theme/tokens';

type ScreenProps = PropsWithChildren<{
  scroll?: boolean;
  keyboardAware?: boolean;
  backgroundColor?: string;
  contentStyle?: StyleProp<ViewStyle>;
  refreshing?: boolean;
  onRefresh?: () => void;
}>;

export function Screen({ children, scroll = true, keyboardAware = false, backgroundColor, contentStyle, refreshing = false, onRefresh }: ScreenProps) {
  const content = [styles.content, contentStyle];
  const pullToRefresh = onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[tokens.colors.lime]} tintColor={tokens.colors.lime} progressBackgroundColor="#151A16" /> : undefined;
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={content}
      refreshControl={pullToRefresh}
      keyboardShouldPersistTaps={keyboardAware ? 'handled' : undefined}
      keyboardDismissMode={keyboardAware ? 'interactive' : undefined}
      automaticallyAdjustKeyboardInsets={keyboardAware}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : children;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safeArea, backgroundColor ? { backgroundColor } : undefined]}>
      {keyboardAware ? <KeyboardAvoidingView style={styles.keyboardAvoidingView} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>{body}</KeyboardAvoidingView> : body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: tokens.colors.canvas },
  keyboardAvoidingView: { flex: 1 },
  content: { flexGrow: 1, padding: tokens.spacing.xl, gap: tokens.spacing.lg },
});
