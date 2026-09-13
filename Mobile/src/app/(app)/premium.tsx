import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, Text } from 'react-native';
import { Link, router } from 'expo-router';
import { Screen } from '@/components/ui/screen';
import { useResource } from '@/hooks/use-resource';
import { loadStorePackages, purchasePackage, purchasesConfigured, restorePurchases, type PurchasesPackage } from '@/lib/purchases';
import { settingsStyles as styles } from '@/theme/settings-styles';
import { tokens } from '@/theme/tokens';

const periodLabel = (value: string | null) => ({ P1W: 'tuần', P1M: 'tháng', P3M: '3 tháng', P6M: '6 tháng', P1Y: 'năm' }[value || ''] || value || 'kỳ');

export default function PremiumScreen() {
  const packages = useResource('store-packages', loadStorePackages);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const act = async (item?: PurchasesPackage) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = item ? await purchasePackage(item) : await restorePurchases();
      Alert.alert(result.data?.tier && result.data.tier !== 'free' ? 'Gói đăng ký đã được cập nhật' : 'Chưa có gói đang hoạt động',
        result.data?.tier && result.data.tier !== 'free' ? 'Quyền lợi của bạn đã được xác minh và đồng bộ.' : 'Nếu bạn vừa mua gói, hãy chờ một chút rồi chọn Khôi phục giao dịch. Không cần mua lại.');
    } catch (error) {
      if (!(error && typeof error === 'object' && 'userCancelled' in error && error.userCancelled)) {
        Alert.alert('Chưa hoàn tất', error instanceof Error ? error.message : 'Vui lòng thử khôi phục giao dịch.');
      }
    } finally { busyRef.current = false; setBusy(false); }
  };
  return <Screen>
    <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.linkButton}><Text style={styles.link}>← Quay lại</Text></Pressable>
    <Text style={styles.title}>Fitly Premium</Text>
    <Text style={styles.body}>Thêm lượt AI Coach và điều chỉnh kế hoạch với các gói Plus, Pro. Chọn gói để xem giá và chu kỳ thanh toán từ cửa hàng.</Text>
    {packages.isPending && <ActivityIndicator color={tokens.colors.lime} />}
    {packages.error && <Text accessibilityRole="alert" style={styles.error}>{packages.errorMessage}</Text>}
    {!packages.isPending && !packages.data?.length && <Text style={styles.body}>Hiện chưa có gói đăng ký khả dụng. Bạn vẫn có thể sử dụng các quyền lợi hiện có của tài khoản.</Text>}
    {packages.data?.map((item) => <Pressable key={item.identifier} accessibilityRole="button" disabled={busy} style={[styles.card, busy && styles.disabled]} onPress={() => void act(item)}>
      <Text style={styles.subtitle}>{item.product.title}</Text>
      <Text style={styles.body}>{item.product.description}</Text>
      <Text style={styles.price}>{item.product.priceString} / {periodLabel(item.product.subscriptionPeriod)}</Text>
      <Text style={styles.link}>Đăng ký</Text>
    </Pressable>)}
    {busy && <ActivityIndicator color={tokens.colors.lime} />}
    <Text style={styles.body}>Đăng ký tự động gia hạn theo giá và chu kỳ hiển thị trên cửa hàng, trừ khi bạn hủy trước kỳ gia hạn. Bạn có thể quản lý hoặc hủy trong cài đặt đăng ký của App Store hoặc Google Play. Xóa tài khoản Fitly không tự hủy đăng ký.</Text>
    <Pressable disabled={busy || !purchasesConfigured} accessibilityRole="button" style={[styles.button, (busy || !purchasesConfigured) && styles.disabled]} onPress={() => void act()}><Text style={styles.buttonText}>Khôi phục giao dịch</Text></Pressable>
    <Pressable accessibilityRole="link" style={styles.linkButton} onPress={() => void Linking.openURL(Platform.OS === 'ios' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions').catch(() => Alert.alert('Không mở được cửa hàng', 'Hãy mở cài đặt đăng ký trên cửa hàng của thiết bị.'))}><Text style={styles.link}>Quản lý đăng ký</Text></Pressable>
    <Link href={{ pathname: '/legal', params: { section: 'terms' } }} style={styles.link}>Điều khoản sử dụng</Link>
    <Link href={{ pathname: '/legal', params: { section: 'privacy' } }} style={styles.link}>Chính sách quyền riêng tư</Link>
    <Link href="/(app)/support" style={styles.link}>Cần hỗ trợ giao dịch?</Link>
  </Screen>;
}
