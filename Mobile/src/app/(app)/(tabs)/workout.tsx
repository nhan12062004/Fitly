import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { AppIcon } from '@/components/ui/app-icon';
import { Screen } from '@/components/ui/screen';
import { ApiClientError, apiRequest } from '@/lib/api-client';
import { loadTodayWorkout, toWorkoutItem, type WorkoutItem } from '@/lib/fitness-read-model';
import { tokens } from '@/theme/tokens';

const weekLabels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const weekDayNames = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

const buildMonthWeeks = (date: Date) => {
  const leadingDays = (new Date(date.getFullYear(), date.getMonth(), 1).getDay() + 6) % 7;
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const slots = Array.from({ length: leadingDays + daysInMonth }, (_, index) => index < leadingDays ? null : index - leadingDays + 1);
  while (slots.length % 7 !== 0) slots.push(null);
  return Array.from({ length: slots.length / 7 }, (_, index) => slots.slice(index * 7, index * 7 + 7));
};

export default function WorkoutScreen() {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [items, setItems] = useState<WorkoutItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingSetKeys, setPendingSetKeys] = useState<Set<string>>(() => new Set());
  const [isCalendarVisible, setIsCalendarVisible] = useState(false);
  const [isPlanModalVisible, setIsPlanModalVisible] = useState(false);
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [goal, setGoal] = useState('Giảm mỡ');
  const [duration, setDuration] = useState('30 phút');
  const [location, setLocation] = useState('Tại nhà');
  const pendingSetKeysRef = useRef<Set<string>>(new Set());
  const today = new Date();
  const mondayOffset = (today.getDay() + 6) % 7;
  const weekDates = Array.from({ length: 7 }, (_, index) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset + index));
  const calendarWeeks = buildMonthWeeks(today);
  const hasWorkout = items.length > 0;
  const completedSets = items.reduce((total, item) => total + item.completedSets, 0);
  const totalSets = items.reduce((total, item) => total + item.totalSets, 0);
  const remainingSets = Math.max(totalSets - completedSets, 0);
  const monthLabel = `Tháng ${today.getMonth() + 1}, ${today.getFullYear()}`;

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      setItems(await loadTodayWorkout());
      setState('ready');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Không thể tải buổi tập.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    const task = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(task);
  }, [load]);

  const reconcileWorkout = useCallback(async () => {
    try {
      setItems(await loadTodayWorkout());
      setState('ready');
    } catch {
      setError('Không thể tải lại trạng thái buổi tập. Hãy làm mới trước khi thao tác tiếp.');
    }
  }, []);

  const completeSet = useCallback(async (item: WorkoutItem, setNumber: number) => {
    const setKey = `${item.id}:${setNumber}`;
    if (pendingSetKeysRef.current.has(setKey) || setNumber !== item.completedSets + 1) return;

    pendingSetKeysRef.current.add(setKey);
    setPendingSetKeys(new Set(pendingSetKeysRef.current));
    setError(null);
    try {
      const response = await apiRequest<{ exercise: unknown }>(`/api/workout/daily-exercises/${item.id}/complete-set`, {
        method: 'POST', body: { restSeconds: item.restSeconds ?? 0 }, timeoutMs: 15_000,
      });
      const serverItem = toWorkoutItem(response.exercise);
      setItems((current) => current.map((currentItem) => currentItem.id === serverItem.id ? serverItem : currentItem));
    } catch (nextError) {
      if (nextError instanceof ApiClientError) {
        setError(nextError.message);
      } else {
        setError('Kết nối bị gián đoạn. App đã tải lại trạng thái và không gửi lại set.');
        await reconcileWorkout();
      }
    } finally {
      pendingSetKeysRef.current.delete(setKey);
      setPendingSetKeys(new Set(pendingSetKeysRef.current));
    }
  }, [reconcileWorkout]);

  const closePlanModal = () => {
    if (isCreatingPlan) return;
    setIsPlanModalVisible(false);
    setPlanError(null);
  };

  const createPlan = async () => {
    setIsCreatingPlan(true);
    setPlanError(null);
    try {
      const logDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      await apiRequest('/api/ai-coach/generate-daily-workout', {
        method: 'POST',
        body: { logDate },
        timeoutMs: 45_000,
      });
      setIsPlanModalVisible(false);
      await load();
    } catch (nextError) {
      setPlanError(nextError instanceof Error ? nextError.message : 'Không thể tạo lịch tập. Vui lòng thử lại.');
    } finally {
      setIsCreatingPlan(false);
    }
  };

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.header}>
        <View><Text style={styles.headerKicker}>FITLY / WORKOUT</Text><Text style={styles.headerTitle}>Tập luyện</Text><Text style={styles.headerDate}>{weekDayNames[today.getDay()]}, {today.getDate()} tháng {today.getMonth() + 1}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Làm mới buổi tập" onPress={() => void load()} style={styles.refreshButton}>{state === 'loading' ? <ActivityIndicator color={tokens.colors.lime} size="small" /> : <AppIcon name="refresh" color={tokens.colors.lime} size={19} />}</Pressable>
      </View>

      <View style={styles.hero}>
        <View style={styles.heroTop}><View style={styles.heroStatus}><View style={styles.heroPulse} /><Text style={styles.heroStatusText}>{hasWorkout ? 'BUỔI TẬP ĐANG SẴN SÀNG' : 'HÔM NAY LÀ NGÀY TỰ DO'}</Text></View><AppIcon name={hasWorkout ? 'workout' : 'target'} color={tokens.colors.lime} size={25} /></View>
        <Text style={styles.heroTitle}>{hasWorkout ? 'Tập trung và\ntiến lên.' : 'Chọn cách\nbạn muốn tập.'}</Text>
        <Text style={styles.heroCopy}>{hasWorkout ? `Còn ${remainingSets} set để hoàn thành mục tiêu hôm nay.` : 'Tạo một lịch tập phù hợp với mục tiêu và thời gian của bạn.'}</Text>
        <View style={styles.heroStats}>
          <View style={styles.heroStat}><Text style={styles.heroStatValue}>{hasWorkout ? items.length : '—'}</Text><Text style={styles.heroStatLabel}>BÀI TẬP</Text></View>
          <View style={styles.statDivider} />
          <View style={styles.heroStat}><Text style={styles.heroStatValue}>{totalSets ? `${completedSets}/${totalSets}` : '0/0'}</Text><Text style={styles.heroStatLabel}>SETS</Text></View>
          <View style={styles.statDivider} />
          <View style={styles.heroStat}><Text style={styles.heroStatValue}>{hasWorkout && remainingSets === 0 ? 'Xong' : 'Mới'}</Text><Text style={styles.heroStatLabel}>TRẠNG THÁI</Text></View>
        </View>
        <Pressable onPress={() => hasWorkout ? router.push({ pathname: '/workout/[id]', params: { id: items[0]?.id } }) : (setPlanError(null), setIsPlanModalVisible(true))} style={styles.heroAction}>
          <Text style={styles.heroActionText}>{hasWorkout ? 'Bắt đầu buổi tập' : 'Tạo lịch với AI Coach'}</Text><AppIcon name="arrow-right" color={tokens.colors.canvas} size={18} />
        </Pressable>
      </View>

      <View style={styles.weekSection}>
        <View style={styles.sectionHeading}><View><Text style={styles.sectionKicker}>NHỊP ĐỘ TRONG TUẦN</Text><Text style={styles.sectionTitle}>Tuần này</Text></View><Text style={styles.weekSummary}>{hasWorkout ? '1 buổi đã lên lịch' : 'Chưa có buổi nào'}</Text></View>
        <View style={styles.weekTrack}>
          {weekDates.map((date, index) => {
            const active = date.toDateString() === today.toDateString();
            return <View key={date.toISOString()} style={styles.weekDayItem}><Text style={[styles.weekLabel, active && styles.weekLabelActive]}>{weekLabels[index]}</Text><View style={[styles.weekDate, active && styles.weekDateActive]}><Text style={[styles.weekDateText, active && styles.weekDateTextActive]}>{date.getDate()}</Text></View><View style={[styles.weekMarker, active && styles.weekMarkerActive]} /></View>;
          })}
        </View>
      </View>

      <View style={styles.workoutSection}>
        <View style={styles.sectionHeading}><View><Text style={styles.sectionKicker}>LỘ TRÌNH HÔM NAY</Text><Text style={styles.sectionTitle}>Buổi tập của bạn</Text></View><View style={styles.remainingChip}><Text style={styles.remainingChipText}>{totalSets ? `${remainingSets} set còn lại` : 'Chưa có lịch'}</Text></View></View>
        {state === 'loading' ? <View style={styles.loadingPanel}><ActivityIndicator color={tokens.colors.lime} /></View> : null}
        {state !== 'loading' && !hasWorkout ? <View style={styles.noWorkoutPanel}><View style={styles.noWorkoutIcon}><AppIcon name="coach" color={tokens.colors.lime} size={22} /></View><View style={styles.noWorkoutCopy}><Text style={styles.noWorkoutTitle}>Lịch tập vẫn đang trống</Text><Text style={styles.noWorkoutText}>AI Coach sẽ tạo bài tập và số set phù hợp cho hôm nay.</Text></View><Pressable onPress={() => { setPlanError(null); setIsPlanModalVisible(true); }} style={styles.noWorkoutButton}><AppIcon name="arrow-right" color={tokens.colors.canvas} size={17} /></Pressable></View> : null}
        {items.map((item, index) => (
          <View key={item.id} style={styles.exerciseCard}>
            <View style={styles.exerciseNumber}><Text style={styles.exerciseNumberText}>{String(index + 1).padStart(2, '0')}</Text></View>
            <View style={styles.exerciseMain}><Text style={styles.exerciseName}>{item.name}</Text><Text style={styles.exerciseMeta}>{item.reps ?? '—'} reps · {item.weightKg ?? '—'} kg · {item.totalSets} sets</Text><View style={styles.setRow}>{Array.from({ length: item.totalSets }, (_, setIndex) => {
              const setNumber = setIndex + 1;
              const key = `${item.id}:${setNumber}`;
              const complete = setNumber <= item.completedSets;
              const pending = pendingSetKeys.has(key);
              const canComplete = setNumber === item.completedSets + 1 && !pending;
              return <Pressable key={key} disabled={!canComplete} onPress={() => void completeSet(item, setNumber)} style={[styles.setButton, complete && styles.setButtonDone, !canComplete && !complete && styles.setButtonLocked]}>{pending ? <ActivityIndicator size="small" color={tokens.colors.canvas} /> : <Text style={[styles.setButtonText, complete && styles.setButtonTextDone]}>{complete ? '✓' : setNumber}</Text>}</Pressable>;
            })}</View></View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Mở ${item.name}`} onPress={() => router.push({ pathname: '/workout/[id]', params: { id: item.id } })} style={styles.openExercise}><AppIcon name="arrow-right" color={tokens.colors.ink} size={18} /></Pressable>
          </View>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.recoveryCard}>
        <View style={styles.recoveryIcon}><AppIcon name="target" color="#FFB36C" size={20} /></View>
        <View style={styles.recoveryCopy}><Text style={styles.recoveryKicker}>{hasWorkout ? 'GỢI Ý GIỮ NHỊP' : 'NGÀY PHỤC HỒI'}</Text><Text style={styles.recoveryTitle}>{hasWorkout ? 'Khởi động nhẹ trước buổi tập' : 'Chuyển động nhẹ nhàng'}</Text><Text style={styles.recoveryText}>{hasWorkout ? 'Dành 5–10 phút mobility để cơ thể sẵn sàng hơn.' : 'Đi bộ, mobility hoặc stretching 10–20 phút là đủ.'}</Text></View>
      </View>

      <Pressable onPress={() => setIsCalendarVisible((visible) => !visible)} style={styles.calendarToggle}>
        <View style={styles.calendarToggleIcon}><AppIcon name="calendar" color={tokens.colors.lime} size={18} /></View><View style={styles.calendarToggleCopy}><Text style={styles.calendarToggleTitle}>Xem lịch tháng</Text><Text style={styles.calendarToggleText}>{monthLabel}</Text></View><Text style={styles.toggleChevron}>{isCalendarVisible ? '−' : '+'}</Text>
      </Pressable>
      {isCalendarVisible ? <View style={styles.monthPanel}><View style={styles.monthPanelHeading}><Text style={styles.monthPanelTitle}>{monthLabel.toUpperCase()}</Text><View style={styles.monthLegend}><View style={styles.monthLegendDot} /><Text style={styles.monthLegendText}>Hôm nay</Text></View></View><View style={styles.monthWeekRow}>{weekLabels.map((label) => <Text key={label} style={styles.monthWeekLabel}>{label}</Text>)}</View><View style={styles.monthGrid}>{calendarWeeks.map((week, weekIndex) => <View key={weekIndex} style={styles.monthGridRow}>{week.map((day, dayIndex) => day === null ? <View key={`empty-${weekIndex}-${dayIndex}`} style={styles.monthBlank} /> : <View key={day} style={[styles.monthDay, day === today.getDate() && styles.monthDayActive]}><Text style={[styles.monthDayText, day === today.getDate() && styles.monthDayTextActive]}>{day}</Text></View>)}</View>)}</View></View> : null}

      <Modal visible={isPlanModalVisible} transparent animationType="slide" onRequestClose={closePlanModal}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closePlanModal} />
          <View style={styles.planModal}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}><View style={styles.modalIcon}><AppIcon name="workout" color={tokens.colors.canvas} size={21} /></View><View style={styles.modalHeaderCopy}><Text style={styles.modalKicker}>THIẾT LẬP NHANH</Text><Text style={styles.modalTitle}>Tạo kế hoạch tập</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Đóng" onPress={closePlanModal} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable></View>
            <Text style={styles.modalIntro}>Chọn thông tin cho buổi tập hôm nay. Fitly sẽ tạo lịch ngay sau khi bạn xác nhận.</Text>
            <Text style={styles.optionLabel}>Mục tiêu chính</Text><View style={styles.optionRow}>{['Giảm mỡ', 'Tăng cơ', 'Sức khỏe'].map((option) => <Pressable key={option} onPress={() => setGoal(option)} style={[styles.optionChip, goal === option && styles.optionChipActive]}><Text style={[styles.optionChipText, goal === option && styles.optionChipTextActive]}>{option}</Text></Pressable>)}</View>
            <Text style={styles.optionLabel}>Thời lượng mỗi buổi</Text><View style={styles.optionRow}>{['20 phút', '30 phút', '45 phút'].map((option) => <Pressable key={option} onPress={() => setDuration(option)} style={[styles.optionChip, duration === option && styles.optionChipActive]}><Text style={[styles.optionChipText, duration === option && styles.optionChipTextActive]}>{option}</Text></Pressable>)}</View>
            <Text style={styles.optionLabel}>Bạn tập ở đâu?</Text><View style={styles.optionRow}>{['Tại nhà', 'Phòng gym'].map((option) => <Pressable key={option} onPress={() => setLocation(option)} style={[styles.optionChip, location === option && styles.optionChipActive]}><Text style={[styles.optionChipText, location === option && styles.optionChipTextActive]}>{option}</Text></Pressable>)}</View>
            <View style={styles.planSummary}><AppIcon name="coach" color={tokens.colors.lime} size={21} /><View style={styles.planSummaryCopy}><Text style={styles.planSummaryTitle}>Kế hoạch của bạn</Text><Text style={styles.planSummaryText}>{goal} · {duration} · {location}</Text></View></View>
            {planError ? <Text style={styles.planError}>{planError}</Text> : null}
            <View style={styles.modalActions}><Pressable disabled={isCreatingPlan} onPress={() => void createPlan()} style={[styles.createPlanButton, isCreatingPlan && styles.createPlanButtonDisabled]}>{isCreatingPlan ? <ActivityIndicator color={tokens.colors.canvas} /> : <><Text style={styles.createPlanText}>Tạo lịch tập hôm nay</Text><AppIcon name="arrow-right" color={tokens.colors.canvas} size={18} /></>}</Pressable></View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: tokens.spacing.md, paddingBottom: tokens.spacing.xl, gap: tokens.spacing.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: tokens.spacing.xs },
  headerKicker: { color: tokens.colors.lime, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  headerTitle: { marginTop: 2, color: tokens.colors.ink, fontSize: 29, fontWeight: '900' },
  headerDate: { marginTop: 2, color: tokens.colors.muted, fontSize: 12, fontWeight: '700' },
  refreshButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: '#121513', borderWidth: 1, borderColor: '#2D3932' },
  hero: { overflow: 'hidden', padding: tokens.spacing.lg, borderRadius: tokens.radius.lg, backgroundColor: '#122419', borderWidth: 1, borderColor: '#326B48' },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroStatus: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroPulse: { width: 7, height: 7, borderRadius: 4, backgroundColor: tokens.colors.lime },
  heroStatusText: { color: '#A4E8B7', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  heroTitle: { marginTop: tokens.spacing.md, color: tokens.colors.ink, fontSize: 30, lineHeight: 35, fontWeight: '900' },
  heroCopy: { maxWidth: 300, marginTop: tokens.spacing.sm, color: '#B3C2B8', fontSize: 13, lineHeight: 19 },
  heroStats: { flexDirection: 'row', alignItems: 'center', marginTop: tokens.spacing.lg, paddingVertical: tokens.spacing.sm, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#31553D' },
  heroStat: { flex: 1, gap: 2 },
  heroStatValue: { color: tokens.colors.ink, fontSize: 15, fontWeight: '900' },
  heroStatLabel: { color: '#8FAA98', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  statDivider: { width: 1, height: 27, backgroundColor: '#31553D' },
  heroAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: tokens.spacing.md, minHeight: 46, paddingHorizontal: tokens.spacing.md, borderRadius: tokens.radius.md, backgroundColor: tokens.colors.lime },
  heroActionText: { color: tokens.colors.canvas, fontSize: 14, fontWeight: '900' },
  weekSection: { padding: tokens.spacing.md, borderRadius: tokens.radius.md, backgroundColor: '#111211', borderWidth: 1, borderColor: '#292D2A' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.spacing.sm },
  sectionKicker: { color: '#7A9B86', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  sectionTitle: { marginTop: 2, color: tokens.colors.ink, fontSize: 17, fontWeight: '900' },
  weekSummary: { color: tokens.colors.muted, fontSize: 10, fontWeight: '700' },
  weekTrack: { flexDirection: 'row', justifyContent: 'space-between', marginTop: tokens.spacing.md },
  weekDayItem: { flex: 1, alignItems: 'center', gap: 6 },
  weekLabel: { color: '#858B87', fontSize: 10, fontWeight: '900' },
  weekLabelActive: { color: tokens.colors.lime },
  weekDate: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#202320' },
  weekDateActive: { backgroundColor: tokens.colors.lime },
  weekDateText: { color: '#CFD3CF', fontSize: 12, fontWeight: '900' },
  weekDateTextActive: { color: tokens.colors.canvas },
  weekMarker: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#3A403C' },
  weekMarkerActive: { backgroundColor: tokens.colors.lime },
  workoutSection: { gap: tokens.spacing.md },
  remainingChip: { paddingHorizontal: tokens.spacing.sm, paddingVertical: 6, borderRadius: tokens.radius.pill, borderWidth: 1, borderColor: '#2C6847', backgroundColor: '#102719' },
  remainingChipText: { color: '#62DD8B', fontSize: 10, fontWeight: '900' },
  loadingPanel: { minHeight: 105, alignItems: 'center', justifyContent: 'center', borderRadius: tokens.radius.md, backgroundColor: '#101210' },
  noWorkoutPanel: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm, padding: tokens.spacing.md, borderRadius: tokens.radius.md, backgroundColor: '#121513', borderWidth: 1, borderColor: '#2A302B' },
  noWorkoutIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#192B1F' },
  noWorkoutCopy: { flex: 1, gap: 3 },
  noWorkoutTitle: { color: tokens.colors.ink, fontSize: 14, fontWeight: '900' },
  noWorkoutText: { color: tokens.colors.muted, fontSize: 11, lineHeight: 16 },
  noWorkoutButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: tokens.colors.lime },
  exerciseCard: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm, padding: tokens.spacing.md, borderRadius: tokens.radius.md, backgroundColor: '#151816', borderWidth: 1, borderColor: '#2A322C' },
  exerciseNumber: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#26372B' },
  exerciseNumberText: { color: tokens.colors.lime, fontSize: 11, fontWeight: '900' },
  exerciseMain: { flex: 1, gap: 4 },
  exerciseName: { color: tokens.colors.ink, fontSize: 14, fontWeight: '900' },
  exerciseMeta: { color: tokens.colors.muted, fontSize: 11 },
  setRow: { flexDirection: 'row', gap: 5, marginTop: 3 },
  setButton: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: tokens.colors.lime },
  setButtonDone: { backgroundColor: '#1E3325', borderWidth: 1, borderColor: tokens.colors.lime },
  setButtonLocked: { opacity: 0.32 },
  setButtonText: { color: tokens.colors.canvas, fontSize: 10, fontWeight: '900' },
  setButtonTextDone: { color: tokens.colors.lime },
  openExercise: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#292D2B' },
  error: { color: tokens.colors.danger, fontSize: 12, lineHeight: 18 },
  recoveryCard: { flexDirection: 'row', gap: tokens.spacing.sm, padding: tokens.spacing.md, borderRadius: tokens.radius.md, borderWidth: 1, borderColor: '#613D20', backgroundColor: '#1B1815' },
  recoveryIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#3C291C' },
  recoveryCopy: { flex: 1, gap: 3 },
  recoveryKicker: { color: '#F5B77B', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  recoveryTitle: { color: tokens.colors.ink, fontSize: 14, fontWeight: '900' },
  recoveryText: { color: '#B4AAA0', fontSize: 11, lineHeight: 16 },
  calendarToggle: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm, padding: tokens.spacing.md, borderRadius: tokens.radius.md, backgroundColor: '#0E100F', borderWidth: 1, borderColor: '#292E2B' },
  calendarToggleIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#18251C' },
  calendarToggleCopy: { flex: 1, gap: 2 },
  calendarToggleTitle: { color: tokens.colors.ink, fontSize: 13, fontWeight: '900' },
  calendarToggleText: { color: tokens.colors.muted, fontSize: 11 },
  toggleChevron: { color: tokens.colors.lime, fontSize: 23, fontWeight: '500' },
  monthPanel: { gap: tokens.spacing.sm, padding: tokens.spacing.md, marginTop: -tokens.spacing.xs, borderRadius: tokens.radius.md, backgroundColor: '#101210', borderWidth: 1, borderColor: '#292E2B' },
  monthPanelHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthPanelTitle: { color: '#95A99A', fontSize: 9, fontWeight: '900', letterSpacing: 0.9 },
  monthLegend: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  monthLegendDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: tokens.colors.lime },
  monthLegendText: { color: tokens.colors.muted, fontSize: 10, fontWeight: '700' },
  monthWeekRow: { flexDirection: 'row' },
  monthWeekLabel: { flex: 1, color: tokens.colors.muted, textAlign: 'center', fontSize: 9, fontWeight: '900' },
  monthGrid: { gap: 5 },
  monthGridRow: { flexDirection: 'row', gap: 5 },
  monthBlank: { flex: 1, height: 32 },
  monthDay: { flex: 1, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#1B1E1C' },
  monthDayActive: { backgroundColor: tokens.colors.lime },
  monthDayText: { color: tokens.colors.muted, fontSize: 11, fontWeight: '900' },
  monthDayTextActive: { color: tokens.colors.canvas },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0, 0, 0, 0.68)' },
  planModal: { padding: tokens.spacing.lg, paddingBottom: tokens.spacing.xl, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: '#111412', borderWidth: 1, borderColor: '#36433A' },
  modalHandle: { alignSelf: 'center', width: 38, height: 4, marginBottom: tokens.spacing.lg, borderRadius: 2, backgroundColor: '#5B625D' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm },
  modalIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: tokens.colors.lime },
  modalHeaderCopy: { flex: 1, gap: 2 },
  modalKicker: { color: tokens.colors.lime, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  modalTitle: { color: tokens.colors.ink, fontSize: 20, fontWeight: '900' },
  closeButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#252A27' },
  closeText: { color: tokens.colors.muted, fontSize: 25, fontWeight: '400', lineHeight: 28 },
  modalIntro: { marginTop: tokens.spacing.md, color: tokens.colors.muted, fontSize: 12, lineHeight: 18 },
  modalProgress: { flexDirection: 'row', gap: 6, marginTop: tokens.spacing.md, marginBottom: tokens.spacing.lg },
  modalProgressStep: { flex: 1, height: 4, borderRadius: 2, backgroundColor: '#2B302D' },
  modalProgressStepActive: { backgroundColor: tokens.colors.lime },
  optionLabel: { marginTop: tokens.spacing.md, color: '#D9DEDA', fontSize: 12, fontWeight: '900' },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: tokens.spacing.sm },
  optionChip: { minHeight: 36, alignItems: 'center', justifyContent: 'center', paddingHorizontal: tokens.spacing.md, borderRadius: tokens.radius.pill, borderWidth: 1, borderColor: '#39423D', backgroundColor: '#1B201D' },
  optionChipActive: { borderColor: tokens.colors.lime, backgroundColor: '#173322' },
  optionChipText: { color: tokens.colors.muted, fontSize: 12, fontWeight: '800' },
  optionChipTextActive: { color: tokens.colors.lime },
  planSummary: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm, marginTop: tokens.spacing.lg, padding: tokens.spacing.md, borderRadius: tokens.radius.md, backgroundColor: '#17241B' },
  planSummaryCopy: { flex: 1, gap: 2 },
  planSummaryTitle: { color: tokens.colors.ink, fontSize: 13, fontWeight: '900' },
  planSummaryText: { color: '#D7E7DC', fontSize: 12, fontWeight: '800' },
  planError: { marginTop: tokens.spacing.md, color: tokens.colors.danger, fontSize: 12, lineHeight: 18 },
  modalActions: { flexDirection: 'row', gap: tokens.spacing.sm, marginTop: tokens.spacing.md },
  backPlanButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: tokens.spacing.md, borderRadius: tokens.radius.md, borderWidth: 1, borderColor: '#3C443F' },
  backPlanText: { color: tokens.colors.ink, fontSize: 13, fontWeight: '900' },
  createPlanButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: tokens.spacing.md, borderRadius: tokens.radius.md, backgroundColor: tokens.colors.lime },
  createPlanButtonDisabled: { opacity: 0.55 },
  createPlanText: { color: tokens.colors.canvas, fontSize: 14, fontWeight: '900' },
});
