import { useResource } from '@/hooks/use-resource';
import { useTodayKey } from '@/providers/data-provider';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { AppIcon } from '@/components/ui/app-icon';
import { Screen } from '@/components/ui/screen';
import { apiRequest } from '@/lib/api-client';
import { getVietnamDayIndex, getVietnamWeekStartKey, loadProfileSnapshot, loadTodayMeals, saveGeneratedMealPlan, type GeneratedMealPlanItem } from '@/lib/fitness-read-model';
import { tokens } from '@/theme/tokens';

const weekdayLabels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const weekdayNames = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const mealTones = [
  { surface: '#202718', accent: '#B9FF3A' },
  { surface: '#252117', accent: '#F6C445' },
  { surface: '#28201F', accent: '#FF9A82' },
  { surface: '#201D2A', accent: '#C596FF' },
] as const;

type GenerateMealPlanResponse = { data?: { mealItems?: GeneratedMealPlanItem[] } };

const getWeekDates = () => {
  const weekStart = new Date(`${getVietnamWeekStartKey()}T00:00:00`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return date;
  });
};

function MacroPill({ label, value, color }: { label: string; value: number; color: string }) {
  return <View style={styles.macroPill}><View style={[styles.macroDot, { backgroundColor: color }]} /><Text style={styles.macroLabel}>{label}</Text><Text style={styles.macroValue}>{Math.round(value)}g</Text></View>;
}

export default function MealsScreen() {
  const todayKey = useTodayKey();
  const resource = useResource('meals', loadTodayMeals);
  const profile = useResource('profile', loadProfileSnapshot);
  const { state, refreshing, refresh, load, errorMessage: error } = resource;
  const items = useMemo(() => resource.data ?? [], [resource.data]);
  const targetCalories = profile.data?.targetCalories ?? null;
  const [isMealPlanModalVisible, setIsMealPlanModalVisible] = useState(false);
  const [isGeneratingMealPlan, setIsGeneratingMealPlan] = useState(false);
  const [mealPlanError, setMealPlanError] = useState<string | null>(null);
  const [mealPlanScope, setMealPlanScope] = useState<'day' | 'week'>('day');
  const weekDates = getWeekDates();
  const today = new Date(`${todayKey}T12:00:00`);
  const activeDay = getVietnamDayIndex();

  const totals = useMemo(() => items.reduce((sum, item) => ({
    calories: sum.calories + Number(item.calories ?? 0),
    protein: sum.protein + Number(item.protein ?? 0),
    carbs: sum.carbs + Number(item.carbs ?? 0),
    fat: sum.fat + Number(item.fat ?? 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 }), [items]);

  const target = Math.round(targetCalories ?? 0);
  const calories = Math.round(totals.calories);
  const remaining = target ? Math.max(target - calories, 0) : 0;
  const percent = target ? Math.min(100, Math.round((calories / target) * 100)) : 0;
  const openCoach = () => router.push('/coach');

  const openMealPlanModal = () => {
    setMealPlanError(null);
    setMealPlanScope('day');
    setIsMealPlanModalVisible(true);
  };

  const closeMealPlanModal = () => {
    if (isGeneratingMealPlan) return;
    setIsMealPlanModalVisible(false);
    setMealPlanError(null);
  };

  const createMealPlan = async () => {
    if (isGeneratingMealPlan) return;
    setIsGeneratingMealPlan(true);
    setMealPlanError(null);
    try {
      const weekStartKey = getVietnamWeekStartKey();
      const response = await apiRequest<GenerateMealPlanResponse>('/api/ai-coach/generate-meal-plan', {
        method: 'POST',
        body: { scope: mealPlanScope, weekStartDate: weekStartKey, dayIndex: activeDay },
        timeoutMs: 45_000,
      });
      await saveGeneratedMealPlan({
        weekStartKey,
        scope: mealPlanScope,
        targetDayIndex: activeDay,
        items: Array.isArray(response.data?.mealItems) ? response.data.mealItems : [],
      });
      setIsMealPlanModalVisible(false);
      await load();
    } catch (cause) {
      setMealPlanError(cause instanceof Error ? cause.message : 'Không thể tạo thực đơn lúc này. Vui lòng thử lại.');
    } finally {
      setIsGeneratingMealPlan(false);
    }
  };

  return (
    <Screen contentStyle={styles.content} refreshing={refreshing} onRefresh={refresh}>
      <View style={styles.header}>
        <View><Text style={styles.date}>{weekdayNames[today.getDay()]}, {today.getDate()} tháng {today.getMonth() + 1}</Text><Text style={styles.title}>Ăn cho khỏe.</Text></View>
      </View>

      <View style={styles.weekStrip}>{weekDates.map((date, index) => {
        const active = index === activeDay;
        return <View key={date.toISOString()} style={[styles.dayChip, active && styles.dayChipActive]}><Text style={[styles.dayLabel, active && styles.dayLabelActive]}>{weekdayLabels[index]}</Text><Text style={[styles.dayNumber, active && styles.dayNumberActive]}>{date.getDate()}</Text></View>;
      })}</View>

      <View style={styles.calorieHero}>
        <View style={styles.calorieShade} /><View style={styles.calorieBubble}><Text style={styles.bubbleValue}>{percent}%</Text><Text style={styles.bubbleCaption}>MỤC TIÊU</Text></View>
        <Text style={styles.calorieKicker}>NĂNG LƯỢNG CỦA BẠN</Text>
        <Text style={styles.calorieValue}>{calories}<Text style={styles.calorieUnit}> kcal</Text></Text>
        <Text style={styles.calorieText}>{target ? `${remaining} kcal còn lại trong ngày` : 'Đặt calorie mục tiêu trong Hồ sơ để theo dõi.'}</Text>
        <View style={styles.calorieFoot}><Text style={styles.calorieFootText}>{target ? `Mục tiêu ${target} kcal` : 'Chưa có mục tiêu'}</Text><AppIcon name="flame" color="#D9FF89" size={17} /></View>
      </View>

      <View style={styles.macroHeader}><View><Text style={styles.microKicker}>CÂN BẰNG</Text><Text style={styles.macroTitle}>Macro hôm nay</Text></View><Text style={styles.macroHint}>Theo món đã ghi</Text></View>
      <View style={styles.macroRow}><MacroPill label="Protein" value={totals.protein} color="#B9FF3A" /><MacroPill label="Carbs" value={totals.carbs} color="#F6C445" /><MacroPill label="Fat" value={totals.fat} color="#FF9A82" /></View>

      <View style={styles.mealHeader}><View><Text style={styles.microKicker}>NHẬT KÝ HÔM NAY</Text><Text style={styles.mealTitle}>Bạn đã ăn gì?</Text></View><View style={styles.mealCount}><Text style={styles.mealCountText}>{items.length} món</Text></View></View>
      {state === 'loading' && !refreshing ? <View style={styles.loading}><ActivityIndicator color={tokens.colors.lime} /></View> : null}
      {state === 'error' ? <Pressable onPress={() => void load()} style={styles.errorCard}><Text style={styles.errorText}>{error}</Text><Text style={styles.retryText}>Chạm để thử lại</Text></Pressable> : null}
      {state === 'ready' && items.length === 0 ? <View style={styles.emptyCard}><View style={styles.emptyIcon}><AppIcon name="meals" color={tokens.colors.lime} size={29} /></View><Text style={styles.emptyTitle}>Bữa ăn đang trống</Text><Text style={styles.emptyText}>Để AI Coach gợi ý một thực đơn phù hợp với mục tiêu của bạn.</Text><Pressable onPress={openMealPlanModal} style={styles.emptyAction}><Text style={styles.emptyActionText}>Tạo thực đơn AI</Text><AppIcon name="arrow-right" color={tokens.colors.canvas} size={17} /></Pressable></View> : null}
      {state === 'ready' && items.length > 0 ? <View style={styles.mealList}>{items.map((item, index) => {
        const tone = mealTones[index % mealTones.length];
        return <Pressable key={item.id} disabled={!item.recipeId} onPress={() => item.recipeId && router.push({ pathname: '/recipe/[id]', params: { id: item.recipeId } })} style={({ pressed }) => [styles.mealCard, { backgroundColor: tone.surface }, item.recipeId && pressed && styles.pressed]}>
          <View style={[styles.mealMarker, { backgroundColor: tone.accent }]}><AppIcon name="meals" color={tokens.colors.canvas} size={17} /></View>
          <View style={styles.mealCopy}><View style={styles.mealTop}><Text style={[styles.mealType, { color: tone.accent }]}>{item.mealType ?? 'Bữa ăn'}</Text><Text style={styles.mealCalories}>{Math.round(item.calories ?? 0)} kcal</Text></View><Text numberOfLines={1} style={styles.mealName}>{item.name}</Text><Text style={styles.mealMeta}>P {Math.round(item.protein ?? 0)}g · C {Math.round(item.carbs ?? 0)}g · F {Math.round(item.fat ?? 0)}g</Text></View>{item.recipeId ? <AppIcon name="arrow-right" color={tone.accent} size={17} /> : null}
        </Pressable>;
      })}</View> : null}

      <Pressable onPress={openCoach} style={({ pressed }) => [styles.coachPrompt, pressed && styles.pressed]}><View style={styles.coachPromptIcon}><AppIcon name="coach" color="#D7A4FF" size={22} /></View><View style={styles.coachPromptCopy}><Text style={styles.coachPromptTitle}>Cần đổi món?</Text><Text style={styles.coachPromptText}>Hỏi AI Coach một gợi ý khác ngay.</Text></View><AppIcon name="arrow-right" color="#D7A4FF" size={18} /></Pressable>

      <Modal visible={isMealPlanModalVisible} transparent animationType="slide" onRequestClose={closeMealPlanModal}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeMealPlanModal} />
          <View style={styles.mealPlanModal}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View style={styles.modalIcon}><AppIcon name="meals" color={tokens.colors.canvas} size={21} /></View>
              <View style={styles.modalHeaderCopy}><Text style={styles.modalKicker}>THIẾT LẬP THỰC ĐƠN</Text><Text style={styles.modalTitle}>Bạn muốn AI chuẩn bị gì?</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Đóng" onPress={closeMealPlanModal} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable>
            </View>

            <Text style={styles.modalIntro}>Fitly sẽ dùng mục tiêu calorie, chế độ ăn và các hạn chế đã lưu trong Hồ sơ của bạn.</Text>
            <Text style={styles.optionLabel}>PHẠM VI THỰC ĐƠN</Text>
            <View style={styles.scopeRow}>
              <Pressable disabled={isGeneratingMealPlan} onPress={() => setMealPlanScope('day')} style={[styles.scopeOption, mealPlanScope === 'day' && styles.scopeOptionActive]}><Text style={[styles.scopeValue, mealPlanScope === 'day' && styles.scopeValueActive]}>Hôm nay</Text><Text style={[styles.scopeHint, mealPlanScope === 'day' && styles.scopeHintActive]}>Tạo món cho ngày hiện tại</Text></Pressable>
              <Pressable disabled={isGeneratingMealPlan} onPress={() => setMealPlanScope('week')} style={[styles.scopeOption, mealPlanScope === 'week' && styles.scopeOptionActive]}><Text style={[styles.scopeValue, mealPlanScope === 'week' && styles.scopeValueActive]}>Cả tuần</Text><Text style={[styles.scopeHint, mealPlanScope === 'week' && styles.scopeHintActive]}>Chuẩn bị đủ 7 ngày</Text></Pressable>
            </View>

            <View style={styles.planPreview}>
              <View style={styles.previewIcon}><AppIcon name="flame" color="#F6C445" size={20} /></View>
              <View style={styles.previewCopy}><Text style={styles.previewKicker}>KẾ HOẠCH SẼ TẠO</Text><Text style={styles.previewTitle}>{mealPlanScope === 'day' ? 'Thực đơn cho hôm nay' : 'Thực đơn trọn tuần'}</Text><Text style={styles.previewMeta}>{target ? `${target} kcal/ngày` : 'Calorie theo hồ sơ'} · Cá nhân hóa bằng AI</Text></View>
            </View>

            {mealPlanError ? <Text style={styles.planError}>{mealPlanError}</Text> : null}
            <Pressable disabled={isGeneratingMealPlan} onPress={() => void createMealPlan()} style={[styles.createPlanButton, isGeneratingMealPlan && styles.createPlanButtonDisabled]}>{isGeneratingMealPlan ? <ActivityIndicator color={tokens.colors.canvas} /> : <><Text style={styles.createPlanText}>Tạo thực đơn {mealPlanScope === 'day' ? 'hôm nay' : '7 ngày'}</Text><AppIcon name="arrow-right" color={tokens.colors.canvas} size={18} /></>}</Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: tokens.spacing.lg, paddingTop: tokens.spacing.md, paddingBottom: 112, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  date: { color: '#9AA49D', fontSize: 12, fontWeight: '700' },
  title: { marginTop: 2, color: tokens.colors.ink, fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
  weekStrip: { flexDirection: 'row', justifyContent: 'space-between', gap: 5 },
  dayChip: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 7, borderRadius: 13, backgroundColor: '#161A17' },
  dayChipActive: { backgroundColor: tokens.colors.lime },
  dayLabel: { color: '#8C978F', fontSize: 9, fontWeight: '900' },
  dayLabelActive: { color: '#42600C' },
  dayNumber: { color: '#D3D9D4', fontSize: 14, fontWeight: '900' },
  dayNumberActive: { color: tokens.colors.canvas },
  calorieHero: { position: 'relative', overflow: 'hidden', padding: tokens.spacing.md, borderRadius: 26, backgroundColor: '#B9FF3A' },
  calorieShade: { position: 'absolute', width: 190, height: 190, right: -83, top: -80, borderRadius: 95, backgroundColor: '#DFFF9A' },
  calorieBubble: { position: 'absolute', right: 18, top: 18, width: 71, height: 71, alignItems: 'center', justifyContent: 'center', borderRadius: 36, backgroundColor: tokens.colors.canvas },
  bubbleValue: { color: tokens.colors.lime, fontSize: 18, fontWeight: '900' },
  bubbleCaption: { color: '#A8B2A8', fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  calorieKicker: { color: '#476313', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  calorieValue: { marginTop: 6, color: tokens.colors.canvas, fontSize: 38, lineHeight: 43, fontWeight: '900', letterSpacing: -1 },
  calorieUnit: { fontSize: 15, letterSpacing: 0 },
  calorieText: { marginTop: 2, color: '#405B0B', fontSize: 12, fontWeight: '700' },
  calorieFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: tokens.spacing.md, padding: 9, borderRadius: 13, backgroundColor: '#93C52F' },
  calorieFootText: { color: tokens.colors.canvas, fontSize: 11, fontWeight: '900' },
  macroHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  microKicker: { color: '#94A299', fontSize: 9, fontWeight: '900', letterSpacing: 1.05 },
  macroTitle: { marginTop: 2, color: tokens.colors.ink, fontSize: 21, fontWeight: '900' },
  macroHint: { color: tokens.colors.muted, fontSize: 10, fontWeight: '700' },
  macroRow: { flexDirection: 'row', gap: 7 },
  macroPill: { flex: 1, alignItems: 'flex-start', gap: 3, padding: 9, borderRadius: 14, backgroundColor: '#171B18' },
  macroDot: { width: 7, height: 7, borderRadius: 4 },
  macroLabel: { color: '#AAB3AC', fontSize: 10, fontWeight: '800' },
  macroValue: { color: tokens.colors.ink, fontSize: 16, fontWeight: '900' },
  mealHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: tokens.spacing.sm },
  mealTitle: { marginTop: 2, color: tokens.colors.ink, fontSize: 24, fontWeight: '900' },
  mealCount: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: tokens.radius.pill, backgroundColor: '#20271D' },
  mealCountText: { color: tokens.colors.lime, fontSize: 10, fontWeight: '900' },
  loading: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  errorCard: { gap: 6, padding: tokens.spacing.lg, borderRadius: tokens.radius.lg, backgroundColor: '#32201D' },
  errorText: { color: tokens.colors.coral, fontSize: 13, lineHeight: 19 },
  retryText: { color: '#FFB4A8', fontSize: 12, fontWeight: '900' },
  emptyCard: { alignItems: 'center', gap: 10, padding: tokens.spacing.xl, borderRadius: 26, backgroundColor: '#151A16' },
  emptyIcon: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 29, backgroundColor: '#20321E' },
  emptyTitle: { color: tokens.colors.ink, fontSize: 20, fontWeight: '900' },
  emptyText: { color: tokens.colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  emptyAction: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 43, marginTop: 5, paddingHorizontal: tokens.spacing.md, borderRadius: tokens.radius.pill, backgroundColor: tokens.colors.lime },
  emptyActionText: { color: tokens.colors.canvas, fontSize: 13, fontWeight: '900' },
  mealList: { gap: 9 },
  mealCard: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm, minHeight: 82, padding: tokens.spacing.md, borderRadius: 20 },
  mealMarker: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  mealCopy: { flex: 1, gap: 3 },
  mealTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 7 },
  mealType: { fontSize: 9, fontWeight: '900', letterSpacing: 0.7, textTransform: 'uppercase' },
  mealCalories: { color: '#BAC1BA', fontSize: 10, fontWeight: '800' },
  mealName: { color: tokens.colors.ink, fontSize: 15, fontWeight: '900' },
  mealMeta: { color: '#AEB6B0', fontSize: 10 },
  coachPrompt: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm, padding: tokens.spacing.md, borderRadius: 20, backgroundColor: '#211929' },
  coachPromptIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#2D2339' },
  coachPromptCopy: { flex: 1, gap: 2 },
  coachPromptTitle: { color: tokens.colors.ink, fontSize: 14, fontWeight: '900' },
  coachPromptText: { color: '#BBB0C5', fontSize: 11 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.7)' },
  mealPlanModal: { paddingHorizontal: tokens.spacing.lg, paddingTop: 10, paddingBottom: 32, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: '#131813' },
  modalHandle: { alignSelf: 'center', width: 42, height: 4, marginBottom: tokens.spacing.md, borderRadius: 2, backgroundColor: '#566158' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm },
  modalIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: tokens.colors.lime },
  modalHeaderCopy: { flex: 1, gap: 2 },
  modalKicker: { color: tokens.colors.lime, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  modalTitle: { color: tokens.colors.ink, fontSize: 19, fontWeight: '900' },
  closeButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: '#202621' },
  closeText: { marginTop: -2, color: tokens.colors.muted, fontSize: 25, lineHeight: 27 },
  modalIntro: { marginTop: tokens.spacing.md, color: '#AAB5AC', fontSize: 12, lineHeight: 18 },
  optionLabel: { marginTop: tokens.spacing.lg, marginBottom: 8, color: '#87938B', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  scopeRow: { flexDirection: 'row', gap: 9 },
  scopeOption: { flex: 1, minHeight: 82, justifyContent: 'center', gap: 5, padding: tokens.spacing.md, borderRadius: 18, backgroundColor: '#202520' },
  scopeOptionActive: { backgroundColor: tokens.colors.lime },
  scopeValue: { color: tokens.colors.ink, fontSize: 15, fontWeight: '900' },
  scopeValueActive: { color: tokens.colors.canvas },
  scopeHint: { color: '#98A39B', fontSize: 10, lineHeight: 14 },
  scopeHintActive: { color: '#425B13', fontWeight: '700' },
  planPreview: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm, marginTop: tokens.spacing.md, padding: tokens.spacing.md, borderRadius: 18, backgroundColor: '#292419' },
  previewIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#3D321A' },
  previewCopy: { flex: 1, gap: 2 },
  previewKicker: { color: '#F6C445', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  previewTitle: { color: tokens.colors.ink, fontSize: 14, fontWeight: '900' },
  previewMeta: { color: '#B8AF9A', fontSize: 10 },
  planError: { marginTop: tokens.spacing.md, color: tokens.colors.coral, fontSize: 11, lineHeight: 17 },
  createPlanButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, marginTop: tokens.spacing.lg, paddingHorizontal: tokens.spacing.md, borderRadius: 17, backgroundColor: tokens.colors.lime },
  createPlanButtonDisabled: { opacity: 0.55 },
  createPlanText: { color: tokens.colors.canvas, fontSize: 14, fontWeight: '900' },
  pressed: { opacity: 0.72 },
});
