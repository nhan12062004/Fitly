import { StyleSheet } from 'react-native';
import { tokens } from '@/theme/tokens';

export const settingsStyles = StyleSheet.create({
  title: { color: tokens.colors.ink, fontSize: 28, fontWeight: '800' },
  subtitle: { color: tokens.colors.ink, fontSize: 18, fontWeight: '700' },
  body: { color: tokens.colors.muted, fontSize: 15, lineHeight: 23 },
  link: { color: tokens.colors.lime, fontSize: 15, lineHeight: 24 },
  linkButton: { minHeight: 48, justifyContent: 'center' },
  card: { padding: 20, gap: 12, borderRadius: 20, backgroundColor: tokens.colors.surfaceRaised },
  button: { minHeight: 48, padding: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.colors.lime },
  buttonText: { color: tokens.colors.canvas, fontSize: 15, fontWeight: '800' },
  input: { color: tokens.colors.ink, backgroundColor: tokens.colors.surfaceRaised, padding: 16, borderRadius: 14, fontSize: 16, minHeight: 52 },
  error: { color: tokens.colors.coral, fontSize: 14, lineHeight: 21 },
  disabled: { opacity: 0.5 },
  price: { color: tokens.colors.lime, fontWeight: '800', fontSize: 22 },
});
