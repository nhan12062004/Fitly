import { Alert, Platform } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';

const pending = new Map<string, Promise<boolean>>();
const consentMessage = 'Fitly sẽ gửi yêu cầu cùng thông tin cần thiết về mục tiêu, sức khỏe, kế hoạch và nhật ký của bạn tới Groq để tạo phản hồi, bao gồm cập nhật kế hoạch tự động nếu gói của bạn có quyền lợi này. Bạn có thể từ chối và tiếp tục dùng các chức năng khác, hoặc thu hồi đồng ý trong Hồ sơ trên mọi thiết bị. AI có thể sai và không thay thế tư vấn y tế.';

export async function revokeAiConsent(userId: string) {
  const { error } = await supabase.rpc('set_ai_data_consent', { p_accept: false, p_version: 1 });
  if (error) throw new Error('Chưa thu hồi được đồng ý AI. Hãy kiểm tra kết nối rồi thử lại.');
}

export async function ensureAiConsent(userId: string): Promise<boolean> {
  if (pending.has(userId)) return pending.get(userId)!;
  const task = (async () => {
    const { data, error } = await supabase.from('ai_data_consents').select('version').eq('user_id', userId).maybeSingle();
    if (error) throw new Error('Chưa kiểm tra được lựa chọn quyền riêng tư. Vui lòng thử lại.');
    if (data?.version === 1) return true;
    const accepted = Platform.OS === 'web'
      ? typeof window !== 'undefined' && window.confirm(`Cho phép AI xử lý dữ liệu?\n\n${consentMessage}\n\nXem chính sách quyền riêng tư trong Hồ sơ hoặc màn hình đăng nhập.`)
      : await new Promise<boolean>((resolve) => {
        Alert.alert('Cho phép AI xử lý dữ liệu?', consentMessage, [
          { text: 'Chưa đồng ý', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Xem chính sách', onPress: () => { router.push({ pathname: '/legal', params: { section: 'privacy' } }); resolve(false); } },
          { text: 'Đồng ý', onPress: () => resolve(true) },
        ], { cancelable: false });
      });
    if (!accepted) return false;
    if ((await supabase.auth.getSession()).data.session?.user.id !== userId) throw new Error('Tài khoản đã thay đổi. Vui lòng thử lại.');
    const saved = await supabase.rpc('set_ai_data_consent', { p_accept: true, p_version: 1 });
    if (saved.error) throw new Error('Chưa lưu được lựa chọn quyền riêng tư. Vui lòng thử lại.');
    return true;
  })();
  pending.set(userId, task);
  try { return await task; } finally { pending.delete(userId); }
}
