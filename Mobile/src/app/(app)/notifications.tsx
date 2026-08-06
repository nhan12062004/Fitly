import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { AppIcon } from '@/components/ui/app-icon';
import { Screen } from '@/components/ui/screen';
import { addWaterIntake, loadUserNotifications, markAllUserNotificationsRead, markUserNotificationRead, recordSleepHours, type NotificationTone, type UserNotification } from '@/lib/wellness-read-model';
import { tokens } from '@/theme/tokens';

type Filter = 'all' | 'unread' | NotificationTone;

const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Tất cả' }, { id: 'unread', label: 'Chưa đọc' }, { id: 'workout', label: 'Tập luyện' }, { id: 'nutrition', label: 'Dinh dưỡng' }, { id: 'coach', label: 'Coach' }, { id: 'progress', label: 'Tiến độ' },
];

const toneMeta: Record<NotificationTone, { label: string; color: string; background: string; icon: Parameters<typeof AppIcon>[0]['name'] }> = {
  workout: { label: 'Tập luyện', color: tokens.colors.lime, background: '#1B3320', icon: 'workout' },
  nutrition: { label: 'Dinh dưỡng', color: '#72C7FF', background: '#142C39', icon: 'meals' },
  coach: { label: 'AI Coach', color: '#D5A6FF', background: '#292035', icon: 'coach' },
  progress: { label: 'Tiến độ', color: '#FFB36C', background: '#332419', icon: 'flame' },
  system: { label: 'Hệ thống', color: '#B7C2BB', background: '#202621', icon: 'bell' },
};

const isWater = (item: UserNotification) => item.dedupeKey.startsWith('water:');
const isSleep = (item: UserNotification) => item.dedupeKey.startsWith('sleep:');

const formatTime = (value: string) => {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return 'Vừa xong';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} phút trước`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} giờ trước`;
  if (diff < 172_800_000) return 'Hôm qua';
  return `${Math.floor(diff / 86_400_000)} ngày trước`;
};

const groupLabel = (value: string) => {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  if (sameDay) return 'HÔM NAY';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.getFullYear() === yesterday.getFullYear() && date.getMonth() === yesterday.getMonth() && date.getDate() === yesterday.getDate()) return 'HÔM QUA';
  return 'TRƯỚC ĐÓ';
};

const targetFor = (item: UserNotification) => {
  if (isWater(item) || isSleep(item)) return '/tracking';
  if (item.tone === 'workout') return '/workout';
  if (item.tone === 'coach') return '/coach';
  if (item.tone === 'progress') return '/progress';
  return '/notifications';
};

export default function NotificationsScreen() {
  const [items, setItems] = useState<UserNotification[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [sleepItem, setSleepItem] = useState<UserNotification | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await loadUserNotifications());
      setState('ready');
    } catch {
      setState('error');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const task = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(task);
  }, [load]);

  const visibleItems = useMemo(() => items.filter((item) => filter === 'all' || (filter === 'unread' ? !item.readAt : item.tone === filter)), [filter, items]);
  const unreadCount = useMemo(() => items.filter((item) => !item.readAt).length, [items]);
  const groupedItems = useMemo(() => visibleItems.reduce<Record<string, UserNotification[]>>((groups, item) => {
    const group = groupLabel(item.updatedAt || item.createdAt);
    groups[group] = [...(groups[group] ?? []), item];
    return groups;
  }, {}), [visibleItems]);

  const markRead = async (item: UserNotification) => {
    if (item.readAt) return;
    const now = new Date().toISOString();
    setItems((current) => current.map((value) => value.id === item.id ? { ...value, readAt: now } : value));
    try { await markUserNotificationRead(item.id); } catch { await load(); }
  };

  const openItem = async (item: UserNotification) => {
    await markRead(item);
    router.push(targetFor(item) as never);
  };

  const saveWater = async (item: UserNotification, amount: number) => {
    setSavingId(`${item.id}:${amount}`);
    try {
      await addWaterIntake(amount);
      await markRead(item);
      await load();
    } catch (error) {
      Alert.alert('Chưa thể ghi nước', error instanceof Error ? error.message : 'Hãy thử lại.');
    } finally { setSavingId(null); }
  };

  const saveSleep = async (hours: number) => {
    if (!sleepItem) return;
    setSavingId(`${sleepItem.id}:${hours}`);
    try {
      await recordSleepHours(hours);
      await markRead(sleepItem);
      setSleepItem(null);
      await load();
    } catch (error) {
      Alert.alert('Chưa thể ghi giấc ngủ', error instanceof Error ? error.message : 'Hãy thử lại.');
    } finally { setSavingId(null); }
  };

  const markAll = async () => {
    if (!unreadCount) return;
    const now = new Date().toISOString();
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? now })));
    try { await markAllUserNotificationsRead(); } catch { await load(); }
  };

  return (
    <Screen scroll={false}>
      <View style={styles.shell}>
        <View style={styles.header}><Pressable onPress={() => router.back()} hitSlop={8} style={styles.back}><AppIcon name="arrow-left" color={tokens.colors.lime} size={17} /><Text style={styles.backText}>Quay lại</Text></Pressable><Pressable disabled={!unreadCount} onPress={() => void markAll()} style={[styles.readAll, !unreadCount && styles.disabled]}><Text style={styles.readAllText}>Đã đọc hết</Text></Pressable></View>
        <View><Text style={styles.kicker}>FITLY</Text><Text style={styles.title}>Thông báo</Text><Text style={styles.subtitle}>{unreadCount ? `${unreadCount} cập nhật đang chờ bạn.` : 'Mọi cập nhật của bạn đều ở đây.'}</Text></View>
        <ScrollView horizontal style={styles.filterScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>{filters.map((item) => <Pressable key={item.id} onPress={() => setFilter(item.id)} style={[styles.filter, filter === item.id && styles.filterActive]}><Text style={[styles.filterText, filter === item.id && styles.filterTextActive]}>{item.label}</Text></Pressable>)}</ScrollView>

        {state === 'loading' ? <View style={styles.center}><ActivityIndicator color={tokens.colors.lime} size="large" /></View> : null}
        {state === 'error' ? <View style={styles.center}><Text style={styles.emptyTitle}>Chưa tải được thông báo</Text><Pressable onPress={() => void load()}><Text style={styles.retry}>Thử lại</Text></Pressable></View> : null}
        {state === 'ready' ? <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} colors={[tokens.colors.lime]} tintColor={tokens.colors.lime} />} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {visibleItems.length === 0 ? <View style={styles.empty}><View style={styles.emptyIcon}><AppIcon name="bell" color={tokens.colors.lime} size={23} /></View><Text style={styles.emptyTitle}>Chưa có thông báo phù hợp</Text><Text style={styles.emptyText}>Khi có lịch tập, nhắc nước, gợi ý Coach hoặc thử thách mới, Fitly sẽ lưu lại tại đây.</Text><Pressable onPress={() => router.push('/tracking')} style={styles.emptyButton}><Text style={styles.emptyButtonText}>Theo dõi hôm nay</Text></Pressable></View> : Object.entries(groupedItems).map(([label, group]) => <View key={label} style={styles.group}><Text style={styles.groupLabel}>{label}</Text>{group.map((item) => <NotificationCard key={item.id} item={item} savingId={savingId} onOpen={() => void openItem(item)} onWater={(amount) => void saveWater(item, amount)} onSleep={() => setSleepItem(item)} />)}</View>)}
        </ScrollView> : null}
      </View>

      <Modal transparent animationType="slide" visible={sleepItem !== null} onRequestClose={() => setSleepItem(null)}><View style={styles.modalLayer}><Pressable style={styles.modalBackdrop} onPress={() => setSleepItem(null)} /><View style={styles.sheet}><View style={styles.sheetHandle} /><Text style={styles.sheetKicker}>GHI GIẤC NGỦ</Text><Text style={styles.sheetTitle}>Đêm qua bạn ngủ bao lâu?</Text><View style={styles.sleepOptions}>{[4, 5, 6, 7, 8, 9, 10].map((hours) => <Pressable key={hours} disabled={Boolean(savingId)} onPress={() => void saveSleep(hours)} style={styles.sleepOption}>{savingId === `${sleepItem?.id}:${hours}` ? <ActivityIndicator color="#26172E" size="small" /> : <Text style={styles.sleepOptionText}>{hours}h</Text>}</Pressable>)}</View></View></View></Modal>
    </Screen>
  );
}

function NotificationCard({ item, savingId, onOpen, onWater, onSleep }: { item: UserNotification; savingId: string | null; onOpen: () => void; onWater: (amount: number) => void; onSleep: () => void }) {
  const meta = toneMeta[item.tone];
  return <View style={[styles.card, !item.readAt && styles.cardUnread]}><Pressable onPress={onOpen} style={styles.cardMain}><View style={[styles.cardIcon, { backgroundColor: meta.background }]}><AppIcon name={meta.icon} color={meta.color} size={19} /></View><View style={styles.cardCopy}><View style={styles.cardTitleRow}><Text numberOfLines={2} style={styles.cardTitle}>{item.title}</Text>{!item.readAt ? <View style={[styles.unreadDot, { backgroundColor: meta.color }]} /> : null}</View><Text style={styles.cardMeta}>{meta.label} · {formatTime(item.updatedAt || item.createdAt)}</Text><Text numberOfLines={3} style={styles.cardText}>{item.message}</Text></View><AppIcon name="arrow-right" color="#7B857E" size={16} /></Pressable>{isWater(item) && !item.readAt ? <View style={styles.actions}>{[250, 500].map((amount) => <Pressable key={amount} disabled={Boolean(savingId)} onPress={() => onWater(amount)} style={[styles.waterAction, savingId && styles.disabled]}>{savingId?.endsWith(`:${amount}`) ? <ActivityIndicator color="#052631" size="small" /> : <Text style={styles.waterActionText}>+{amount} ml</Text>}</Pressable>)}</View> : null}{isSleep(item) && !item.readAt ? <Pressable onPress={onSleep} style={styles.sleepAction}><Text style={styles.sleepActionText}>Ghi giấc ngủ</Text><AppIcon name="arrow-right" color="#D2AEFC" size={16} /></Pressable> : null}</View>;
}

const styles = StyleSheet.create({
  shell: { flex: 1, paddingHorizontal: tokens.spacing.lg, paddingTop: tokens.spacing.md, gap: 13 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 6 },
  backText: { color: tokens.colors.lime, fontSize: 13, fontWeight: '900' },
  readAll: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 14, backgroundColor: '#1B271D' },
  readAllText: { color: tokens.colors.lime, fontSize: 10, fontWeight: '900' },
  kicker: { color: '#8FA095', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  title: { marginTop: 2, color: tokens.colors.ink, fontSize: 29, fontWeight: '900' },
  subtitle: { marginTop: 4, color: tokens.colors.muted, fontSize: 12 },
  filterScroll: { flexGrow: 0, height: 38 },
  filterRow: { gap: 8, paddingVertical: 2 },
  filter: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 17, backgroundColor: '#171B18' },
  filterActive: { backgroundColor: tokens.colors.lime },
  filterText: { color: tokens.colors.muted, fontSize: 11, fontWeight: '800' },
  filterTextActive: { color: tokens.colors.canvas },
  list: { gap: 15, paddingBottom: 32 },
  group: { gap: 8 },
  groupLabel: { color: '#819087', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  card: { gap: 10, padding: 12, borderRadius: 19, backgroundColor: '#111512' },
  cardUnread: { backgroundColor: '#151C17' },
  cardMain: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardIcon: { alignItems: 'center', justifyContent: 'center', width: 39, height: 39, borderRadius: 14 },
  cardCopy: { flex: 1, gap: 3 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  cardTitle: { flex: 1, color: tokens.colors.ink, fontSize: 13, lineHeight: 17, fontWeight: '900' },
  unreadDot: { width: 7, height: 7, marginTop: 4, borderRadius: 4 },
  cardMeta: { color: '#89948D', fontSize: 9, fontWeight: '800' },
  cardText: { marginTop: 2, color: '#BCC4BE', fontSize: 11, lineHeight: 16 },
  actions: { flexDirection: 'row', gap: 8, paddingLeft: 49 },
  waterAction: { alignItems: 'center', justifyContent: 'center', minHeight: 34, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#69CEED' },
  waterActionText: { color: '#062630', fontSize: 11, fontWeight: '900' },
  sleepAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36, marginLeft: 49, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#2C2138' },
  sleepActionText: { color: '#D2AEFC', fontSize: 11, fontWeight: '900' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  empty: { alignItems: 'center', paddingHorizontal: 26, paddingTop: 64, gap: 8 },
  emptyIcon: { alignItems: 'center', justifyContent: 'center', width: 56, height: 56, marginBottom: 4, borderRadius: 28, backgroundColor: '#1B2A1C' },
  emptyTitle: { color: tokens.colors.ink, fontSize: 16, textAlign: 'center', fontWeight: '900' },
  emptyText: { color: tokens.colors.muted, textAlign: 'center', fontSize: 12, lineHeight: 18 },
  emptyButton: { marginTop: 8, paddingHorizontal: 15, paddingVertical: 10, borderRadius: 16, backgroundColor: tokens.colors.lime },
  emptyButtonText: { color: tokens.colors.canvas, fontSize: 12, fontWeight: '900' },
  retry: { color: tokens.colors.lime, fontSize: 13, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  modalLayer: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.72)' },
  sheet: { gap: 13, paddingHorizontal: tokens.spacing.lg, paddingTop: 10, paddingBottom: 34, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: '#121713' },
  sheetHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: '#667168' },
  sheetKicker: { color: '#D2AEFC', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  sheetTitle: { color: tokens.colors.ink, fontSize: 20, fontWeight: '900' },
  sleepOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sleepOption: { width: '22%', alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: 14, backgroundColor: '#D2AEFC' },
  sleepOptionText: { color: '#26172E', fontSize: 13, fontWeight: '900' },
});
