import { useAuth } from '@/providers/auth-provider';
import { loadAccountProfile } from '@/lib/account-read-model';
import { useResource } from '@/hooks/use-resource';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';

import { AppIcon } from '@/components/ui/app-icon';
import { Screen } from '@/components/ui/screen';
import { loadProfileSnapshot } from '@/lib/fitness-read-model';
import { apiRequest } from '@/lib/api-client';
import { runtimeConfig } from '@/lib/runtime-config';
import { fetchWithTimeout } from '@/lib/network';
import { supabase } from '@/lib/supabase';
import { clearScheduledReminders, unregisterCurrentDeviceForPush } from '@/lib/mobile-notifications';
import { tokens } from '@/theme/tokens';

const getDisplayName = (metadata: Record<string, unknown> | undefined, email: string | undefined) => {
  const candidate = metadata?.full_name ?? metadata?.name ?? metadata?.display_name;
  if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  return email?.split('@')[0] || 'Thành viên Fitly';
};

const getInitials = (name: string) => name.split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]).join('').toUpperCase() || 'F';
const supportedAvatarTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

type MembershipTier = 'free' | 'plus' | 'pro';
type QuotaKey = 'planGenerations' | 'workoutAdjustments' | 'mealAdjustments' | 'chatMessages';
type QuotaCounters = Partial<Record<QuotaKey, number>>;
type AiQuotaResponse = {
  membershipTier?: string;
  trialExpired?: boolean;
  aiQuota?: { limits?: QuotaCounters; usage?: QuotaCounters; remaining?: QuotaCounters; trialEndsAt?: string | null };
};
type MembershipSnapshot = {
  tier: MembershipTier;
  expiresAt: string | null;
  trialEndsAt: string | null;
  trialExpired: boolean;
  limits: QuotaCounters;
  usage: QuotaCounters;
  remaining: QuotaCounters;
  refCode: string | null;
  referralCount: number;
};

const membershipLabels: Record<MembershipTier, string> = { free: 'Free', plus: 'Plus', pro: 'Pro' };
const normalizeMembershipTier = (value: unknown): MembershipTier => {
  const tier = String(value || '').trim().toLowerCase();
  if (tier === 'pro' || tier === 'premium') return 'pro';
  if (tier === 'plus') return 'plus';
  return 'free';
};
const formatMembershipDate = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export default function ProfileScreen() {
  const { session } = useAuth();
  const resource = useResource('profile', loadProfileSnapshot);
  const account = useResource('account', loadAccountProfile);
  const quotaResource = useResource('quota', () => apiRequest<AiQuotaResponse>('/api/ai/quota'));
  const { state, errorMessage: error } = resource;
  const profile = resource.data;
  const user = session?.user;
  const displayName = account.data?.full_name || getDisplayName(user?.user_metadata, user?.email);
  const email = user?.email ?? null;
  const storedAvatar = account.data?.avatar_url;
  const avatarUrl = storedAvatar ? `${storedAvatar}${storedAvatar.includes('?') ? '&' : '?'}updated=${encodeURIComponent(account.data?.updated_at ?? '')}` : null;
  const setAvatarUrl = (value: string | null) => account.setData((current) => current ? { ...current, avatar_url: value, updated_at: new Date().toISOString() } : current);
  const quota = quotaResource.data;
  const membership: MembershipSnapshot = {
    tier: normalizeMembershipTier(quota?.membershipTier ?? account.data?.membership_tier),
    expiresAt: account.data?.membership_expires_at ?? null,
    trialEndsAt: quota?.aiQuota?.trialEndsAt ?? null,
    trialExpired: Boolean(quota?.trialExpired),
    limits: quota?.aiQuota?.limits ?? {}, usage: quota?.aiQuota?.usage ?? {}, remaining: quota?.aiQuota?.remaining ?? {},
    refCode: account.data?.ref_code ?? null, referralCount: Math.max(0, Number(account.data?.referral_count) || 0),
  };
  const [refreshing, setRefreshing] = useState(false);
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false);
  const load = () => Promise.all([resource.load(), account.load(), quotaResource.load()]);
  const refresh = () => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  };

  const signOut = async () => {
    await Promise.allSettled([unregisterCurrentDeviceForPush(), clearScheduledReminders()]);
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
    if (signOutError) Alert.alert('Không thể đăng xuất', signOutError.message);
  };

  const uploadAvatar = async (asset: ImagePicker.ImagePickerAsset) => {
    const mimeType = asset.mimeType?.toLowerCase() || 'image/jpeg';
    if (!supportedAvatarTypes.has(mimeType)) {
      Alert.alert('Định dạng chưa hỗ trợ', 'Hãy chọn ảnh JPG, PNG, WebP hoặc GIF.');
      return;
    }
    if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
      Alert.alert('Ảnh quá lớn', 'Hãy chọn ảnh có dung lượng nhỏ hơn 5 MB.');
      return;
    }
    if (!runtimeConfig.apiUrl) {
      Alert.alert('Không thể tải ảnh', 'Ứng dụng chưa được cấu hình kết nối máy chủ.');
      return;
    }

    setIsAvatarUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Phiên đăng nhập đã hết hạn.');
      const imageResponse = await fetch(asset.uri);
      const imageBlob = await imageResponse.blob();
      if (imageBlob.size > 5 * 1024 * 1024) throw new Error('Hãy chọn ảnh có dung lượng nhỏ hơn 5 MB.');
      const response = await fetchWithTimeout(`${runtimeConfig.apiUrl}/api/profile/avatar`, {
        method: 'PUT',
        headers: { Accept: 'application/json', Authorization: `Bearer ${session.access_token}`, 'Content-Type': mimeType },
        body: imageBlob,
      });
      const payload = await response.json().catch(() => ({})) as { avatarUrl?: string; error?: string };
      if (!response.ok || !payload.avatarUrl) throw new Error(payload.error || 'Không thể cập nhật ảnh đại diện.');
      setAvatarUrl(payload.avatarUrl);
    } catch (cause) {
      Alert.alert('Không thể tải ảnh', cause instanceof Error ? cause.message : 'Vui lòng thử lại sau.');
    } finally {
      setIsAvatarUploading(false);
    }
  };

  const pickAvatar = async (source: 'camera' | 'library') => {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Chưa có quyền camera', 'Hãy cấp quyền trong cài đặt để chụp ảnh đại diện.');
        return;
      }
    }
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.75 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.75 });
    if (!result.canceled && result.assets[0]) await uploadAvatar(result.assets[0]);
  };

  const removeAvatar = async () => {
    setIsAvatarUploading(true);
    try {
      await apiRequest('/api/profile/avatar', { method: 'DELETE', timeoutMs: 15_000 });
      setAvatarUrl(null);
    } catch (cause) {
      Alert.alert('Không thể xóa ảnh', cause instanceof Error ? cause.message : 'Vui lòng thử lại sau.');
    } finally {
      setIsAvatarUploading(false);
    }
  };

  const openAvatarMenu = () => {
    if (!isAvatarUploading) setIsAvatarMenuOpen(true);
  };

  const openMembershipOptions = () => router.push('/(app)/premium');

  const shareReferral = async () => {
    if (!membership?.refCode) {
      Alert.alert('Chưa có mã giới thiệu', 'Hãy kéo xuống để làm mới hồ sơ rồi thử lại.');
      return;
    }
    const referralLink = `https://trend-fit.vercel.app/register?ref=${membership.refCode}`;
    await Share.share({
      title: 'Tham gia Fitly cùng mình',
      message: `Tập luyện và theo dõi dinh dưỡng cùng mình trên Fitly: ${referralLink}`,
    });
  };

  const initials = useMemo(() => getInitials(displayName), [displayName]);
  const goal = profile?.fitnessGoal || 'Chưa đặt mục tiêu';
  const membershipTier = membership?.tier ?? 'free';
  const membershipLabel = membershipLabels[membershipTier];
  const chatUsed = membership?.usage.chatMessages ?? 0;
  const chatLimit = membership?.limits.chatMessages ?? 0;
  const chatProgress = chatLimit > 0 ? Math.min(100, Math.round((chatUsed / chatLimit) * 100)) : 0;
  const membershipDate = formatMembershipDate(membershipTier === 'free' ? membership?.trialEndsAt ?? null : membership?.expiresAt ?? null);
  const referralCount = membership?.referralCount ?? 0;
  const referralTarget = membershipTier === 'pro' ? 20 : membershipTier === 'plus' || referralCount >= 5 ? 20 : 5;
  const referralRemaining = membershipTier === 'pro' ? 0 : Math.max(0, referralTarget - referralCount);
  const referralProgress = membershipTier === 'pro' ? 100 : Math.min(100, Math.round((referralCount / referralTarget) * 100));

  return (
    <Screen contentStyle={styles.content} refreshing={refreshing} onRefresh={refresh}>
      <View style={styles.header}><View><Text style={styles.headerKicker}>TÀI KHOẢN CỦA BẠN</Text><Text style={styles.headerTitle}>Hồ sơ</Text></View></View>

      <View style={styles.identityBlock}>
        <Pressable accessibilityRole="button" accessibilityLabel="Đổi ảnh đại diện" onPress={openAvatarMenu} style={styles.avatar}>{avatarUrl ? <Image source={{ uri: avatarUrl }} style={styles.avatarImage} /> : <Text style={styles.avatarText}>{initials}</Text>}{isAvatarUploading ? <View style={styles.avatarLoading}><ActivityIndicator color={tokens.colors.canvas} size="small" /></View> : <View style={styles.avatarEditBadge}><AppIcon name="camera" color={tokens.colors.canvas} size={12} /></View>}</Pressable>
        <View style={styles.identityCopy}><Text style={styles.name}>{displayName}</Text><Text numberOfLines={1} style={styles.email}>{email ?? 'Đang đồng bộ tài khoản...'}</Text><View style={styles.memberStatus}><View style={styles.statusDot} /><Text style={styles.statusText}>THÀNH VIÊN · GÓI {membershipLabel.toUpperCase()}</Text></View></View>
      </View>

      {state === 'error' ? <View style={styles.errorArea}><Text style={styles.error}>{error}</Text><Pressable onPress={() => void load()} style={styles.retryButton}><Text style={styles.retryText}>Thử lại</Text></Pressable></View> : null}

      <View style={styles.vitalsSection}>
        <Text style={styles.sectionEyebrow}>CHỈ SỐ CÁ NHÂN</Text>
        <View style={styles.vitalsRow}>
          <View style={styles.weightArea}><Text style={styles.weightValue}>{profile?.weight ?? '—'}</Text><Text style={styles.weightUnit}>kg</Text><Text style={styles.weightLabel}>Cân nặng hiện tại</Text></View>
          <View style={styles.vitalsDivider} />
          <View style={styles.vitalItem}><AppIcon name="workout" color={tokens.colors.lime} size={20} /><Text style={styles.vitalValue}>{profile?.weeklyWorkouts ?? '—'}</Text><Text style={styles.vitalLabel}>buổi / tuần</Text></View>
          <View style={styles.vitalItem}><AppIcon name="flame" color="#FFB36C" size={20} /><Text style={styles.vitalValue}>{profile?.targetCalories ?? '—'}</Text><Text style={styles.vitalLabel}>kcal mục tiêu</Text></View>
        </View>
      </View>

      <View style={styles.goalBanner}><View style={styles.goalIcon}><AppIcon name="target" color={tokens.colors.canvas} size={20} /></View><View style={styles.goalCopy}><Text style={styles.goalEyebrow}>MỤC TIÊU HIỆN TẠI</Text><Text style={styles.goalText}>{goal}</Text></View></View>

      <View style={styles.membershipSection}>
        <View style={styles.sectionTitleRow}><Text style={styles.sectionEyebrow}>GÓI TÀI KHOẢN</Text><Text style={styles.membershipSectionHint}>QUYỀN LỢI AI</Text></View>
        <View style={styles.membershipCard}>
          <View style={styles.membershipGlow} />
          <View style={styles.membershipTop}>
            <View style={styles.membershipMark}><AppIcon name="zap" color={tokens.colors.canvas} size={21} /></View>
            <View style={styles.membershipTitleCopy}><Text style={styles.membershipKicker}>GÓI HIỆN TẠI</Text><Text style={styles.membershipName}>{membershipLabel}</Text></View>
            <View style={styles.currentBadge}><Text style={styles.currentBadgeText}>ĐANG DÙNG</Text></View>
          </View>
          <Text style={styles.membershipDescription}>{membershipTier === 'pro' ? 'AI Coach theo sát với hạn mức cao nhất.' : membershipTier === 'plus' ? 'Đủ lượt AI để duy trì kế hoạch mỗi ngày.' : 'Trải nghiệm các tính năng cốt lõi của Fitly.'}</Text>
          <Text style={[styles.membershipExpiry, membership?.trialExpired && styles.membershipExpired]}>{membership?.trialExpired ? 'Gói dùng thử đã kết thúc' : membershipDate ? `${membershipTier === 'free' ? 'Dùng thử đến' : 'Hiệu lực đến'} ${membershipDate}` : 'Hạn dùng được đồng bộ từ tài khoản'}</Text>

          <View style={styles.aiUsageHead}><Text style={styles.aiUsageLabel}>Lượt AI Coach đã dùng</Text><Text style={styles.aiUsageValue}>{chatUsed} / {chatLimit || '—'}</Text></View>
          <View style={styles.aiUsageTrack}><View style={[styles.aiUsageFill, { width: `${chatProgress}%` }]} /></View>

          <View style={styles.quotaRow}>
            <View style={styles.quotaItem}><AppIcon name="workout" color={tokens.colors.lime} size={18} /><Text style={styles.quotaValue}>{membership?.remaining.workoutAdjustments ?? '—'}</Text><Text style={styles.quotaLabel}>Đổi bài còn lại</Text></View>
            <View style={styles.quotaItem}><AppIcon name="meals" color="#F6C445" size={18} /><Text style={styles.quotaValue}>{membership?.remaining.mealAdjustments ?? '—'}</Text><Text style={styles.quotaLabel}>Đổi món còn lại</Text></View>
          </View>

          <Pressable onPress={openMembershipOptions} style={({ pressed }) => [styles.membershipAction, pressed && styles.pressed]}><Text style={styles.membershipActionText}>{membershipTier === 'pro' ? 'Xem quyền lợi Pro' : membershipTier === 'plus' ? 'Nâng cấp lên Pro' : 'Xem gói Plus và Pro'}</Text><AppIcon name="arrow-right" color={tokens.colors.canvas} size={17} /></Pressable>
        </View>
      </View>

      <View style={styles.referralCard}>
        <View style={styles.referralTop}><View style={styles.referralIcon}><AppIcon name="send" color="#53B7FF" size={20} /></View><View style={styles.referralCopy}><Text style={styles.referralKicker}>CỘNG ĐỒNG FITLY</Text><Text style={styles.referralTitle}>Mời bạn, nhận gói miễn phí</Text></View></View>
        <Text style={styles.referralDescription}>{membershipTier === 'pro' ? 'Bạn đang ở gói cao nhất. Vẫn có thể chia sẻ Fitly để cùng bạn bè duy trì thói quen tốt.' : 'Bạn bè đăng ký bằng mã của bạn sẽ giúp mở khóa gói thành viên cao hơn.'}</Text>
        <View style={styles.referralStats}><View><Text style={styles.referralStatValue}>{referralCount}</Text><Text style={styles.referralStatLabel}>ĐÃ MỜI</Text></View><View style={styles.referralStatRight}><Text style={styles.referralStatValue}>{referralRemaining}</Text><Text style={styles.referralStatLabel}>{membershipTier === 'pro' ? 'ĐÃ ĐẠT PRO' : `CÒN ĐẾN ${referralTarget === 5 ? 'PLUS' : 'PRO'}`}</Text></View></View>
        <View style={styles.referralTrack}><View style={[styles.referralFill, { width: `${referralProgress}%` }]} /></View>
        <View style={styles.referralFooter}><View><Text style={styles.referralCodeLabel}>MÃ GIỚI THIỆU</Text><Text style={styles.referralCode}>{membership?.refCode ?? 'Đang đồng bộ...'}</Text></View><Pressable disabled={!membership?.refCode} onPress={() => void shareReferral()} style={({ pressed }) => [styles.shareButton, !membership?.refCode && styles.shareButtonDisabled, pressed && styles.pressed]}><AppIcon name="send" color={tokens.colors.canvas} size={16} /><Text style={styles.shareButtonText}>Chia sẻ</Text></Pressable></View>
      </View>

      <View style={styles.actionSection}>
        <Text style={styles.sectionEyebrow}>KHÔNG GIAN CỦA BẠN</Text>
        <View style={styles.actionGrid}>
          <Pressable onPress={() => router.push('/profile/edit')} style={({ pressed }) => [styles.actionRow, styles.actionBlue, pressed && styles.pressed]}><View style={styles.actionIcon}><AppIcon name="profile" color="#A4C7FF" size={20} /></View><View style={styles.actionCopy}><Text style={styles.actionTitle}>Cập nhật hồ sơ</Text><Text style={styles.actionDescription}>Cơ thể và mục tiêu</Text></View><AppIcon name="arrow-right" color="#A4C7FF" size={17} /></Pressable>
          <Pressable onPress={() => router.push('/progress')} style={({ pressed }) => [styles.actionRow, styles.actionGreen, pressed && styles.pressed]}><View style={styles.actionIcon}><AppIcon name="target" color={tokens.colors.lime} size={20} /></View><View style={styles.actionCopy}><Text style={styles.actionTitle}>Tiến độ cơ thể</Text><Text style={styles.actionDescription}>Theo dõi thay đổi</Text></View><AppIcon name="arrow-right" color={tokens.colors.lime} size={17} /></Pressable>
          <Pressable onPress={() => router.push('/reminders' as never)} style={({ pressed }) => [styles.actionRow, styles.actionOrange, pressed && styles.pressed]}><View style={styles.actionIcon}><AppIcon name="bell" color="#FFB36C" size={20} /></View><View style={styles.actionCopy}><Text style={styles.actionTitle}>Nhắc nhở Fitly</Text><Text style={styles.actionDescription}>Nước, ngủ và kế hoạch</Text></View><AppIcon name="arrow-right" color="#FFB36C" size={17} /></Pressable>
        </View>
      </View>

      <Pressable accessibilityRole="button" style={styles.actionRow} onPress={() => router.push('/(app)/account')}><Text style={styles.actionTitle}>Quyền riêng tư và tài khoản</Text></Pressable>
      <Pressable accessibilityRole="button" style={styles.actionRow} onPress={() => router.push('/(app)/support')}><Text style={styles.actionTitle}>Hỗ trợ và góp ý</Text></Pressable>
      <Pressable style={styles.signOutButton} onPress={() => void signOut()}><Text style={styles.signOutText}>Đăng xuất khỏi Fitly</Text></Pressable>

      <Modal transparent animationType="fade" visible={isAvatarMenuOpen} onRequestClose={() => setIsAvatarMenuOpen(false)}>
        <View style={styles.avatarMenuLayer}>
          <Pressable accessibilityRole="button" accessibilityLabel="Đóng chọn ảnh đại diện" style={styles.avatarMenuBackdrop} onPress={() => setIsAvatarMenuOpen(false)} />
          <View style={styles.avatarMenuSheet}>
            <View style={styles.avatarMenuHandle} />
            <Text style={styles.avatarMenuTitle}>Ảnh đại diện</Text>
            <Text style={styles.avatarMenuDescription}>Chọn nguồn ảnh cho hồ sơ Fitly.</Text>
            <Pressable style={styles.avatarMenuAction} onPress={() => { setIsAvatarMenuOpen(false); void pickAvatar('camera'); }}><View style={styles.avatarMenuIcon}><AppIcon name="camera" color={tokens.colors.lime} size={20} /></View><Text style={styles.avatarMenuActionText}>Chụp ảnh</Text></Pressable>
            <Pressable style={styles.avatarMenuAction} onPress={() => { setIsAvatarMenuOpen(false); void pickAvatar('library'); }}><View style={styles.avatarMenuIcon}><AppIcon name="image" color="#A4C7FF" size={20} /></View><Text style={styles.avatarMenuActionText}>Chọn từ thiết bị</Text></Pressable>
            {avatarUrl ? <Pressable style={styles.avatarMenuAction} onPress={() => { setIsAvatarMenuOpen(false); void removeAvatar(); }}><View style={styles.avatarMenuIcon}><AppIcon name="refresh" color={tokens.colors.coral} size={20} /></View><Text style={styles.avatarMenuDeleteText}>Xóa ảnh hiện tại</Text></Pressable> : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: tokens.spacing.lg, paddingTop: tokens.spacing.md, paddingBottom: 112, gap: tokens.spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerKicker: { color: tokens.colors.lime, fontSize: 10, fontWeight: '900', letterSpacing: 1.15 },
  headerTitle: { marginTop: 3, color: tokens.colors.ink, fontSize: 30, fontWeight: '900' },
  identityBlock: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md, padding: tokens.spacing.md, borderRadius: 24, backgroundColor: '#121713' },
  avatar: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 36, borderWidth: 1, borderColor: '#B9FF3A', backgroundColor: '#1B2E1D' },
  avatarText: { color: tokens.colors.lime, fontSize: 24, fontWeight: '900' },
  avatarImage: { width: '100%', height: '100%' },
  avatarLoading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.52)' },
  avatarEditBadge: { position: 'absolute', right: 2, bottom: 2, width: 23, height: 23, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: tokens.colors.lime, borderWidth: 2, borderColor: tokens.colors.canvas },
  identityCopy: { flex: 1, gap: 3 },
  name: { color: tokens.colors.ink, fontSize: 21, fontWeight: '900' },
  email: { color: tokens.colors.muted, fontSize: 12 },
  memberStatus: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: tokens.colors.lime },
  statusText: { color: '#9DBFA2', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  errorArea: { alignItems: 'flex-start', gap: tokens.spacing.sm, paddingVertical: tokens.spacing.md, borderBottomWidth: 1, borderColor: '#63352D' },
  error: { color: tokens.colors.coral, lineHeight: 20 },
  retryButton: { paddingBottom: 4, borderBottomWidth: 1, borderColor: tokens.colors.coral },
  retryText: { color: tokens.colors.coral, fontWeight: '900' },
  vitalsSection: { gap: tokens.spacing.sm },
  sectionEyebrow: { color: '#93A39A', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  vitalsRow: { flexDirection: 'row', alignItems: 'stretch', gap: tokens.spacing.sm },
  weightArea: { flex: 1.25, gap: 1, padding: tokens.spacing.md, borderRadius: 20, backgroundColor: '#18251B' },
  weightValue: { color: tokens.colors.ink, fontSize: 36, lineHeight: 41, fontWeight: '900' },
  weightUnit: { color: tokens.colors.muted, fontSize: 14, fontWeight: '800' },
  weightLabel: { marginTop: 5, color: '#9DA59F', fontSize: 11, fontWeight: '700' },
  vitalsDivider: { display: 'none' },
  vitalItem: { flex: 1, alignItems: 'flex-start', justifyContent: 'space-between', padding: tokens.spacing.md, borderRadius: 20, backgroundColor: '#151A16' },
  vitalValue: { marginTop: tokens.spacing.sm, color: tokens.colors.ink, fontSize: 21, fontWeight: '900' },
  vitalLabel: { color: '#9DA59F', fontSize: 10, fontWeight: '700' },
  goalBanner: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm, padding: tokens.spacing.md, borderRadius: 20, backgroundColor: '#1A261B' },
  goalIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: tokens.colors.lime },
  goalCopy: { flex: 1, gap: 2 },
  goalEyebrow: { color: '#9EA89F', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  goalText: { color: tokens.colors.ink, fontSize: 16, fontWeight: '900' },
  membershipSection: { gap: tokens.spacing.sm },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  membershipSectionHint: { color: tokens.colors.lime, fontSize: 9, fontWeight: '900', letterSpacing: 0.9 },
  membershipCard: { position: 'relative', overflow: 'hidden', padding: tokens.spacing.md, borderRadius: 24, backgroundColor: '#17251A' },
  membershipGlow: { position: 'absolute', right: -54, top: -72, width: 180, height: 180, borderRadius: 90, backgroundColor: '#29462C' },
  membershipTop: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm },
  membershipMark: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: tokens.colors.lime },
  membershipTitleCopy: { flex: 1, gap: 1 },
  membershipKicker: { color: '#9EB0A2', fontSize: 8, fontWeight: '900', letterSpacing: 0.9 },
  membershipName: { color: tokens.colors.ink, fontSize: 24, fontWeight: '900' },
  currentBadge: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: tokens.radius.pill, backgroundColor: '#101711' },
  currentBadgeText: { color: tokens.colors.lime, fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  membershipDescription: { marginTop: tokens.spacing.md, color: '#DCE6DE', fontSize: 12, lineHeight: 18, fontWeight: '700' },
  membershipExpiry: { marginTop: 3, color: '#91A397', fontSize: 10, fontWeight: '700' },
  membershipExpired: { color: tokens.colors.coral },
  aiUsageHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: tokens.spacing.md },
  aiUsageLabel: { color: '#A8B4AB', fontSize: 10, fontWeight: '800' },
  aiUsageValue: { color: tokens.colors.ink, fontSize: 11, fontWeight: '900' },
  aiUsageTrack: { overflow: 'hidden', height: 6, marginTop: 7, borderRadius: 3, backgroundColor: '#0D120E' },
  aiUsageFill: { height: '100%', borderRadius: 3, backgroundColor: tokens.colors.lime },
  quotaRow: { flexDirection: 'row', gap: 8, marginTop: tokens.spacing.md },
  quotaItem: { flex: 1, gap: 3, padding: tokens.spacing.sm, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.22)' },
  quotaValue: { marginTop: 3, color: tokens.colors.ink, fontSize: 18, fontWeight: '900' },
  quotaLabel: { color: '#9AA69D', fontSize: 9, fontWeight: '700' },
  membershipAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, marginTop: tokens.spacing.md, paddingHorizontal: tokens.spacing.md, borderRadius: 15, backgroundColor: tokens.colors.lime },
  membershipActionText: { color: tokens.colors.canvas, fontSize: 12, fontWeight: '900' },
  referralCard: { gap: tokens.spacing.sm, padding: tokens.spacing.md, borderRadius: 24, backgroundColor: '#17242C' },
  referralTop: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm },
  referralIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: '#102C3B' },
  referralCopy: { flex: 1, gap: 2 },
  referralKicker: { color: '#72C7FF', fontSize: 8, fontWeight: '900', letterSpacing: 0.9 },
  referralTitle: { color: tokens.colors.ink, fontSize: 16, fontWeight: '900' },
  referralDescription: { color: '#AAB5BA', fontSize: 11, lineHeight: 17 },
  referralStats: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 2 },
  referralStatRight: { alignItems: 'flex-end' },
  referralStatValue: { color: tokens.colors.ink, fontSize: 23, fontWeight: '900' },
  referralStatLabel: { color: '#82959F', fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  referralTrack: { overflow: 'hidden', height: 6, borderRadius: 3, backgroundColor: '#0C151A' },
  referralFill: { height: '100%', borderRadius: 3, backgroundColor: '#53B7FF' },
  referralFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.spacing.sm, marginTop: 2, padding: tokens.spacing.sm, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.2)' },
  referralCodeLabel: { color: '#82959F', fontSize: 7, fontWeight: '900', letterSpacing: 0.8 },
  referralCode: { marginTop: 2, color: tokens.colors.ink, fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  shareButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: 13, backgroundColor: '#53B7FF' },
  shareButtonDisabled: { opacity: 0.4 },
  shareButtonText: { color: tokens.colors.canvas, fontSize: 10, fontWeight: '900' },
  actionSection: { gap: tokens.spacing.sm },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionRow: { width: '48%', minHeight: 132, justifyContent: 'space-between', gap: tokens.spacing.sm, padding: tokens.spacing.md, borderRadius: 20 },
  actionBlue: { backgroundColor: '#18232B' },
  actionGreen: { backgroundColor: '#18251B' },
  actionOrange: { backgroundColor: '#281F18' },
  actionIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.18)' },
  actionCopy: { flex: 1, justifyContent: 'flex-end', gap: 2 },
  actionTitle: { color: tokens.colors.ink, fontSize: 14, fontWeight: '900' },
  actionDescription: { color: tokens.colors.muted, fontSize: 11, lineHeight: 16 },
  signOutButton: { alignSelf: 'center', marginTop: tokens.spacing.sm, paddingVertical: tokens.spacing.sm, paddingHorizontal: tokens.spacing.md },
  signOutText: { color: tokens.colors.coral, fontSize: 13, fontWeight: '900' },
  avatarMenuLayer: { flex: 1, justifyContent: 'flex-end' },
  avatarMenuBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.66)' },
  avatarMenuSheet: { paddingHorizontal: tokens.spacing.lg, paddingTop: 10, paddingBottom: 34, gap: 4, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderBottomWidth: 0, borderColor: '#39443C', backgroundColor: '#121713' },
  avatarMenuHandle: { alignSelf: 'center', width: 42, height: 4, marginBottom: 10, borderRadius: 2, backgroundColor: '#5A655D' },
  avatarMenuTitle: { color: tokens.colors.ink, fontSize: 20, fontWeight: '900' },
  avatarMenuDescription: { marginBottom: 8, color: tokens.colors.muted, fontSize: 13 },
  avatarMenuAction: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm, minHeight: 58, borderTopWidth: 1, borderColor: '#2B332E' },
  avatarMenuIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#1A211C' },
  avatarMenuActionText: { color: tokens.colors.ink, fontSize: 15, fontWeight: '800' },
  avatarMenuDeleteText: { color: tokens.colors.coral, fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.72 },
});
