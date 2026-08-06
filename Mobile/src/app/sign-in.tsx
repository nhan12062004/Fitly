import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link, Redirect, router, useLocalSearchParams } from 'expo-router';

import { Screen } from '@/components/ui/screen';
import { getVietnameseAuthError } from '@/lib/auth-errors';
import { supabaseConfigurationMessage } from '@/lib/runtime-config';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';
import { tokens } from '@/theme/tokens';

export default function SignInScreen() {
  const { session } = useAuth();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [isSignUp, setIsSignUp] = useState(params.mode === 'signup');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (session) return <Redirect href="/(app)/(tabs)/home" />;

  const submit = async () => {
    if (!isSupabaseConfigured) {
      Alert.alert('Cần cấu hình', `${supabaseConfigurationMessage ?? 'Cấu hình Supabase chưa hợp lệ.'} Hãy sao chép .env.example thành .env và điền giá trị public.`);
      return;
    }
    if (isSignUp) {
      const normalizedName = fullName.trim();
      const normalizedEmail = email.trim();
      if (!normalizedName || !normalizedEmail || !password) {
        Alert.alert('Thiếu thông tin', 'Hãy nhập họ tên, email và mật khẩu để tạo tài khoản.');
        return;
      }
      if (password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
        Alert.alert('Mật khẩu chưa đủ mạnh', 'Dùng ít nhất 8 ký tự, gồm chữ hoa, chữ thường và số.');
        return;
      }
      if (password !== confirmation) {
        Alert.alert('Mật khẩu không khớp', 'Hãy nhập lại mật khẩu xác nhận.');
        return;
      }
      setIsSubmitting(true);
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: { data: { full_name: normalizedName }, emailRedirectTo: Linking.createURL('sign-in') },
      });
      setIsSubmitting(false);
      if (error) {
        Alert.alert('Không thể đăng ký', getVietnameseAuthError(error, 'Đăng ký chưa thành công. Vui lòng thử lại.'));
        return;
      }
      if (data.user?.identities?.length === 0) {
        Alert.alert('Email đã được sử dụng', 'Email này đã có tài khoản. Hãy đăng nhập hoặc đặt lại mật khẩu.');
        return;
      }
      if (data.session) {
        router.replace('/(app)/(tabs)/home');
        return;
      }
      Alert.alert('Kiểm tra email', 'Fitly đã gửi email xác thực. Hãy mở email trên thiết bị này, xác thực tài khoản rồi đăng nhập.', [
        { text: 'Đăng nhập', onPress: () => setIsSignUp(false) },
      ]);
      return;
    }
    setIsSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setIsSubmitting(false);
    if (error) Alert.alert('Không thể đăng nhập', getVietnameseAuthError(error, 'Đăng nhập chưa thành công. Vui lòng thử lại.'));
  };

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.brandBlock}>
        <Text style={styles.eyebrow}>{isSignUp ? 'BẮT ĐẦU HÀNH TRÌNH' : 'TẬP LUYỆN · PHỤC HỒI · TIẾN BỘ'}</Text>
        <Text style={[styles.brand, isSignUp && styles.brandSignUp]}>{isSignUp ? 'Tạo tài khoản Fitly' : 'Fitly'}</Text>
        <Text style={styles.lead}>{isSignUp ? 'Kế hoạch tập luyện và dinh dưỡng dành cho bạn.' : 'Kế hoạch khỏe mạnh dành cho bạn.'}</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.formTitle}>{isSignUp ? 'Tạo tài khoản miễn phí' : 'Chào mừng trở lại'}</Text>
        {isSignUp && <TextInput accessibilityLabel="Họ và tên" autoComplete="name" placeholder="Họ và tên" placeholderTextColor={tokens.colors.muted} style={styles.input} value={fullName} onChangeText={setFullName} />}
        <TextInput accessibilityLabel="Địa chỉ email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="Địa chỉ email" placeholderTextColor={tokens.colors.muted} style={styles.input} value={email} onChangeText={setEmail} />
        <TextInput autoComplete={isSignUp ? "new-password" : "current-password"} placeholder="Mật khẩu" placeholderTextColor={tokens.colors.muted} secureTextEntry style={styles.input} value={password} onChangeText={setPassword} />
        {isSignUp && <TextInput accessibilityLabel="Xác nhận mật khẩu" autoComplete="new-password" placeholder="Xác nhận mật khẩu" placeholderTextColor={tokens.colors.muted} secureTextEntry style={styles.input} value={confirmation} onChangeText={setConfirmation} />}
        {isSignUp && <Text style={styles.requirements}>Ít nhất 8 ký tự, gồm chữ hoa, chữ thường và số.</Text>}
        <Pressable disabled={isSubmitting} onPress={() => void submit()} style={({ pressed }) => [styles.button, (pressed || isSubmitting) && styles.buttonPressed]}>
          <Text style={styles.buttonText}>{isSubmitting ? 'Đang xử lý…' : isSignUp ? 'Tạo tài khoản' : 'Đăng nhập'}</Text>
        </Pressable>
        {!isSignUp ? <Link href="/forgot-password" style={styles.resetLink}>Quên mật khẩu?</Link> : <Text style={styles.terms}>Khi đăng ký, bạn đồng ý với Điều khoản dịch vụ và Chính sách bảo mật của Fitly.</Text>}
        <View style={styles.switchRow}>
          <Text style={styles.note}>{isSignUp ? 'Đã có tài khoản?' : 'Chưa có tài khoản?'}</Text>
          <Pressable onPress={() => setIsSignUp(!isSignUp)}><Text style={styles.switchLink}>{isSignUp ? 'Đăng nhập' : 'Đăng ký miễn phí'}</Text></Pressable>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'space-between', paddingTop: tokens.spacing.xl, paddingBottom: tokens.spacing.lg },
  brandBlock: { gap: 6, paddingTop: 0 },
  eyebrow: { color: tokens.colors.lime, fontSize: tokens.type.overline, fontWeight: '800', letterSpacing: 1.8 },
  brand: { color: tokens.colors.ink, fontSize: 50, fontWeight: '900', letterSpacing: -2 },
  brandSignUp: { fontSize: 31, letterSpacing: -1 },
  lead: { maxWidth: 310, color: tokens.colors.muted, fontSize: 15, lineHeight: 21 },
  form: { gap: 10, padding: 20, borderRadius: 22, backgroundColor: tokens.colors.surface, borderWidth: 1, borderColor: tokens.colors.border },
  formTitle: { color: tokens.colors.ink, fontSize: 21, fontWeight: '800', marginBottom: 2 },
  input: { minHeight: 48, borderRadius: 14, paddingHorizontal: tokens.spacing.lg, backgroundColor: tokens.colors.canvas, color: tokens.colors.ink, fontSize: 15, borderWidth: 1, borderColor: tokens.colors.border },
  button: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.colors.lime, marginTop: 2 },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: tokens.colors.canvas, fontSize: tokens.type.label, fontWeight: '900' },
  resetLink: { color: tokens.colors.lime, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  requirements: { marginTop: -4, color: tokens.colors.muted, fontSize: 12, lineHeight: 18 },
  terms: { color: tokens.colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  switchRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 2 },
  note: { color: tokens.colors.muted, fontSize: 12 },
  switchLink: { color: tokens.colors.lime, fontSize: 12, fontWeight: '900' },
});
