import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { tokens } from '@/theme/tokens';

export function LoadingScreen() {
  return (
    <View style={styles.container}>
      <ActivityIndicator color={tokens.colors.lime} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.colors.canvas },
});
