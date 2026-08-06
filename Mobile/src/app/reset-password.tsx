import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { Screen } from '@/components/ui/screen';
import { getVietnameseAuthError } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';
import { tokens } from '@/theme/tokens';

function isStrongPassword(value: string) {
  return value.length >= 8 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value);
}

export default function ResetPasswordScreen() {
  const { isLoading, isPasswordRecovery, recoveryStatus, recoveryError, clearPasswordRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updatePassword = async () => {
    if (!isStrongPassword(password)) {
      Alert.alert('Mật khẩu chưa đủ mạnh', 'Dùng ít nhất 8 ký tự, bao gồm chữ hoa, chữ thường và số.');
      return;
    }
    if (password !== confirmation) {
      Alert.alert('Mật khẩu không khớp', 'Hãy nhập lại mật khẩu xác nhận.');
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) await supabase.auth.signOut();
    setIsSubmitting(false);

    if (error) {
      Alert.alert('Không thể cập nhật', getVietnameseAuthError(error, 'Chưa thể cập nhật mật khẩu. Vui lòng thử lại.'));
      return;
    }
    clearPasswordRecovery();
    Alert.alert('Đã cập nhật mật khẩu', 'Hãy đăng nhập lại bằng mật khẩu mới.');
    router.replace('/sign-in');
  };

  if (isLoading || recoveryStatus === 'processing') {
    return <Screen contentStyle={styles.centered}><Text style={styles.title}>Đang xác nhận link…</Text></Screen>;
  }

  if (!isPasswordRecovery) {
    return (
      <Screen contentStyle={styles.centered}>
        <Text style={styles.title}>Link không hợp lệ</Text>
        <Text style={styles.message}>{recoveryError ?? 'Link đặt lại mật khẩu đã hết hạn hoặc không được mở từ email.'}</Text>
        <Pressable onPress={() => router.replace('/forgot-password')} style={styles.button}>
          <Text style={styles.buttonText}>Gửi link mới</Text>
        </Pressable>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.brandBlock}>
        <Text style={styles.eyebrow}>BẢO MẬT TÀI KHOẢN</Text>
        <Text style={styles.title}>Đặt lại mật khẩu</Text>
        <Text style={styles.message}>Tài khoản của bạn đã được xác nhận. Tạo mật khẩu mới để tiếp tục.</Text>
      </View>
      <View style={styles.form}>
        <TextInput autoComplete="new-password" placeholder="Mật khẩu mới" placeholderTextColor={tokens.colors.muted} secureTextEntry style={styles.input} value={password} onChangeText={setPassword} />
        <TextInput autoComplete="new-password" placeholder="Xác nhận mật khẩu mới" placeholderTextColor={tokens.colors.muted} secureTextEntry style={styles.input} value={confirmation} onChangeText={setConfirmation} />
        <Text style={styles.requirements}>Ít nhất 8 ký tự, có chữ hoa, chữ thường và số.</Text>
        <Pressable disabled={isSubmitting} onPress={() => void updatePassword()} style={({ pressed }) => [styles.button, (pressed || isSubmitting) && styles.buttonPressed]}>
          <Text style={styles.buttonText}>{isSubmitting ? 'Đang cập nhật…' : 'Cập nhật mật khẩu'}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'space-between', paddingTop: tokens.spacing.hero, paddingBottom: tokens.spacing.xxl },
  centered: { justifyContent: 'center', alignItems: 'center', padding: tokens.spacing.xxl },
  brandBlock: { gap: tokens.spacing.sm },
  eyebrow: { color: tokens.colors.lime, fontSize: tokens.type.overline, fontWeight: '800', letterSpacing: 1.8 },
  title: { color: tokens.colors.ink, fontSize: 34, fontWeight: '900', letterSpacing: -1 },
  message: { color: tokens.colors.muted, fontSize: 16, lineHeight: 24, textAlign: 'center' },
  form: { gap: tokens.spacing.md, padding: tokens.spacing.xl, borderRadius: tokens.radius.lg, backgroundColor: tokens.colors.surface, borderWidth: 1, borderColor: tokens.colors.border },
  input: { minHeight: 52, borderRadius: tokens.radius.md, paddingHorizontal: tokens.spacing.lg, backgroundColor: tokens.colors.canvas, color: tokens.colors.ink, fontSize: tokens.type.label, borderWidth: 1, borderColor: tokens.colors.border },
  requirements: { color: tokens.colors.muted, fontSize: 12, lineHeight: 18 },
  button: { minHeight: 52, borderRadius: tokens.radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.colors.lime, marginTop: tokens.spacing.sm },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: tokens.colors.canvas, fontSize: tokens.type.label, fontWeight: '900' },
});
