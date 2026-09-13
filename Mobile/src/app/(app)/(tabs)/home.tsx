import { useResource } from '@/hooks/use-resource';
import { useState } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { loadAccountProfile } from '@/lib/account-read-model';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { AppIcon } from '@/components/ui/app-icon';
import { Screen } from '@/components/ui/screen';
import { loadHomeSnapshot } from '@/lib/fitness-read-model';
import { loadUnreadNotificationCount } from '@/lib/wellness-read-model';
import { tokens } from '@/theme/tokens';


const dayNames = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const firstName = (value: string | null) => value?.trim().split(/\s+/).at(-1) || 'bạn';

export default function HomeScreen() {
  const { session } = useAuth();
  const home = useResource('home', loadHomeSnapshot);
  const account = useResource('account', loadAccountProfile);
  const notifications = useResource('notification-count', loadUnreadNotificationCount);
  const snapshot = home.data;
  const name = account.data?.full_name ?? session?.user.user_metadata?.full_name ?? null;
  const unreadNotifications = notifications.data ?? 0;
  const state = home.state;
  const [refreshing, setRefreshing] = useState(false);
  const today = new Date();

  const planned = snapshot?.plannedExercises ?? 0;
  const completed = snapshot?.completedExercises ?? 0;
  const calories = Math.round(snapshot?.caloriesConsumed ?? 0);
  const targetCalories = Math.round(snapshot?.targetCalories ?? 0);
  const remainingCalories = targetCalories ? Math.max(targetCalories - calories, 0) : 0;
  const dateText = `${dayNames[today.getDay()]}, ${today.getDate()} tháng ${today.getMonth() + 1}`;
  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    void Promise.all([home.load(), account.load(), notifications.load()]).finally(() => setRefreshing(false));
  };

  return (
    <Screen contentStyle={styles.content} refreshing={refreshing} onRefresh={refresh}>
      <View style={styles.header}>
        <View><Text style={styles.date}>{dateText}</Text><Text style={styles.greeting}>Chào {firstName(name)}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Mở thông báo" onPress={() => router.push('/notifications')} hitSlop={8} style={({ pressed }) => [styles.notificationButton, pressed && styles.pressed]}>
          <AppIcon name="bell" color={tokens.colors.ink} size={20} />
          {unreadNotifications > 0 ? <View style={styles.notificationBadge}><Text style={styles.notificationBadgeText}>{unreadNotifications > 9 ? '9+' : unreadNotifications}</Text></View> : null}
        </Pressable>
      </View>

      <View style={styles.dailyStage}>
        <View style={styles.dailyCopy}><Text style={styles.stageKicker}>BẢN ĐỒ NGÀY</Text><Text style={styles.stageTitle}>Đi theo nhịp{`\n`}của chính bạn.</Text><Text style={styles.stageText}>{planned ? completed === planned ? 'Bạn đã hoàn tất phần tập luyện hôm nay.' : 'Chọn một việc nhỏ và bắt đầu ngay.' : 'Hôm nay vẫn hoàn toàn thuộc về bạn.'}</Text></View>
        <View style={styles.progressOrb}><Text style={styles.orbValue}>{planned ? `${completed}/${planned}` : '—'}</Text><Text style={styles.orbLabel}>BÀI TẬP</Text></View>
      </View>

      <Pressable onPress={() => router.push('/workout')} style={({ pressed }) => [styles.nextMove, pressed && styles.pressed]}>
        <View style={styles.nextMoveIcon}><AppIcon name="workout" color={tokens.colors.canvas} size={23} /></View><View style={styles.nextMoveCopy}><Text style={styles.nextMoveKicker}>VIỆC TIẾP THEO</Text><Text style={styles.nextMoveTitle}>{planned ? completed === planned ? 'Ghi nhận một ngày tốt' : 'Tiếp tục buổi tập' : 'Tạo bài tập hôm nay'}</Text></View><AppIcon name="arrow-right" color={tokens.colors.canvas} size={20} />
      </Pressable>

      <View style={styles.sectionHeading}><Text style={styles.sectionKicker}>LỐI TẮT</Text><Text style={styles.sectionTitle}>Khám phá ngày</Text></View>
      <View style={styles.tileGrid}>
        <Pressable onPress={() => router.push('/workout')} style={({ pressed }) => [styles.routeTile, styles.workoutTile, pressed && styles.pressed]}><AppIcon name="workout" color={tokens.colors.lime} size={25} /><Text style={styles.routeTitle}>Tập luyện</Text><Text style={styles.routeText}>{planned ? `${planned - completed} bài còn lại` : 'Tạo lịch mới'}</Text></Pressable>
        <Pressable onPress={() => router.push('/meals')} style={({ pressed }) => [styles.routeTile, styles.mealsTile, pressed && styles.pressed]}><AppIcon name="meals" color="#A4C7FF" size={25} /><Text style={styles.routeTitle}>Bữa ăn</Text><Text style={styles.routeText}>{targetCalories ? `${remainingCalories} kcal còn lại` : 'Mở nhật ký'}</Text></Pressable>
        <Pressable onPress={() => router.push('/coach')} style={({ pressed }) => [styles.routeTile, styles.coachTile, pressed && styles.pressed]}><AppIcon name="coach" color="#D7A4FF" size={25} /><Text style={styles.routeTitle}>AI Coach</Text><Text style={styles.routeText}>Hỏi một điều</Text></Pressable>
      </View>

      <Pressable onPress={() => router.push('/meals')} style={({ pressed }) => [styles.nutritionNote, pressed && styles.pressed]}><View style={styles.noteGlow} /><View style={styles.noteContent}><Text style={styles.noteKicker}>NĂNG LƯỢNG HÔM NAY</Text><Text style={styles.noteValue}>{targetCalories ? `${calories} / ${targetCalories} kcal` : 'Bắt đầu ghi bữa ăn'}</Text><Text style={styles.noteText}>{targetCalories ? `Còn ${remainingCalories} kcal để bạn linh hoạt lựa chọn.` : 'Đặt mục tiêu calorie trong Hồ sơ.'}</Text></View><AppIcon name="arrow-right" color={tokens.colors.lime} size={19} /></Pressable>

      {state === 'error' ? <Pressable onPress={refresh} style={styles.errorPill}><Text style={styles.errorText}>Không tải được dữ liệu · Chạm để thử lại</Text></Pressable> : null}
      <Pressable onPress={() => router.push('/tracking')} style={({ pressed }) => [styles.wellnessLink, pressed && styles.pressed]}><View style={styles.wellnessLinkMark}><Text style={styles.wellnessLinkMarkText}>H₂O</Text></View><View style={styles.wellnessLinkCopy}><Text style={styles.wellnessLinkKicker}>NHỊP SỐNG</Text><Text style={styles.wellnessLinkTitle}>Theo dõi nước và giấc ngủ</Text></View><AppIcon name="arrow-right" color="#72C7FF" size={18} /></Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: tokens.spacing.lg, paddingTop: tokens.spacing.md, paddingBottom: 112, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  notificationButton: { position: 'relative', alignItems: 'center', justifyContent: 'center', width: 42, height: 42, borderRadius: 21, backgroundColor: '#151A16' },
  notificationBadge: { position: 'absolute', top: 3, right: 3, alignItems: 'center', justifyContent: 'center', minWidth: 16, height: 16, paddingHorizontal: 3, borderRadius: 8, backgroundColor: tokens.colors.lime },
  notificationBadgeText: { color: tokens.colors.canvas, fontSize: 8, fontWeight: '900' },
  date: { color: '#9AA49D', fontSize: 12, fontWeight: '700' },
  greeting: { marginTop: 2, color: tokens.colors.ink, fontSize: 29, fontWeight: '900', letterSpacing: -0.6 },
  dailyStage: { flexDirection: 'row', alignItems: 'flex-end', gap: tokens.spacing.md, paddingTop: tokens.spacing.sm },
  dailyCopy: { flex: 1, gap: 7 },
  stageKicker: { color: tokens.colors.lime, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  stageTitle: { color: tokens.colors.ink, fontSize: 30, lineHeight: 35, fontWeight: '900', letterSpacing: -0.8 },
  stageText: { color: tokens.colors.muted, fontSize: 12, lineHeight: 18 },
  progressOrb: { width: 94, height: 94, alignItems: 'center', justifyContent: 'center', borderRadius: 47, backgroundColor: tokens.colors.lime },
  orbValue: { color: tokens.colors.canvas, fontSize: 24, fontWeight: '900', letterSpacing: -1 },
  orbLabel: { color: '#3E5907', fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  nextMove: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm, minHeight: 72, paddingHorizontal: tokens.spacing.md, borderRadius: 20, backgroundColor: tokens.colors.white },
  nextMoveIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: tokens.colors.lime },
  nextMoveCopy: { flex: 1, gap: 2 },
  nextMoveKicker: { color: '#697069', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  nextMoveTitle: { color: tokens.colors.canvas, fontSize: 16, fontWeight: '900' },
  sectionHeading: { marginTop: 2 },
  sectionKicker: { color: '#92A099', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  sectionTitle: { marginTop: 2, color: tokens.colors.ink, fontSize: 24, fontWeight: '900' },
  tileGrid: { flexDirection: 'row', gap: 8 },
  routeTile: { flex: 1, minHeight: 112, justifyContent: 'space-between', padding: tokens.spacing.md, borderRadius: 20 },
  workoutTile: { backgroundColor: '#18261B' },
  mealsTile: { backgroundColor: '#19242D' },
  coachTile: { backgroundColor: '#271E2F' },
  routeTitle: { marginTop: tokens.spacing.md, color: tokens.colors.ink, fontSize: 13, fontWeight: '900' },
  routeText: { color: '#ABB5AD', fontSize: 10, lineHeight: 14 },
  nutritionNote: { position: 'relative', flexDirection: 'row', alignItems: 'center', overflow: 'hidden', padding: tokens.spacing.lg, borderRadius: 26, backgroundColor: '#121713' },
  noteGlow: { position: 'absolute', right: -27, top: -36, width: 126, height: 126, borderRadius: 63, backgroundColor: '#203920' },
  noteContent: { flex: 1, gap: 3 },
  noteKicker: { color: tokens.colors.lime, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  noteValue: { color: tokens.colors.ink, fontSize: 19, fontWeight: '900' },
  noteText: { color: tokens.colors.muted, fontSize: 11, lineHeight: 16 },
  wellnessLink: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 68, paddingHorizontal: tokens.spacing.md, borderRadius: 20, backgroundColor: '#14232B' },
  wellnessLinkMark: { alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 13, backgroundColor: '#1B4F61' },
  wellnessLinkMarkText: { color: '#72C7FF', fontSize: 11, fontWeight: '900' },
  wellnessLinkCopy: { flex: 1, gap: 2 },
  wellnessLinkKicker: { color: '#75B9D4', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  wellnessLinkTitle: { color: tokens.colors.ink, fontSize: 14, fontWeight: '900' },
  errorPill: { alignSelf: 'center', paddingHorizontal: tokens.spacing.md, paddingVertical: 10, borderRadius: tokens.radius.pill, backgroundColor: '#34201D' },
  errorText: { color: tokens.colors.coral, fontSize: 11, fontWeight: '800' },
  pressed: { opacity: 0.72 },
});
