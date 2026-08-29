import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link } from 'expo-router';

import { Screen } from '@/components/ui/screen';
import { getVietnameseAuthError } from '@/lib/auth-errors';
import { supabaseConfigurationMessage } from '@/lib/runtime-config';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { tokens } from '@/theme/tokens';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const requestReset = async () => {
    const normalizedEmail = email.trim();
    if (!isSupabaseConfigured) {
      Alert.alert('Cần cấu hình', supabaseConfigurationMessage ?? 'Cấu hình Supabase chưa hợp lệ.');
      return;
    }
    if (!normalizedEmail) {
      Alert.alert('Nhập email', 'Hãy nhập email tài khoản trước khi yêu cầu khôi phục mật khẩu.');
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: Linking.createURL('reset-password'),
    });
    setIsSubmitting(false);

    if (error) {
      Alert.alert('Không thể gửi email', getVietnameseAuthError(error, 'Chưa thể gửi email đặt lại mật khẩu. Vui lòng thử lại.'));
      return;
    }
    Alert.alert('Kiểm tra email', 'Nếu email tồn tại, Fitly đã gửi link đặt lại mật khẩu. Hãy mở link trên thiết bị này để tiếp tục.');
  };

  return (
    <Screen keyboardAware backgroundColor={tokens.colors.authCanvas} contentStyle={styles.content}>
      <View style={styles.brandBlock}>
        <Text style={styles.eyebrow}>KHÔI PHỤC TÀI KHOẢN</Text>
        <Text style={styles.title}>Khôi phục mật khẩu</Text>
        <Text style={styles.lead}>Chúng tôi sẽ gửi một link an toàn để bạn đặt lại mật khẩu.</Text>
      </View>
      <View style={styles.form}>
        <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="Email" placeholderTextColor={tokens.colors.muted} style={styles.input} value={email} onChangeText={setEmail} />
        <Pressable disabled={isSubmitting} onPress={() => void requestReset()} style={({ pressed }) => [styles.button, (pressed || isSubmitting) && styles.buttonPressed]}>
          <Text style={styles.buttonText}>{isSubmitting ? 'Đang gửi email…' : 'Gửi link khôi phục'}</Text>
        </Pressable>
        <Link href="/sign-in" style={styles.backLink}>Quay lại đăng nhập</Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: tokens.spacing.xl, paddingBottom: tokens.spacing.xxl },
  brandBlock: { gap: tokens.spacing.sm },
  eyebrow: { color: tokens.colors.lime, fontSize: tokens.type.overline, fontWeight: '800', letterSpacing: 1.8 },
  title: { color: tokens.colors.ink, fontSize: 34, fontWeight: '900', letterSpacing: -1 },
  lead: { color: tokens.colors.muted, fontSize: 16, lineHeight: 24 },
  form: { gap: tokens.spacing.md, padding: tokens.spacing.xl, borderRadius: tokens.radius.lg, backgroundColor: tokens.colors.surfaceRaised, borderWidth: 1, borderColor: '#39433B' },
  input: { minHeight: 52, borderRadius: tokens.radius.md, paddingHorizontal: tokens.spacing.lg, backgroundColor: '#111711', color: tokens.colors.ink, fontSize: tokens.type.label, borderWidth: 1, borderColor: '#3A463C' },
  button: { minHeight: 52, borderRadius: tokens.radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.colors.lime, marginTop: tokens.spacing.sm },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: tokens.colors.canvas, fontSize: tokens.type.label, fontWeight: '900' },
  backLink: { color: tokens.colors.muted, fontSize: tokens.type.label, fontWeight: '700', textAlign: 'center', marginTop: tokens.spacing.sm },
});
