import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link, Redirect, router, useLocalSearchParams } from 'expo-router';

import { Screen } from '@/components/ui/screen';
import { getVietnameseAuthError } from '@/lib/auth-errors';
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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (session) return <Redirect href="/(app)/(tabs)/home" />;

  const submit = async () => {
    if (isSubmitting) return;
    if (!isSupabaseConfigured) {
      Alert.alert('Dịch vụ chưa sẵn sàng', 'Vui lòng thử lại sau hoặc liên hệ hỗ trợ Fitly.');
      return;
    }
    try {
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
    } catch (error) {
      Alert.alert('Chưa hoàn tất', getVietnameseAuthError(error, 'Kiểm tra kết nối rồi thử lại.'));
    } finally { setIsSubmitting(false); }
  };

  return (
    <Screen keyboardAware backgroundColor={tokens.colors.authCanvas} contentStyle={styles.content}>
      <View style={styles.brandBlock}>
        <View style={styles.brandRow}>
          <View style={styles.logo}><Text style={styles.logoText}>F</Text></View>
          <Text style={styles.brand}>fitly</Text>
        </View>
        <Text style={styles.eyebrow}>{isSignUp ? 'BẮT ĐẦU HÀNH TRÌNH' : 'TẬP LUYỆN · PHỤC HỒI · TIẾN BỘ'}</Text>
        <Text style={styles.title}>{isSignUp ? 'Tạo tài khoản' : 'Chào mừng trở lại'}</Text>
        <Text style={styles.lead}>{isSignUp ? 'Kế hoạch tập luyện và dinh dưỡng dành cho bạn.' : 'Kế hoạch khỏe mạnh dành cho bạn.'}</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.formTitle}>{isSignUp ? 'Thông tin của bạn' : 'Đăng nhập tài khoản'}</Text>
        <Text style={styles.formSubtitle}>{isSignUp ? 'Chỉ mất khoảng một phút để bắt đầu.' : 'Tiếp tục hành trình hôm nay.'}</Text>
        {isSignUp && <View style={styles.field}><Text style={styles.fieldLabel}>HỌ VÀ TÊN</Text><TextInput accessibilityLabel="Họ và tên" autoComplete="name" returnKeyType="next" placeholder="Nguyễn Văn A" placeholderTextColor={tokens.colors.muted} style={styles.input} value={fullName} onChangeText={setFullName} /></View>}
        <View style={styles.field}><Text style={styles.fieldLabel}>EMAIL</Text><TextInput accessibilityLabel="Địa chỉ email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" returnKeyType="next" placeholder="ban@example.com" placeholderTextColor={tokens.colors.muted} style={styles.input} value={email} onChangeText={setEmail} /></View>
        <View style={styles.field}><Text style={styles.fieldLabel}>MẬT KHẨU</Text><View style={styles.passwordField}><TextInput autoComplete={isSignUp ? 'new-password' : 'current-password'} returnKeyType={isSignUp ? 'next' : 'done'} placeholder="Nhập mật khẩu" placeholderTextColor={tokens.colors.muted} secureTextEntry={!showPassword} style={[styles.input, styles.passwordInput]} value={password} onChangeText={setPassword} /><Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} onPress={() => setShowPassword((value) => !value)} hitSlop={8} style={styles.passwordToggle}><Text style={styles.passwordToggleText}>{showPassword ? 'Ẩn' : 'Hiện'}</Text></Pressable></View></View>
        {isSignUp && <View style={styles.field}><Text style={styles.fieldLabel}>XÁC NHẬN MẬT KHẨU</Text><View style={styles.passwordField}><TextInput accessibilityLabel="Xác nhận mật khẩu" autoComplete="new-password" returnKeyType="done" placeholder="Nhập lại mật khẩu" placeholderTextColor={tokens.colors.muted} secureTextEntry={!showConfirmation} style={[styles.input, styles.passwordInput]} value={confirmation} onChangeText={setConfirmation} /><Pressable accessibilityRole="button" accessibilityLabel={showConfirmation ? 'Ẩn mật khẩu xác nhận' : 'Hiện mật khẩu xác nhận'} onPress={() => setShowConfirmation((value) => !value)} hitSlop={8} style={styles.passwordToggle}><Text style={styles.passwordToggleText}>{showConfirmation ? 'Ẩn' : 'Hiện'}</Text></Pressable></View></View>}
        {isSignUp && <Text style={styles.requirements}>Ít nhất 8 ký tự, gồm chữ hoa, chữ thường và số.</Text>}
        <Pressable disabled={isSubmitting} onPress={() => void submit()} style={({ pressed }) => [styles.button, (pressed || isSubmitting) && styles.buttonPressed]}>
          <Text style={styles.buttonText}>{isSubmitting ? 'Đang xử lý…' : isSignUp ? 'Tạo tài khoản' : 'Đăng nhập'}</Text>
        </Pressable>
        {!isSignUp ? <Link href="/forgot-password" style={styles.resetLink}>Quên mật khẩu?</Link> : <Text style={styles.terms}>Khi đăng ký, bạn đồng ý với <Link href={{ pathname: '/legal', params: { section: 'terms' } }} style={styles.switchLink}>Điều khoản dịch vụ</Link> và <Link href={{ pathname: '/legal', params: { section: 'privacy' } }} style={styles.switchLink}>Chính sách quyền riêng tư</Link> của Fitly.</Text>}
        <View style={styles.switchRow}>
          <Text style={styles.note}>{isSignUp ? 'Đã có tài khoản?' : 'Chưa có tài khoản?'}</Text>
          <Pressable onPress={() => setIsSignUp(!isSignUp)}><Text style={styles.switchLink}>{isSignUp ? 'Đăng nhập' : 'Đăng ký miễn phí'}</Text></Pressable>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: tokens.spacing.lg, paddingBottom: tokens.spacing.xxl, gap: tokens.spacing.xxl },
  brandBlock: { gap: 8, paddingTop: tokens.spacing.sm },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  logo: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.colors.lime },
  logoText: { color: tokens.colors.canvas, fontSize: 22, fontWeight: '900', letterSpacing: -1 },
  eyebrow: { color: tokens.colors.lime, fontSize: tokens.type.overline, fontWeight: '800', letterSpacing: 1.8 },
  brand: { color: tokens.colors.ink, fontSize: 28, fontWeight: '900', letterSpacing: -1 },
  title: { color: tokens.colors.ink, fontSize: 34, lineHeight: 40, fontWeight: '900', letterSpacing: -1 },
  lead: { maxWidth: 310, color: tokens.colors.muted, fontSize: 15, lineHeight: 21 },
  form: { gap: 14, padding: 20, borderRadius: 24, backgroundColor: tokens.colors.surfaceRaised, borderWidth: 1, borderColor: '#39433B' },
  formTitle: { color: tokens.colors.ink, fontSize: 21, fontWeight: '800' },
  formSubtitle: { color: tokens.colors.muted, fontSize: 13, marginTop: -8, marginBottom: 2 },
  field: { gap: 7 },
  fieldLabel: { color: '#C5CDC7', fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  passwordField: { position: 'relative', justifyContent: 'center' },
  input: { minHeight: 52, borderRadius: 14, paddingHorizontal: tokens.spacing.lg, backgroundColor: '#111711', color: tokens.colors.ink, fontSize: 15, borderWidth: 1, borderColor: '#3A463C' },
  passwordInput: { paddingRight: 62 },
  passwordToggle: { position: 'absolute', right: 16, paddingVertical: 8 },
  passwordToggleText: { color: tokens.colors.lime, fontSize: 12, fontWeight: '900' },
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
