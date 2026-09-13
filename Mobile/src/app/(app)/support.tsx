import { useState } from 'react';
import { Alert, Pressable, Text, TextInput } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui/screen';
import { apiRequest } from '@/lib/api-client';
import { settingsStyles as styles } from '@/theme/settings-styles';
import { tokens } from '@/theme/tokens';

export default function SupportScreen() {
  const params = useLocalSearchParams<{ category?: string; context?: string; target_type?: string; target_id?: string }>();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const send = async () => {
    if (sending || message.trim().length < 5) return;
    setSending(true);
    try {
      const result = await apiRequest<{ id: string }>('/api/feedback', { method: 'POST', body: {
        category: ['ai_report', 'privacy', 'challenge_report'].includes(params.category || '') ? params.category : 'support',
        message: message.trim(), ...(params.context ? { context: params.context.slice(0, 5000) } : {}),
        ...(['challenge', 'user'].includes(params.target_type || '') && params.target_id ? { target_type: params.target_type, target_id: params.target_id } : {}),
      } });
      Alert.alert('Đã nhận phản hồi', `Mã yêu cầu: ${result.id}. Fitly sẽ xem xét nội dung bạn gửi.`, [{ text: 'Đóng', onPress: () => router.back() }]);
    } catch (error) { Alert.alert('Chưa gửi được', error instanceof Error ? error.message : 'Vui lòng thử lại.'); }
    finally { setSending(false); }
  };
  return <Screen keyboardAware>
    <Pressable onPress={() => router.back()} style={styles.linkButton}><Text style={styles.link}>← Quay lại</Text></Pressable>
    <Text style={styles.title}>{params.target_type === 'user' ? 'Báo cáo thành viên' : params.category === 'ai_report' ? 'Báo cáo nội dung AI' : params.category === 'challenge_report' ? 'Báo cáo thử thách' : 'Hỗ trợ và góp ý'}</Text>
    <Text style={styles.body}>Mô tả vấn đề bạn gặp phải. Không gửi mật khẩu, mã xác thực hoặc thông tin thẻ thanh toán.</Text>
    {params.context && <Text numberOfLines={5} style={styles.body}>Nội dung đính kèm: {params.context}</Text>}
    <TextInput accessibilityLabel="Nội dung phản hồi" multiline maxLength={5000} value={message} onChangeText={setMessage} placeholder="Nội dung cần hỗ trợ hoặc lý do báo cáo…" placeholderTextColor={tokens.colors.muted} style={[styles.input, { minHeight: 160, textAlignVertical: 'top' }]} />
    <Pressable accessibilityRole="button" disabled={sending || message.trim().length < 5} onPress={() => void send()} style={[styles.button, (sending || message.trim().length < 5) && styles.disabled]}><Text style={styles.buttonText}>{sending ? 'Đang gửi…' : 'Gửi phản hồi'}</Text></Pressable>
  </Screen>;
}
