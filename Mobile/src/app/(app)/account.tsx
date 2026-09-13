import { useState } from 'react';
import { Alert, Pressable, Text, TextInput } from 'react-native';
import { Link, router } from 'expo-router';
import { Screen } from '@/components/ui/screen';
import { apiRequest } from '@/lib/api-client';
import { supabase } from '@/lib/supabase';
import { revokeAiConsent } from '@/lib/ai-consent';
import { clearScheduledReminders } from '@/lib/mobile-notifications';
import { queryClient } from '@/lib/query-cache';
import { useAuth } from '@/providers/auth-provider';
import { settingsStyles as styles } from '@/theme/settings-styles';
import { tokens } from '@/theme/tokens';

export default function AccountScreen() {
  const { session } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const deleteAccount = async () => {
    if (!session?.user.email || deleting || confirmation !== 'XÓA') return;
    setDeleting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: session.user.email, password });
      if (error) throw new Error('Mật khẩu xác nhận chưa đúng.');
      await apiRequest('/api/account', { method: 'DELETE', body: { confirmation: 'DELETE' }, timeoutMs: 30_000 });
      await Promise.allSettled([clearScheduledReminders(), revokeAiConsent(session.user.id)]);
      queryClient.clear();
      await supabase.auth.signOut({ scope: 'local' });
      router.replace('/sign-in');
      Alert.alert('Đã xóa tài khoản', 'Tài khoản Fitly và dữ liệu liên kết đã được xóa.');
    } catch (error) { Alert.alert('Chưa xóa được tài khoản', error instanceof Error ? error.message : 'Vui lòng thử lại.'); }
    finally { setDeleting(false); }
  };
  return <Screen keyboardAware>
    <Pressable onPress={() => router.back()} style={styles.linkButton}><Text style={styles.link}>← Quay lại</Text></Pressable>
    <Text style={styles.title}>Quyền riêng tư và tài khoản</Text>
    <Link href={{ pathname: '/legal', params: { section: 'privacy' } }} style={styles.link}>Chính sách quyền riêng tư</Link>
    <Link href={{ pathname: '/legal', params: { section: 'terms' } }} style={styles.link}>Điều khoản sử dụng</Link>
    <Pressable style={styles.linkButton} onPress={() => { if (session) void revokeAiConsent(session.user.id).then(() => Alert.alert('Đã thu hồi đồng ý AI', 'Đã tắt AI trên mọi thiết bị, gồm cập nhật kế hoạch tự động. Yêu cầu đang xử lý có thể vẫn hoàn tất.')).catch((error) => Alert.alert('Chưa thu hồi được đồng ý', error instanceof Error ? error.message : 'Vui lòng thử lại.')); }}><Text style={styles.link}>Thu hồi đồng ý sử dụng dữ liệu với AI</Text></Pressable>
    <Link href={{ pathname: '/(app)/support', params: { category: 'privacy' } }} style={styles.link}>Yêu cầu hỗ trợ về dữ liệu</Link>
    <Link href="/(app)/blocked-users" style={styles.link}>Thành viên đã chặn</Link>
    <Text style={styles.subtitle}>Xóa tài khoản và dữ liệu</Text>
    <Text style={styles.body}>Thao tác này xóa vĩnh viễn hồ sơ, lịch tập, thực đơn, nhật ký, hội thoại và ảnh đại diện. Không thể hoàn tác.</Text>
    <Text style={styles.body}>Đăng ký trên cửa hàng không tự hủy khi xóa tài khoản. Nếu muốn dừng gia hạn, hãy quản lý đăng ký trước.</Text>
    <Link href="/(app)/premium" style={styles.link}>Quản lý đăng ký Premium</Link>
    <TextInput accessibilityLabel="Mật khẩu xác nhận xóa tài khoản" secureTextEntry autoComplete="current-password" value={password} onChangeText={setPassword} placeholder="Mật khẩu hiện tại" placeholderTextColor={tokens.colors.muted} style={styles.input} />
    <TextInput accessibilityLabel="Nhập XÓA để xác nhận" autoCapitalize="characters" value={confirmation} onChangeText={setConfirmation} placeholder="Nhập XÓA để xác nhận" placeholderTextColor={tokens.colors.muted} style={styles.input} />
    <Pressable accessibilityRole="button" disabled={deleting || !password || confirmation !== 'XÓA'} onPress={() => Alert.alert('Xóa tài khoản Fitly?', 'Dữ liệu sẽ bị xóa vĩnh viễn.', [{ text: 'Giữ tài khoản', style: 'cancel' }, { text: 'Xóa vĩnh viễn', style: 'destructive', onPress: () => void deleteAccount() }])} style={[styles.button, { backgroundColor: tokens.colors.coral }, (deleting || !password || confirmation !== 'XÓA') && styles.disabled]}><Text style={styles.buttonText}>{deleting ? 'Đang xóa…' : 'Xóa tài khoản'}</Text></Pressable>
  </Screen>;
}
