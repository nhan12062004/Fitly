import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { AppIcon } from '@/components/ui/app-icon';
import { Screen } from '@/components/ui/screen';
import { addWaterIntake, loadWellnessSnapshot, recordSleepHours, vietnamDateKey, type WellnessSnapshot } from '@/lib/wellness-read-model';
import { tokens } from '@/theme/tokens';

const WATER_AMOUNTS = [250, 500] as const;
const SLEEP_HOURS = [4, 5, 6, 7, 8, 9, 10] as const;

const shiftDateKey = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return vietnamDateKey(date);
};

const formatDayLabel = (dateKey: string) => {
  const today = vietnamDateKey();
  if (dateKey === today) return 'Hôm nay';
  if (dateKey === shiftDateKey(today, -1)) return 'Hôm qua';
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString('vi-VN', { weekday: 'short', day: 'numeric', month: 'numeric' });
};

export default function TrackingScreen() {
  const [dateKey, setDateKey] = useState(vietnamDateKey());
  const [snapshot, setSnapshot] = useState<WellnessSnapshot | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sheet, setSheet] = useState<'water' | 'sleep' | null>(null);
  const [customWater, setCustomWater] = useState('');

  const load = useCallback(async (refresh = false) => {
    if (refresh) setIsRefreshing(true);
    else setState('loading');
    try {
      setSnapshot(await loadWellnessSnapshot(dateKey));
      setState('ready');
    } catch {
      setState('error');
    } finally {
      setIsRefreshing(false);
    }
  }, [dateKey]);

  useEffect(() => {
    const task = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(task);
  }, [load]);

  const todayKey = vietnamDateKey();
  const isToday = dateKey === todayKey;
  const waterPercent = useMemo(() => snapshot?.waterGoalMl ? Math.min(100, Math.round((snapshot.waterIntakeMl / snapshot.waterGoalMl) * 100)) : 0, [snapshot]);
  const waterRemaining = snapshot?.waterGoalMl ? Math.max(0, snapshot.waterGoalMl - snapshot.waterIntakeMl) : 0;

  const saveWater = async (amount: number) => {
    if (!snapshot) return;
    const previous = snapshot;
    setSnapshot({ ...previous, waterIntakeMl: previous.waterIntakeMl + amount });
    setIsSaving(true);
    try {
      const savedWaterIntake = await addWaterIntake(amount, dateKey);
      setSnapshot((current) => current?.dateKey === dateKey ? { ...current, waterIntakeMl: savedWaterIntake } : current);
      setSheet(null);
      setCustomWater('');
    } catch (error) {
      setSnapshot(previous);
      Alert.alert('Chưa thể ghi nước', error instanceof Error ? error.message : 'Hãy thử lại.');
    } finally {
      setIsSaving(false);
    }
  };

  const saveSleep = async (hours: number) => {
    if (!snapshot) return;
    const previous = snapshot;
    setSnapshot({ ...previous, sleepHours: hours });
    setIsSaving(true);
    try {
      const savedSleepHours = await recordSleepHours(hours, dateKey);
      setSnapshot((current) => current?.dateKey === dateKey ? { ...current, sleepHours: savedSleepHours } : current);
      setSheet(null);
    } catch (error) {
      setSnapshot(previous);
      Alert.alert('Chưa thể ghi giấc ngủ', error instanceof Error ? error.message : 'Hãy thử lại.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Screen contentStyle={styles.content} refreshing={isRefreshing} onRefresh={() => void load(true)}>
      <View style={styles.topRow}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back}><AppIcon name="arrow-left" color={tokens.colors.lime} size={17} /><Text style={styles.backText}>Quay lại</Text></Pressable>
        <Pressable onPress={() => router.push('/notifications')} hitSlop={8} style={styles.bell}><AppIcon name="bell" color={tokens.colors.ink} size={18} /></Pressable>
      </View>

      <View><Text style={styles.kicker}>NHỊP SỐNG</Text><Text style={styles.title}>Chăm cơ thể mỗi ngày</Text><Text style={styles.subtitle}>Hai việc nhỏ giúp Fitly hiểu nhịp phục hồi của bạn hơn.</Text></View>

      <View style={styles.dayControl}>
        <Pressable onPress={() => setDateKey((value) => shiftDateKey(value, -1))} hitSlop={8} style={styles.dayArrow}><Text style={styles.dayArrowText}>‹</Text></Pressable>
        <View><Text style={styles.dayLabel}>{formatDayLabel(dateKey)}</Text><Text style={styles.dateLabel}>{new Date(`${dateKey}T12:00:00`).toLocaleDateString('vi-VN', { day: 'numeric', month: 'long' })}</Text></View>
        <Pressable disabled={isToday} onPress={() => setDateKey((value) => shiftDateKey(value, 1))} hitSlop={8} style={[styles.dayArrow, isToday && styles.dayArrowDisabled]}><Text style={styles.dayArrowText}>›</Text></Pressable>
      </View>

      {state === 'loading' ? <View style={styles.center}><ActivityIndicator color={tokens.colors.lime} size="large" /></View> : null}
      {state === 'error' ? <View style={styles.errorCard}><Text style={styles.errorTitle}>Chưa tải được dữ liệu</Text><Pressable onPress={() => void load()}><Text style={styles.retry}>Thử lại</Text></Pressable></View> : null}
      {state === 'ready' && snapshot ? <>
        <View style={styles.waterCard}>
          <View style={styles.cardHead}><View style={styles.waterMark}><Text style={styles.waterMarkText}>H₂O</Text></View><View style={styles.cardHeadCopy}><Text style={styles.cardKicker}>NƯỚC</Text><Text style={styles.cardTitle}>Uống đủ, cơ thể nhẹ hơn</Text></View><Text style={styles.percent}>{waterPercent}%</Text></View>
          <View style={styles.waterReading}><Text style={styles.waterValue}>{(snapshot.waterIntakeMl / 1000).toFixed(1)}</Text><Text style={styles.waterUnit}> / {(snapshot.waterGoalMl / 1000).toFixed(1)} L</Text></View>
          <Text style={styles.cardDescription}>{snapshot.waterGoalMl ? waterRemaining > 0 ? `Còn ${waterRemaining} ml để chạm mục tiêu hôm nay.` : 'Bạn đã chạm mục tiêu nước hôm nay.' : 'Đặt mục tiêu nước trong Hồ sơ để theo dõi chính xác hơn.'}</Text>
          <View style={styles.track}><View style={[styles.waterFill, { width: `${waterPercent}%` }]} /></View>
          <View style={styles.waterActions}>{WATER_AMOUNTS.map((amount) => <Pressable key={amount} disabled={isSaving} onPress={() => void saveWater(amount)} style={({ pressed }) => [styles.waterQuick, pressed && styles.pressed, isSaving && styles.disabled]}><Text style={styles.waterQuickText}>+{amount} ml</Text></Pressable>)}<Pressable disabled={isSaving} onPress={() => setSheet('water')} style={({ pressed }) => [styles.waterCustom, pressed && styles.pressed, isSaving && styles.disabled]}><Text style={styles.waterCustomText}>Tự nhập</Text></Pressable></View>
        </View>

        <View style={styles.sleepCard}>
          <View style={styles.cardHead}><View style={styles.sleepMark}><Text style={styles.sleepMarkText}>☾</Text></View><View style={styles.cardHeadCopy}><Text style={styles.sleepKicker}>GIẤC NGỦ</Text><Text style={styles.cardTitle}>Phục hồi cho ngày mai</Text></View></View>
          <View style={styles.sleepReading}><Text style={styles.sleepValue}>{snapshot.sleepHours ?? '—'}</Text><Text style={styles.sleepUnit}> giờ</Text><Text style={styles.sleepTarget}>Mục tiêu {snapshot.sleepGoalHours}h</Text></View>
          <Text style={styles.cardDescription}>{snapshot.sleepHours ? snapshot.sleepHours >= snapshot.sleepGoalHours ? 'Bạn đã cho cơ thể đủ thời gian phục hồi.' : `Còn thiếu ${(snapshot.sleepGoalHours - snapshot.sleepHours).toFixed(1)} giờ so với nhịp mong muốn.` : 'Ghi lại thời lượng ngủ để AI Coach điều chỉnh nhịp tập phù hợp.'}</Text>
          <Pressable disabled={isSaving} onPress={() => setSheet('sleep')} style={({ pressed }) => [styles.sleepAction, pressed && styles.pressed, isSaving && styles.disabled]}><Text style={styles.sleepActionText}>{snapshot.sleepHours ? 'Sửa giờ ngủ' : 'Ghi giấc ngủ'}</Text><AppIcon name="arrow-right" color="#E7DAFF" size={17} /></Pressable>
          {snapshot.sleepQuality ? <Text style={styles.sleepQuality}>Nhịp ngủ mong muốn: {snapshot.sleepQuality}</Text> : null}
        </View>
      </> : null}

      <Pressable onPress={() => router.push('/progress')} style={({ pressed }) => [styles.progressLink, pressed && styles.pressed]}><View><Text style={styles.progressKicker}>NHÌN LẠI NHỊP CỦA BẠN</Text><Text style={styles.progressTitle}>Xem tiến độ sức khoẻ</Text></View><AppIcon name="arrow-right" color={tokens.colors.lime} size={20} /></Pressable>

      <Modal transparent animationType="slide" visible={sheet !== null} onRequestClose={() => setSheet(null)}>
        <View style={styles.modalLayer}><Pressable style={styles.modalBackdrop} onPress={() => setSheet(null)} /><View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          {sheet === 'water' ? <><Text style={styles.sheetKicker}>GHI NƯỚC</Text><Text style={styles.sheetTitle}>Bạn vừa uống bao nhiêu?</Text><TextInput value={customWater} onChangeText={setCustomWater} keyboardType="number-pad" autoFocus placeholder="Ví dụ: 350" placeholderTextColor="#758078" style={styles.waterInput} /><Text style={styles.sheetHint}>Đơn vị ml</Text><Pressable disabled={isSaving || !customWater.trim()} onPress={() => void saveWater(Number(customWater))} style={[styles.sheetButton, (isSaving || !customWater.trim()) && styles.disabled]}>{isSaving ? <ActivityIndicator color={tokens.colors.canvas} /> : <Text style={styles.sheetButtonText}>Lưu lượng nước</Text>}</Pressable></> : <><Text style={styles.sheetKicker}>GHI GIẤC NGỦ</Text><Text style={styles.sheetTitle}>Đêm qua bạn ngủ bao lâu?</Text><View style={styles.sleepOptions}>{SLEEP_HOURS.map((hours) => <Pressable key={hours} disabled={isSaving} onPress={() => void saveSleep(hours)} style={({ pressed }) => [styles.sleepOption, snapshot?.sleepHours === hours && styles.sleepOptionActive, pressed && styles.pressed]}><Text style={[styles.sleepOptionText, snapshot?.sleepHours === hours && styles.sleepOptionTextActive]}>{hours}h</Text></Pressable>)}</View><Text style={styles.sheetHint}>Bạn có thể cập nhật lại bất cứ lúc nào.</Text></>}
        </View></View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: tokens.spacing.lg, paddingTop: tokens.spacing.md, paddingBottom: 36, gap: 14 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 6 },
  backText: { color: tokens.colors.lime, fontSize: 13, fontWeight: '900' },
  bell: { alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 19, backgroundColor: '#151A16' },
  kicker: { color: '#74B9FF', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  title: { marginTop: 3, color: tokens.colors.ink, fontSize: 28, lineHeight: 33, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { marginTop: 5, color: tokens.colors.muted, fontSize: 12, lineHeight: 18 },
  dayControl: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 11, borderRadius: 18, backgroundColor: '#111613' },
  dayArrow: { alignItems: 'center', justifyContent: 'center', width: 35, height: 35, borderRadius: 18, backgroundColor: '#202720' },
  dayArrowDisabled: { opacity: 0.32 },
  dayArrowText: { color: tokens.colors.ink, fontSize: 24, lineHeight: 26 },
  dayLabel: { color: tokens.colors.ink, textAlign: 'center', fontSize: 14, fontWeight: '900' },
  dateLabel: { marginTop: 1, color: tokens.colors.muted, textAlign: 'center', fontSize: 10, fontWeight: '700' },
  center: { minHeight: 360, alignItems: 'center', justifyContent: 'center' },
  errorCard: { gap: 8, padding: tokens.spacing.lg, borderRadius: 20, backgroundColor: '#211311' },
  errorTitle: { color: tokens.colors.ink, fontWeight: '900' },
  retry: { color: tokens.colors.coral, fontSize: 13, fontWeight: '900' },
  waterCard: { gap: 12, padding: 16, borderRadius: 24, backgroundColor: '#13242B' },
  sleepCard: { gap: 12, padding: 16, borderRadius: 24, backgroundColor: '#21192A' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardHeadCopy: { flex: 1, gap: 2 },
  waterMark: { alignItems: 'center', justifyContent: 'center', width: 43, height: 43, borderRadius: 15, backgroundColor: '#154A5B' },
  waterMarkText: { color: '#78D8FF', fontSize: 13, fontWeight: '900' },
  sleepMark: { alignItems: 'center', justifyContent: 'center', width: 43, height: 43, borderRadius: 15, backgroundColor: '#423054' },
  sleepMarkText: { marginTop: -2, color: '#DBBCFF', fontSize: 28, lineHeight: 30 },
  cardKicker: { color: '#76CDEE', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  sleepKicker: { color: '#D3AFFF', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  cardTitle: { color: tokens.colors.ink, fontSize: 16, fontWeight: '900' },
  percent: { color: '#78D8FF', fontSize: 15, fontWeight: '900' },
  waterReading: { flexDirection: 'row', alignItems: 'baseline', marginTop: 3 },
  waterValue: { color: tokens.colors.ink, fontSize: 38, lineHeight: 42, fontWeight: '900', letterSpacing: -1.1 },
  waterUnit: { color: '#9CC3CD', fontSize: 13, fontWeight: '800' },
  cardDescription: { color: '#B8C4BE', fontSize: 12, lineHeight: 18 },
  track: { overflow: 'hidden', height: 8, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.22)' },
  waterFill: { height: '100%', borderRadius: 4, backgroundColor: '#65D4FF' },
  waterActions: { flexDirection: 'row', gap: 8 },
  waterQuick: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 42, borderRadius: 14, backgroundColor: '#65D4FF' },
  waterQuickText: { color: '#06232E', fontSize: 12, fontWeight: '900' },
  waterCustom: { alignItems: 'center', justifyContent: 'center', minHeight: 42, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#25434D' },
  waterCustomText: { color: '#B8EAFA', fontSize: 12, fontWeight: '900' },
  sleepReading: { flexDirection: 'row', alignItems: 'baseline', marginTop: 3 },
  sleepValue: { color: tokens.colors.ink, fontSize: 38, lineHeight: 42, fontWeight: '900', letterSpacing: -1.1 },
  sleepUnit: { color: '#C5AFD7', fontSize: 13, fontWeight: '800' },
  sleepTarget: { marginLeft: 'auto', color: '#C4AED8', fontSize: 11, fontWeight: '800' },
  sleepAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: 13, borderRadius: 15, backgroundColor: '#38274A' },
  sleepActionText: { color: '#E7DAFF', fontSize: 13, fontWeight: '900' },
  sleepQuality: { color: '#B99BD2', fontSize: 10, fontWeight: '700' },
  progressLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 15, borderRadius: 20, backgroundColor: '#121713' },
  progressKicker: { color: '#88A493', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  progressTitle: { marginTop: 3, color: tokens.colors.ink, fontSize: 15, fontWeight: '900' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
  modalLayer: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.72)' },
  sheet: { gap: 12, paddingHorizontal: tokens.spacing.lg, paddingTop: 10, paddingBottom: 34, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: '#121713' },
  sheetHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: '#637067' },
  sheetKicker: { marginTop: 4, color: tokens.colors.lime, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  sheetTitle: { color: tokens.colors.ink, fontSize: 21, fontWeight: '900' },
  waterInput: { height: 54, paddingHorizontal: 15, borderRadius: 16, color: tokens.colors.ink, fontSize: 19, fontWeight: '900', backgroundColor: '#1C231E' },
  sheetHint: { color: tokens.colors.muted, fontSize: 11 },
  sheetButton: { alignItems: 'center', justifyContent: 'center', minHeight: 50, borderRadius: 16, backgroundColor: tokens.colors.lime },
  sheetButtonText: { color: tokens.colors.canvas, fontSize: 14, fontWeight: '900' },
  sleepOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sleepOption: { width: '22%', alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: 14, backgroundColor: '#2B2035' },
  sleepOptionActive: { backgroundColor: '#D7B3FF' },
  sleepOptionText: { color: '#D9C8EB', fontSize: 13, fontWeight: '900' },
  sleepOptionTextActive: { color: '#25172E' },
});
