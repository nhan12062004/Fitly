import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { AppIcon } from '@/components/ui/app-icon';
import { Screen } from '@/components/ui/screen';
import { getVietnamDayIndex, getVietnamWeekStartKey, loadTodayMeals, type MealItem } from '@/lib/fitness-read-model';
import { tokens } from '@/theme/tokens';

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const MACRO_TONES = {
  calories: { color: '#FF8A00', backgroundColor: '#21160C' },
  protein: { color: '#B780FF', backgroundColor: '#1B1421' },
  fat: { color: '#FF7185', backgroundColor: '#211216' },
  carbs: { color: '#FFD52E', backgroundColor: '#211D0C' },
} as const;

const getWeekDates = () => {
  const weekStart = new Date(`${getVietnamWeekStartKey()}T00:00:00`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return date;
  });
};

const formatRange = (dates: Date[]) => {
  const first = dates[0];
  const last = dates[dates.length - 1];
  return `${first.getDate()}/${first.getMonth() + 1} – ${last.getDate()}/${last.getMonth() + 1}/${last.getFullYear()}`;
};

type MacroCardProps = {
  label: string;
  value: string;
  detail: string;
  color: string;
  backgroundColor: string;
};

function MacroCard({ label, value, detail, color, backgroundColor }: MacroCardProps) {
  return (
    <View style={[styles.macroCard, { borderColor: color, backgroundColor }]}>
      <View style={styles.macroTopLine}>
        <Text style={[styles.macroLabel, { color }]}>{label}</Text>
        <Text style={[styles.macroPercent, { color }]}>0%</Text>
      </View>
      <Text style={styles.macroValue}>{value}</Text>
      <Text style={styles.macroDetail}>{detail}</Text>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { backgroundColor: color }]} /></View>
    </View>
  );
}

export default function MealsScreen() {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [items, setItems] = useState<MealItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const weekDates = useMemo(() => getWeekDates(), []);
  const selectedDay = getVietnamDayIndex();

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      setItems(await loadTodayMeals());
      setState('ready');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Không thể tải thực đơn.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    const task = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(task);
  }, [load]);

  const totals = useMemo(() => items.reduce((sum, item) => ({
    calories: sum.calories + Number(item.calories ?? 0),
    protein: sum.protein + Number(item.protein ?? 0),
    fat: sum.fat + Number(item.fat ?? 0),
    carbs: sum.carbs + Number(item.carbs ?? 0),
  }), { calories: 0, protein: 0, fat: 0, carbs: 0 }), [items]);

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.weekCard}>
        <View style={styles.weekHeader}>
          <View style={styles.weekTitleWrap}>
            <View style={styles.calendarIcon}><AppIcon name="calendar" color={tokens.colors.lime} size={18} /></View>
            <Text style={styles.weekTitle}>Lịch thực đơn tuần</Text>
          </View>
          <View style={styles.rangeWrap}>
            <Text style={styles.chevron}>‹</Text>
            <Text style={styles.range}>{formatRange(weekDates)}</Text>
            <Text style={styles.chevron}>›</Text>
          </View>
        </View>

        <View style={styles.daysRow}>
          {weekDates.map((date, index) => {
            const isSelected = index === selectedDay;
            return <View key={date.toISOString()} style={[styles.dayCard, isSelected && styles.dayCardSelected]}>
              {isSelected ? <View style={styles.activeDot} /> : null}
              <Text style={[styles.dayLabel, isSelected && styles.dayTextSelected]}>{WEEKDAY_LABELS[index]}</Text>
              <Text style={[styles.dayNumber, isSelected && styles.dayTextSelected]}>{date.getDate()}</Text>
            </View>;
          })}
        </View>

        <View style={styles.macroGrid}>
          <MacroCard label="CALORIES" value={`${Math.round(totals.calories)} / 0`} detail={`Đã nạp ${Math.round(totals.calories)} kcal`} {...MACRO_TONES.calories} />
          <MacroCard label="PROTEIN" value={`${Math.round(totals.protein)} / 0g`} detail={`Đã nạp ${Math.round(totals.protein)}g`} {...MACRO_TONES.protein} />
          <MacroCard label="FAT" value={`${Math.round(totals.fat)} / 0g`} detail={`Đã nạp ${Math.round(totals.fat)}g`} {...MACRO_TONES.fat} />
          <MacroCard label="CARBS" value={`${Math.round(totals.carbs)} / 0g`} detail={`Đã nạp ${Math.round(totals.carbs)}g`} {...MACRO_TONES.carbs} />
        </View>
      </View>

      <View style={styles.scheduleCard}>
        <View style={styles.scheduleTitleRow}>
          <AppIcon name="meals" color={tokens.colors.muted} size={18} />
          <Text style={styles.scheduleTitle}>LỊCH ĂN HÔM NAY</Text>
        </View>

        {state === 'loading' ? <View style={styles.loadingState}><ActivityIndicator color={tokens.colors.lime} /></View> : null}
        {state === 'error' ? <View style={styles.emptyState}><Text style={styles.error}>{error}</Text><Pressable onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Thử lại</Text></Pressable></View> : null}
        {state === 'ready' && items.length === 0 ? <View style={styles.emptyState}>
          <View style={styles.emptyIcon}><AppIcon name="meals" color={tokens.colors.lime} size={34} /></View>
          <Text style={styles.emptyTitle}>Chưa có thực đơn cho ngày này</Text>
          <Text style={styles.emptyCopy}>Tạo thực đơn AI hoặc tự chọn món để bắt đầu theo dõi macro trong ngày.</Text>
          <View style={styles.actions}>
            <Pressable onPress={() => router.push('/coach')} style={styles.primaryButton}><AppIcon name="coach" color={tokens.colors.canvas} size={17} /><Text style={styles.primaryButtonText}>Tạo thực đơn AI</Text></Pressable>
            <Pressable onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Làm mới</Text></Pressable>
          </View>
        </View> : null}
        {state === 'ready' && items.length > 0 ? <View style={styles.mealList}>
          {items.map((item) => <Pressable key={item.id} disabled={!item.recipeId} onPress={() => item.recipeId && router.push({ pathname: '/recipe/[id]', params: { id: item.recipeId } })} style={({ pressed }) => [styles.mealRow, item.recipeId && pressed && styles.pressed]}>
            <View style={styles.mealRowIcon}><AppIcon name="meals" color={tokens.colors.lime} size={19} /></View>
            <View style={styles.mealCopy}><Text style={styles.mealType}>{item.mealType ?? 'Bữa ăn'}</Text><Text style={styles.mealName}>{item.name}</Text><Text style={styles.mealMeta}>{Math.round(item.calories ?? 0)} kcal · P {Math.round(item.protein ?? 0)}g · C {Math.round(item.carbs ?? 0)}g</Text></View>
            {item.recipeId ? <AppIcon name="arrow-right" color={tokens.colors.muted} size={18} /> : null}
          </Pressable>)}
        </View> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: tokens.spacing.md, paddingBottom: tokens.spacing.hero },
  weekCard: { gap: tokens.spacing.md, padding: tokens.spacing.md, borderRadius: tokens.radius.md, backgroundColor: tokens.colors.surface, borderWidth: 1, borderColor: tokens.colors.border },
  weekHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.spacing.sm },
  weekTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm, flex: 1 },
  calendarIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: tokens.radius.sm, backgroundColor: '#102015', borderWidth: 1, borderColor: '#245737' },
  weekTitle: { color: tokens.colors.ink, fontSize: 14, fontWeight: '900' },
  rangeWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  range: { color: tokens.colors.ink, fontSize: 12, fontWeight: '800' },
  chevron: { color: tokens.colors.muted, fontSize: 25, lineHeight: 25 },
  daysRow: { flexDirection: 'row', gap: 5 },
  dayCard: { flex: 1, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: tokens.radius.sm, backgroundColor: '#0D1117', borderWidth: 1, borderColor: '#283341' },
  dayCardSelected: { backgroundColor: '#0B2515', borderColor: '#19D66B', borderWidth: 2 },
  activeDot: { position: 'absolute', top: 6, right: 6, width: 5, height: 5, borderRadius: 3, backgroundColor: '#22DC6D' },
  dayLabel: { color: '#A9C8F7', fontSize: 10, fontWeight: '800' },
  dayNumber: { color: '#B6D0FF', fontSize: 15, fontWeight: '900' },
  dayTextSelected: { color: '#39E77E' },
  macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
  macroCard: { width: '47%', minHeight: 112, padding: tokens.spacing.md, gap: tokens.spacing.xs, borderRadius: tokens.radius.sm, borderWidth: 1 },
  macroTopLine: { flexDirection: 'row', justifyContent: 'space-between', gap: tokens.spacing.xs },
  macroLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
  macroPercent: { fontSize: 10, fontWeight: '900' },
  macroValue: { color: tokens.colors.ink, fontSize: 16, fontWeight: '900', marginTop: tokens.spacing.xs },
  macroDetail: { color: tokens.colors.muted, fontSize: 11, fontWeight: '600' },
  progressTrack: { height: 4, marginTop: 'auto', borderRadius: 999, backgroundColor: '#151515', overflow: 'hidden' },
  progressFill: { width: '0%', height: '100%' },
  scheduleCard: { gap: tokens.spacing.md, padding: tokens.spacing.md, borderRadius: tokens.radius.md, backgroundColor: tokens.colors.surface, borderWidth: 1, borderColor: tokens.colors.border },
  scheduleTitleRow: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm },
  scheduleTitle: { color: tokens.colors.ink, fontSize: 13, fontWeight: '900', letterSpacing: 0.6 },
  loadingState: { minHeight: 220, alignItems: 'center', justifyContent: 'center', borderRadius: tokens.radius.md, backgroundColor: tokens.colors.canvas, borderWidth: 1, borderColor: tokens.colors.border },
  emptyState: { minHeight: 236, alignItems: 'center', justifyContent: 'center', gap: tokens.spacing.sm, padding: tokens.spacing.xl, borderRadius: tokens.radius.md, backgroundColor: tokens.colors.canvas, borderWidth: 1, borderColor: tokens.colors.border },
  emptyIcon: { marginBottom: tokens.spacing.xs },
  emptyTitle: { color: tokens.colors.ink, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  emptyCopy: { color: tokens.colors.muted, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: tokens.spacing.sm, marginTop: tokens.spacing.sm },
  primaryButton: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 42, paddingHorizontal: tokens.spacing.md, borderRadius: tokens.radius.sm, backgroundColor: tokens.colors.lime },
  primaryButtonText: { color: tokens.colors.canvas, fontSize: 13, fontWeight: '900' },
  secondaryButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: tokens.spacing.md, borderRadius: tokens.radius.sm, borderWidth: 1, borderColor: tokens.colors.border },
  secondaryButtonText: { color: tokens.colors.ink, fontSize: 13, fontWeight: '800' },
  error: { color: tokens.colors.coral, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  mealList: { gap: tokens.spacing.sm },
  mealRow: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.sm, padding: tokens.spacing.md, borderRadius: tokens.radius.sm, backgroundColor: tokens.colors.canvas, borderWidth: 1, borderColor: tokens.colors.border },
  mealRowIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: '#102015' },
  mealCopy: { flex: 1, gap: 2 },
  mealType: { color: tokens.colors.lime, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  mealName: { color: tokens.colors.ink, fontSize: 15, fontWeight: '800' },
  mealMeta: { color: tokens.colors.muted, fontSize: 11 },
  pressed: { opacity: 0.78 },
});
