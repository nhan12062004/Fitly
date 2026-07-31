import type { PropsWithChildren } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { tokens } from '@/theme/tokens';

type FoundationCardProps = PropsWithChildren<{ eyebrow?: string; title: string; description: string }>;

export function FoundationCard({ eyebrow, title, description, children }: FoundationCardProps) {
  return (
    <View style={styles.card}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: tokens.spacing.sm, padding: tokens.spacing.lg, borderRadius: tokens.radius.lg, backgroundColor: tokens.colors.surface, borderWidth: 1, borderColor: tokens.colors.border, ...tokens.shadow.card },
  eyebrow: { color: tokens.colors.lime, fontSize: tokens.type.overline, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { color: tokens.colors.ink, fontSize: 20, fontWeight: '800' },
  description: { color: tokens.colors.muted, fontSize: tokens.type.body, lineHeight: 22 },
});
