import { getSessionUser } from '@/lib/account-read-model';
import { useResource } from '@/hooks/use-resource';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { AppIcon } from '@/components/ui/app-icon';
import { FoundationCard } from '@/components/ui/foundation-card';
import { Screen } from '@/components/ui/screen';
import { supabase } from '@/lib/supabase';
import { tokens } from '@/theme/tokens';

type Period = 7 | 30 | 90;

type WorkoutRow = {
  log_date: string;
  is_completed: boolean | null;
  sets: number | null;
  actual_sets: number | null;
  completed_sets: number | null;
  actual_kcal_estimated: number | null;
  estimated_kcal: number | null;
};

type MealRow = { log_date: string; is_completed: boolean | null };

async function fetchAllRows<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<{ data: T[]; error: unknown }> {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const result = await fetchPage(from, from + pageSize - 1);
    if (result.error) return { data: rows, error: result.error };
    const page = result.data || [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}

type DayRhythm = {
  date: string;
  active: boolean;
  completedExercises: number;
  completedSets: number;
  caloriesBurned: number;
  waterMl: number;
  sleepHours: number;
  mealCount: number;
  waterHit: boolean;
  waterLogged: boolean;
  sleepHit: boolean;
  sleepLogged: boolean;
  mealLogged: boolean;
};

type ProgressSnapshot = {
  currentWeight: number | null;
  weightChange: number | null;
  targetWeight: number | null;
  bodyFat: number | null;
  waist: number | null;
  bodyDate: string | null;
  completedSets: number;
  caloriesBurned: number;
  activeDays: number;
  waterGoalMl: number | null;
  sleepGoalHours: number | null;
  waterHitDays: number;
  sleepHitDays: number;
  mealLoggedDays: number;
  completedExercises: number;
  hasAnyActivity: boolean;
  rhythm: DayRhythm[];
};

const dateKey = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (name: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === name)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
};

const addDays = (key: string, amount: number) => {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return date.toISOString().slice(0, 10);
};

const weekLabel = (value: string) => {
  const day = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat('vi-VN', { weekday: 'short' }).format(day).replace('.', '').replace('Th ', 'T');
};

const number = (value: unknown) => Math.max(0, Number(value ?? 0));
const formatNumber = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
const shortDate = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}`;

export default function ProgressScreen() {
  const [period, setPeriod] = useState<Period>(7);
  const [selectedDayDate, setSelectedDayDate] = useState<string | null>(null);
  const resource = useResource('progress', async (): Promise<ProgressSnapshot> => {
      const selectedPeriod = period;
      const { data: authData } = await getSessionUser();
      if (!authData.user) throw new Error('Phiên đăng nhập đã hết hạn.');
      const userId = authData.user.id;
      const today = dateKey(new Date());
      const startDate = addDays(today, 1 - selectedPeriod);
      const [bodyResult, workoutsResult, dailyResult, mealsResult, lifestyleResult, healthResult] = await Promise.all([
        supabase.from('body_metrics').select('weight, target_weight, body_fat, body_fat_percentage, waist, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(120),
        fetchAllRows<WorkoutRow>((from, to) => supabase.from('daily_exercise_sessions').select('log_date, is_completed, sets, actual_sets, completed_sets, actual_kcal_estimated, estimated_kcal').eq('user_id', userId).gte('log_date', startDate).lte('log_date', today).order('log_date', { ascending: true }).order('id', { ascending: true }).range(from, to)),
        supabase.from('daily_progress_logs').select('log_date, calories_burned, water_intake_ml, sleep_hours').eq('user_id', userId).gte('log_date', startDate).lte('log_date', today),
        fetchAllRows<MealRow>((from, to) => supabase.from('daily_meal_logs').select('log_date, is_completed').eq('user_id', userId).gte('log_date', startDate).lte('log_date', today).order('log_date', { ascending: true }).order('id', { ascending: true }).range(from, to)),
        supabase.from('lifestyle_settings').select('daily_water_goal').eq('user_id', userId).maybeSingle(),
        supabase.from('health_conditions').select('sleep_hours').eq('user_id', userId).maybeSingle(),
      ]);
      const firstError = [bodyResult.error, workoutsResult.error, dailyResult.error, mealsResult.error, lifestyleResult.error, healthResult.error].find(Boolean);
      if (firstError) throw firstError;

      const workouts = workoutsResult.data ?? [];
      const daily = dailyResult.data ?? [];
      const body = bodyResult.data?.find((row) => row.weight != null);
      const latestTarget = bodyResult.data?.find((row) => row.target_weight != null);
      const latestBodyFat = bodyResult.data?.find((row) => row.body_fat_percentage != null || row.body_fat != null);
      const latestWaist = bodyResult.data?.find((row) => row.waist != null);
      const periodWeights = (bodyResult.data ?? [])
        .filter((row) => row.created_at && dateKey(new Date(row.created_at)) >= startDate && dateKey(new Date(row.created_at)) <= today)
        .map((row) => number(row.weight))
        .filter((value) => value > 0);
      const weightChange = periodWeights.length > 1 ? Number((periodWeights[0] - periodWeights.at(-1)!).toFixed(1)) : null;
      const workoutsByDate = new Map<string, { exercises: number; sets: number; active: boolean; calories: number }>();
      workouts.forEach((item) => {
        const previous = workoutsByDate.get(item.log_date) ?? { exercises: 0, sets: 0, active: false, calories: 0 };
        const sets = number(item.completed_sets) > 0 ? number(item.completed_sets) : item.is_completed ? number(item.actual_sets ?? item.sets) : 0;
        const actualCalories = number(item.actual_kcal_estimated);
        workoutsByDate.set(item.log_date, {
          exercises: previous.exercises + (item.is_completed ? 1 : 0),
          sets: previous.sets + sets,
          active: previous.active || Boolean(item.is_completed) || sets > 0,
          calories: previous.calories + (actualCalories > 0 ? actualCalories : item.is_completed ? number(item.estimated_kcal) : 0),
        });
      });
      const completedDates = new Set([...workoutsByDate.entries()].filter(([, value]) => value.active).map(([date]) => date));
      const dailyByDate = new Map(daily.map((item) => [item.log_date, item]));
      const mealCounts = new Map<string, number>();
      (mealsResult.data ?? []).forEach((item) => { if (item.is_completed) mealCounts.set(item.log_date, (mealCounts.get(item.log_date) ?? 0) + 1); });
      const storedWaterGoal = number(lifestyleResult.data?.daily_water_goal);
      const waterGoalMl = storedWaterGoal > 0 ? storedWaterGoal <= 20 ? storedWaterGoal * 1000 : storedWaterGoal : null;
      const sleepGoalHours = number(healthResult.data?.sleep_hours) || null;
      const rhythm: DayRhythm[] = Array.from({ length: selectedPeriod }, (_, index) => {
        const date = addDays(today, index - selectedPeriod + 1);
        const log = dailyByDate.get(date);
        const workout = workoutsByDate.get(date);
        const waterMl = number(log?.water_intake_ml);
        const sleepHours = number(log?.sleep_hours);
        const loggedCalories = number(log?.calories_burned);
        return {
          date,
          active: completedDates.has(date),
          completedExercises: workout?.exercises ?? 0,
          completedSets: workout?.sets ?? 0,
          caloriesBurned: loggedCalories > 0 ? loggedCalories : workout?.calories ?? 0,
          waterMl,
          sleepHours,
          mealCount: mealCounts.get(date) ?? 0,
          waterHit: waterGoalMl ? waterMl >= waterGoalMl : waterMl > 0,
          waterLogged: waterMl > 0,
          sleepHit: sleepGoalHours ? sleepHours >= sleepGoalHours : sleepHours > 0,
          sleepLogged: sleepHours > 0,
          mealLogged: (mealCounts.get(date) ?? 0) > 0,
        };
      });
      const caloriesBurned = rhythm.reduce((total, day) => total + day.caloriesBurned, 0);

      return {
        currentWeight: body?.weight ?? null,
        weightChange,
        targetWeight: latestTarget?.target_weight ?? null,
        bodyFat: latestBodyFat?.body_fat_percentage ?? latestBodyFat?.body_fat ?? null,
        waist: latestWaist?.waist ?? null,
        bodyDate: bodyResult.data?.[0]?.created_at ?? null,
        completedExercises: workouts.filter((item) => Boolean(item.is_completed)).length,
        hasAnyActivity: rhythm.some((day) => day.active || day.waterLogged || day.sleepLogged || day.mealLogged || day.caloriesBurned > 0),
        completedSets: rhythm.reduce((total, day) => total + day.completedSets, 0),
        caloriesBurned,
        activeDays: completedDates.size,
        waterGoalMl,
        sleepGoalHours,
        waterHitDays: rhythm.filter((item) => item.waterHit).length,
        sleepHitDays: rhythm.filter((item) => item.sleepHit).length,
        mealLoggedDays: rhythm.filter((item) => item.mealLogged).length,
        rhythm,
      };
  }, [period], 0);
  const { data: snapshot, state, errorMessage: error, refreshing, refresh } = resource;

  const latestWeek = useMemo(() => snapshot?.rhythm.slice(-7) ?? [], [snapshot]);
  const hasBodyData = snapshot && (snapshot.currentWeight != null || snapshot.targetWeight != null || snapshot.bodyFat != null || snapshot.waist != null);
  const selectedDay = latestWeek.find((day) => day.date === selectedDayDate) ?? latestWeek.at(-1);
  const weeklyTrend = useMemo(() => snapshot ? Array.from({ length: Math.ceil(snapshot.rhythm.length / 7) }, (_, index) => {
    const days = snapshot.rhythm.slice(index * 7, index * 7 + 7);
    return { label: shortDate(days[0].date), active: days.filter((day) => day.active).length, meals: days.filter((day) => day.mealLogged).length, total: days.length };
  }) : [], [snapshot]);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh} contentStyle={styles.content}>
      <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button">
        <AppIcon name="arrow-left" size={18} color={tokens.colors.lime} />
        <Text style={styles.backText}>Hồ sơ</Text>
      </Pressable>

      <View style={styles.heading}>
        <Text style={styles.kicker}>NHỊP CƠ THỂ</Text>
        <Text style={styles.title}>Tiến độ của{`\n`}bạn.</Text>
        <Text style={styles.subtitle}>Hoạt động thực tế trong {period} ngày gần nhất, cập nhật khi bạn ghi nhận.</Text>
      </View>

      <View style={styles.periods}>
        {([7, 30, 90] as Period[]).map((item) => (
          <Pressable key={item} onPress={() => { setSelectedDayDate(null); setPeriod(item); }} style={[styles.period, period === item && styles.periodActive]} accessibilityRole="button" accessibilityState={{ selected: period === item }}>
            <Text style={[styles.periodText, period === item && styles.periodTextActive]}>{item} ngày</Text>
          </Pressable>
        ))}
      </View>

      {state === 'loading' && !snapshot ? <View style={styles.center}><ActivityIndicator color={tokens.colors.lime} size="large" /></View> : null}
      {state === 'error' ? <FoundationCard title="Chưa thể tải tiến độ" description={error ?? 'Kiểm tra lại kết nối.'}><Pressable onPress={() => void resource.load()} accessibilityRole="button"><Text style={styles.retry}>Thử lại</Text></Pressable></FoundationCard> : null}

      {snapshot ? <>
        {!snapshot.hasAnyActivity ? <View style={styles.emptyState}>
          <View style={styles.emptyMark}><AppIcon name="target" size={25} color={tokens.colors.lime} /></View>
          <Text style={styles.emptyTitle}>Bắt đầu ghi nhận tiến độ</Text>
          <Text style={styles.emptyDescription}>Chưa có hoạt động trong {period} ngày gần nhất. Hoàn thành bài tập, ghi bữa ăn, nước hoặc giấc ngủ để thấy thay đổi của bạn.</Text>
          <Pressable onPress={() => router.push('/workout')} style={styles.primaryAction} accessibilityRole="button"><Text style={styles.primaryActionText}>Mở lịch tập →</Text></Pressable>
          <Pressable onPress={() => router.push('/tracking')} style={styles.secondaryAction} accessibilityRole="button"><Text style={styles.secondaryActionText}>Ghi nước hoặc giấc ngủ →</Text></Pressable>
          <Pressable onPress={() => router.push('/profile/edit')} style={styles.secondaryAction} accessibilityRole="button"><Text style={styles.secondaryActionText}>Cập nhật chỉ số cơ thể →</Text></Pressable>
        </View> : <>
        <View style={styles.rhythmCard}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionEyebrow}>7 NGÀY GẦN NHẤT</Text>
              <Text style={styles.sectionTitle}>Nhịp ghi nhận</Text>
            </View>
            <View style={styles.activeBadge}><View style={styles.dot} /><Text style={styles.activeBadgeText}>{snapshot.activeDays}/{period} ngày tập</Text></View>
          </View>
          <View style={styles.bars}>
            {latestWeek.map((day) => <Pressable key={day.date} onPress={() => setSelectedDayDate(day.date)} style={[styles.barItem, selectedDay?.date === day.date && styles.barItemSelected]} accessibilityRole="button" accessibilityState={{ selected: selectedDay?.date === day.date }} accessibilityLabel={`${weekLabel(day.date)} ${shortDate(day.date)}, ${day.completedExercises} bài tập, ${day.mealCount} bữa ăn, ${formatNumber(day.waterMl)} ml nước`}>
              <View style={[styles.barTrack, day.active && styles.barTrackActive]}>
                {day.waterLogged ? <View style={[styles.waterMarker, !day.waterHit && styles.markerPartial]} /> : null}
                {day.sleepLogged ? <View style={[styles.sleepMarker, !day.sleepHit && styles.markerPartial]} /> : null}
                {day.mealLogged ? <View style={styles.mealMarker} /> : null}
              </View>
              <Text style={[styles.dayLabel, day.date === dateKey(new Date()) && styles.dayLabelToday]}>{weekLabel(day.date)}</Text>
            </Pressable>)}
          </View>
          {selectedDay ? <View style={styles.dayDetail}>
            <Text style={styles.dayDetailTitle}>{weekLabel(selectedDay.date)} · {shortDate(selectedDay.date)}</Text>
            <Text style={styles.dayDetailText}>{selectedDay.completedExercises} bài tập · {selectedDay.completedSets} hiệp · {formatNumber(selectedDay.caloriesBurned)} kcal tiêu hao</Text>
            <Text style={styles.dayDetailText}>{selectedDay.mealCount} bữa ăn · {formatNumber(selectedDay.waterMl)} ml nước · {formatNumber(selectedDay.sleepHours)} giờ ngủ</Text>
          </View> : null}
          <View style={styles.legend}>
            <Legend color={tokens.colors.lime} label="Tập luyện" />
            <Legend color="#4AC7FF" label="Nước đã ghi" />
            <Legend color="#B28CFF" label="Ngủ đã ghi" />
            <Legend color="#FFB86C" label="Đã ăn" />
          </View>
          {(snapshot.waterGoalMl || snapshot.sleepGoalHours) ? <Text style={styles.legendNote}>Chấm mờ: đã ghi nhưng chưa đạt mục tiêu.</Text> : null}
        </View>

        {period > 7 ? <View style={styles.trendCard}>
          <Text style={styles.sectionEyebrow}>TOÀN KỲ {period} NGÀY</Text>
          <Text style={styles.sectionTitle}>Xu hướng theo tuần</Text>
          <Text style={styles.trendCaption}>Mỗi cột bắt đầu từ ngày bên dưới và gộp tối đa 7 ngày.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trendScroll}>
            {weeklyTrend.map((week) => <View key={week.label} style={styles.trendItem} accessible accessibilityLabel={`Từ ${week.label}: ${week.active} ngày tập, ${week.meals} ngày ghi bữa ăn`}>
              <View style={styles.trendBars}><View style={[styles.trendBar, styles.trendWorkout, { height: Math.max(week.active ? 5 : 0, week.active / week.total * 82) }]} /><View style={[styles.trendBar, styles.trendMeal, { height: Math.max(week.meals ? 5 : 0, week.meals / week.total * 82) }]} /></View>
              <Text style={styles.trendLabel}>{week.label}</Text>
              <Text style={styles.trendCount}>{week.active}/{week.total}</Text>
            </View>)}
          </ScrollView>
          <View style={styles.legend}><Legend color={tokens.colors.lime} label="Ngày tập" /><Legend color="#FFB86C" label="Ngày ghi bữa ăn" /></View>
        </View> : null}

        <View style={styles.wellnessRow}>
          <Pressable onPress={() => router.push('/tracking')} style={[styles.wellnessCard, styles.waterCard]} accessibilityRole="button" accessibilityLabel={`${snapshot.waterHitDays}/${period} ngày ghi hoặc đạt mục tiêu nước. Mở màn theo dõi nước.`}>
            <View style={styles.wellnessIcon}><Text style={styles.waterGlyph}>⌁</Text></View>
            <Text style={styles.wellnessCaption}>NƯỚC</Text>
            <Text style={styles.wellnessValue}>{snapshot.waterHitDays}<Text style={styles.wellnessUnit}>/{period}</Text></Text>
            <Text style={styles.wellnessDetail}>{snapshot.waterGoalMl ? `ngày đạt ${Math.round(snapshot.waterGoalMl / 100) / 10} L` : 'ngày ghi nước · chưa đặt mục tiêu'}</Text>
            <Text style={styles.wellnessLink}>Ghi nước →</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/tracking')} style={[styles.wellnessCard, styles.sleepCard]} accessibilityRole="button" accessibilityLabel={`${snapshot.sleepHitDays}/${period} đêm ghi hoặc đạt mục tiêu ngủ. Mở màn theo dõi giấc ngủ.`}>
            <View style={styles.wellnessIcon}><Text style={styles.sleepGlyph}>☾</Text></View>
            <Text style={styles.wellnessCaption}>GIẤC NGỦ</Text>
            <Text style={styles.wellnessValue}>{snapshot.sleepHitDays}<Text style={styles.wellnessUnit}>/{period}</Text></Text>
            <Text style={styles.wellnessDetail}>{snapshot.sleepGoalHours ? `đêm từ ${snapshot.sleepGoalHours} giờ` : 'ngày ghi ngủ · chưa đặt mục tiêu'}</Text>
            <Text style={styles.wellnessLink}>Ghi giấc ngủ →</Text>
          </Pressable>
        </View>
        </>}

        {(snapshot.hasAnyActivity || hasBodyData) ? <View style={styles.bodyCard}>
          <View style={styles.bodyTop}>
            <View>
              <Text style={styles.sectionEyebrow}>CƠ THỂ</Text>
              <Text style={styles.sectionTitle}>Dấu mốc gần nhất</Text>
            </View>
            <Pressable onPress={() => router.push('/profile/edit')} hitSlop={8} accessibilityRole="button"><Text style={styles.updateLink}>Cập nhật</Text></Pressable>
          </View>
          <View style={styles.weightLine}>
            <Text style={styles.weightValue}>{snapshot.currentWeight != null ? `${formatNumber(snapshot.currentWeight)} kg` : '—'}</Text>
            <Text style={styles.targetWeight}>{snapshot.targetWeight != null ? `Mục tiêu ${formatNumber(snapshot.targetWeight)} kg` : 'Chưa đặt mục tiêu'}</Text>
          </View>
          {snapshot.currentWeight != null ? <Text style={styles.bodyChange}>{snapshot.weightChange != null ? `${snapshot.weightChange > 0 ? '+' : ''}${formatNumber(snapshot.weightChange)} kg so với lần cân đầu trong ${period} ngày` : `Cần hai lần cân trong ${period} ngày để thấy thay đổi`}</Text> : null}
          <View style={styles.bodyFacts}>
            <Text style={styles.bodyFact}>Mỡ cơ thể  <Text style={styles.bodyFactValue}>{snapshot.bodyFat != null ? `${formatNumber(snapshot.bodyFat)}%` : '—'}</Text></Text>
            <View style={styles.factDivider} />
            <Text style={styles.bodyFact}>Vòng eo  <Text style={styles.bodyFactValue}>{snapshot.waist != null ? `${formatNumber(snapshot.waist)} cm` : '—'}</Text></Text>
          </View>
          <Text style={styles.bodyDate}>{snapshot.bodyDate ? `Lần ghi hồ sơ gần nhất: ${shortDate(dateKey(new Date(snapshot.bodyDate)))}` : 'Chưa có số đo cơ thể'}</Text>
        </View> : null}

        {snapshot.hasAnyActivity ? <>
        <View style={styles.achievementCard}>
          <View style={styles.achievementTitle}><AppIcon name="flame" size={19} color={tokens.colors.lime} /><Text style={styles.achievementTitleText}>THÀNH TÍCH KỲ NÀY</Text></View>
          <View style={styles.achievementStats}>
            <Achievement value={formatNumber(snapshot.completedSets)} label="hiệp đã tập" />
            <Achievement value={formatNumber(snapshot.completedExercises)} label="bài hoàn tất" />
            <Achievement value={formatNumber(Math.round(snapshot.caloriesBurned))} label="kcal tiêu hao" />
          </View>
        </View>

        <View style={styles.emptyHint}>
          <Text style={styles.emptyHintTitle}>Nhật ký dinh dưỡng</Text>
          <Text style={styles.emptyHintBody}>{snapshot.mealLoggedDays}/{period} ngày có bữa ăn đã ghi nhận.</Text>
          <Pressable onPress={() => router.push('/meals')} accessibilityRole="button"><Text style={styles.retry}>Mở nhật ký bữa ăn →</Text></Pressable>
        </View>

        </> : null}
      </> : null}
    </Screen>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: color }]} /><Text style={styles.legendText}>{label}</Text></View>;
}

function Achievement({ value, label }: { value: string; label: string }) {
  return <View style={styles.achievement}><Text style={styles.achievementValue}>{value}</Text><Text style={styles.achievementLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  content: { paddingBottom: tokens.spacing.hero, gap: 18 },
  back: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -2 },
  backText: { color: tokens.colors.lime, fontSize: 14, fontWeight: '800' },
  heading: { gap: 7 },
  kicker: { color: tokens.colors.lime, fontSize: tokens.type.overline, fontWeight: '900', letterSpacing: 1.4 },
  title: { color: tokens.colors.ink, fontSize: 36, lineHeight: 40, letterSpacing: -1.1, fontWeight: '900' },
  subtitle: { color: tokens.colors.muted, fontSize: 15, lineHeight: 22, maxWidth: 310 },
  periods: { flexDirection: 'row', alignSelf: 'flex-start', padding: 4, gap: 4, backgroundColor: '#121412', borderRadius: tokens.radius.pill },
  period: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: tokens.radius.pill },
  periodActive: { backgroundColor: tokens.colors.lime },
  periodText: { color: tokens.colors.muted, fontSize: 13, fontWeight: '800' },
  periodTextActive: { color: '#0A0D0A' },
  center: { minHeight: 340, alignItems: 'center', justifyContent: 'center' },
  retry: { color: tokens.colors.lime, fontWeight: '900', marginTop: tokens.spacing.sm },
  emptyState: { padding: 22, borderRadius: 26, borderWidth: 1, borderColor: '#304327', backgroundColor: '#111A10', gap: 12 },
  emptyMark: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#263A1B' },
  emptyTitle: { color: tokens.colors.ink, fontSize: 22, lineHeight: 27, fontWeight: '900' },
  emptyDescription: { color: tokens.colors.muted, fontSize: 14, lineHeight: 21 },
  primaryAction: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: tokens.colors.lime, marginTop: 5 },
  primaryActionText: { color: tokens.colors.canvas, fontSize: 14, fontWeight: '900' },
  secondaryAction: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 15, borderWidth: 1, borderColor: '#385031' },
  secondaryActionText: { color: tokens.colors.lime, fontSize: 13, fontWeight: '800' },
  rhythmCard: { backgroundColor: '#111611', borderRadius: 26, padding: 18, gap: 18, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  sectionEyebrow: { color: '#9FAAA0', fontSize: 11, fontWeight: '900', letterSpacing: .8 },
  sectionTitle: { color: tokens.colors.ink, marginTop: 4, fontSize: 20, fontWeight: '900', letterSpacing: -.3 },
  activeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 9, backgroundColor: '#1C311D', borderRadius: tokens.radius.pill },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: tokens.colors.lime },
  activeBadgeText: { color: '#C7E8C9', fontSize: 11, fontWeight: '800' },
  bars: { height: 124, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 5 },
  barItem: { flex: 1, alignItems: 'center', gap: 8, padding: 3, borderRadius: 13 },
  barItemSelected: { backgroundColor: '#263620' },
  barTrack: { width: '100%', minWidth: 22, height: 62, borderRadius: 11, backgroundColor: '#212621', overflow: 'hidden', justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 7, gap: 3 },
  barTrackActive: { height: 88, backgroundColor: tokens.colors.lime },
  waterMarker: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4AC7FF' },
  sleepMarker: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#B28CFF' },
  markerPartial: { opacity: .4 },
  mealMarker: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFB86C' },
  dayLabel: { color: '#7E8680', fontSize: 11, fontWeight: '800' },
  dayLabelToday: { color: tokens.colors.lime },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { color: '#A7AEA8', fontSize: 11, fontWeight: '700' },
  legendNote: { color: '#89978A', fontSize: 11, lineHeight: 16 },
  dayDetail: { gap: 5, borderWidth: 1, borderColor: '#344035', borderRadius: 15, padding: 12, backgroundColor: '#1B231B' },
  dayDetailTitle: { color: tokens.colors.ink, fontSize: 13, fontWeight: '900' },
  dayDetailText: { color: '#B9C2B9', fontSize: 12, lineHeight: 18, fontWeight: '700' },
  trendCard: { padding: 18, borderRadius: 24, backgroundColor: '#131713', gap: 10 },
  trendCaption: { color: tokens.colors.muted, fontSize: 12, lineHeight: 18 },
  trendScroll: { gap: 9, alignItems: 'flex-end', paddingTop: 4, paddingBottom: 4 },
  trendItem: { width: 48, alignItems: 'center', gap: 4 },
  trendBars: { height: 86, width: 44, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 4, paddingBottom: 2, borderRadius: 8, backgroundColor: '#202720' },
  trendBar: { width: 12, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  trendWorkout: { backgroundColor: tokens.colors.lime },
  trendMeal: { backgroundColor: '#FFB86C' },
  trendLabel: { color: '#A7AEA8', fontSize: 10, fontWeight: '800' },
  trendCount: { color: tokens.colors.ink, fontSize: 10, fontWeight: '900' },
  wellnessRow: { flexDirection: 'row', gap: 12 },
  wellnessCard: { flex: 1, minHeight: 180, borderRadius: 24, padding: 16, justifyContent: 'flex-end' },
  waterCard: { backgroundColor: '#0C2029' },
  sleepCard: { backgroundColor: '#1D1530' },
  wellnessIcon: { position: 'absolute', top: 16, right: 16, width: 35, height: 35, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  waterGlyph: { color: '#4AC7FF', fontSize: 26, lineHeight: 29, fontWeight: '700' },
  sleepGlyph: { color: '#C2A5FF', fontSize: 24, lineHeight: 28 },
  wellnessCaption: { color: '#A3B6BB', fontSize: 11, fontWeight: '900', letterSpacing: .7 },
  wellnessValue: { color: tokens.colors.white, fontSize: 34, lineHeight: 38, fontWeight: '900', marginTop: 5 },
  wellnessUnit: { color: '#91A3A8', fontSize: 16 },
  wellnessDetail: { color: '#B2BDC1', fontSize: 12, lineHeight: 17, marginTop: 5 },
  wellnessLink: { color: tokens.colors.white, fontSize: 12, fontWeight: '900', marginTop: 12 },
  bodyCard: { backgroundColor: '#171917', borderRadius: 24, padding: 18, gap: 16 },
  bodyTop: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  updateLink: { color: tokens.colors.lime, fontSize: 13, fontWeight: '900', paddingTop: 6 },
  weightLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  weightValue: { color: tokens.colors.white, fontSize: 32, fontWeight: '900', letterSpacing: -.7 },
  targetWeight: { color: tokens.colors.muted, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  bodyChange: { color: '#C2D4BD', fontSize: 12, fontWeight: '800' },
  bodyFacts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 9, paddingTop: 13, borderTopWidth: 1, borderTopColor: '#2E332E' },
  bodyFact: { color: '#9AA39B', fontSize: 12, fontWeight: '700' },
  bodyFactValue: { color: tokens.colors.ink, fontWeight: '900' },
  bodyDate: { color: '#858F86', fontSize: 11, fontWeight: '700' },
  factDivider: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#687068' },
  achievementCard: { padding: 18, borderRadius: 24, backgroundColor: '#121312', gap: 17 },
  achievementTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  achievementTitleText: { color: '#D5E9B9', fontSize: 12, fontWeight: '900', letterSpacing: .9 },
  achievementStats: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  achievement: { flex: 1, gap: 4 },
  achievementValue: { color: tokens.colors.white, fontSize: 22, lineHeight: 26, fontWeight: '900' },
  achievementLabel: { color: tokens.colors.muted, fontSize: 11, lineHeight: 15, fontWeight: '700' },
  emptyHint: { padding: 16, borderRadius: tokens.radius.md, backgroundColor: '#101110', gap: 5 },
  emptyHintTitle: { color: tokens.colors.ink, fontSize: 15, fontWeight: '900' },
  emptyHintBody: { color: tokens.colors.muted, fontSize: 13, lineHeight: 19 },
});
