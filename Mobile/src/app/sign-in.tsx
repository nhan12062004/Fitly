import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link, Redirect } from 'expo-router';

import { Screen } from '@/components/ui/screen';
import { supabaseConfigurationMessage } from '@/lib/runtime-config';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';
import { tokens } from '@/theme/tokens';

export default function SignInScreen() {
  const { session } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (session) return <Redirect href="/(app)/(tabs)/home" />;

  const signIn = async () => {
    if (!isSupabaseConfigured) {
      Alert.alert('Cần cấu hình', `${supabaseConfigurationMessage ?? 'Cấu hình Supabase chưa hợp lệ.'} Hãy sao chép .env.example thành .env và điền giá trị public.`);
      return;
    }
    setIsSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setIsSubmitting(false);
    if (error) Alert.alert('Không thể đăng nhập', error.message);
  };

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.brandBlock}>
        <Text style={styles.eyebrow}>TRAIN · RECOVER · EVOLVE</Text>
        <Text style={styles.brand}>Fitly</Text>
        <Text style={styles.lead}>Your performance, built with intention.</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.formTitle}>Chào mừng trở lại</Text>
        <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="Email" placeholderTextColor={tokens.colors.muted} style={styles.input} value={email} onChangeText={setEmail} />
        <TextInput autoComplete="current-password" placeholder="Mật khẩu" placeholderTextColor={tokens.colors.muted} secureTextEntry style={styles.input} value={password} onChangeText={setPassword} />
        <Pressable disabled={isSubmitting} onPress={() => void signIn()} style={({ pressed }) => [styles.button, (pressed || isSubmitting) && styles.buttonPressed]}>
          <Text style={styles.buttonText}>{isSubmitting ? 'Đang đăng nhập…' : 'Đăng nhập'}</Text>
        </Pressable>
        <Link href="/forgot-password" style={styles.resetLink}>Quên mật khẩu?</Link>
        <Text style={styles.note}>Nhập email, chọn Quên mật khẩu và mở link trên thiết bị này.</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'space-between', paddingTop: tokens.spacing.hero, paddingBottom: tokens.spacing.xxl },
  brandBlock: { gap: tokens.spacing.sm },
  eyebrow: { color: tokens.colors.lime, fontSize: tokens.type.overline, fontWeight: '800', letterSpacing: 1.8 },
  brand: { color: tokens.colors.ink, fontSize: 56, fontWeight: '900', letterSpacing: -2 },
  lead: { color: tokens.colors.muted, fontSize: 18, lineHeight: 26 },
  form: { gap: tokens.spacing.md, padding: tokens.spacing.xl, borderRadius: tokens.radius.lg, backgroundColor: tokens.colors.surface, borderWidth: 1, borderColor: tokens.colors.border },
  formTitle: { color: tokens.colors.ink, fontSize: 22, fontWeight: '800', marginBottom: tokens.spacing.sm },
  input: { minHeight: 52, borderRadius: tokens.radius.md, paddingHorizontal: tokens.spacing.lg, backgroundColor: tokens.colors.canvas, color: tokens.colors.ink, fontSize: tokens.type.label, borderWidth: 1, borderColor: tokens.colors.border },
  button: { minHeight: 52, borderRadius: tokens.radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.colors.lime, marginTop: tokens.spacing.sm },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: tokens.colors.canvas, fontSize: tokens.type.label, fontWeight: '900' },
  resetLink: { color: tokens.colors.lime, fontSize: tokens.type.label, fontWeight: '800', textAlign: 'center' },
  note: { color: tokens.colors.muted, fontSize: 12, lineHeight: 18, marginTop: tokens.spacing.sm },
});
