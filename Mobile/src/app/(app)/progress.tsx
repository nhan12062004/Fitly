import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { FoundationCard } from '@/components/ui/foundation-card';
import { Screen } from '@/components/ui/screen';
import { supabase } from '@/lib/supabase';
import { tokens } from '@/theme/tokens';

type ProgressSnapshot = {
  currentWeight: number | null;
  targetWeight: number | null;
  bodyFat: number | null;
  completedWorkouts: number;
  completedSets: number;
  caloriesBurned: number;
  activeDays: number;
};

const dateKey = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (name: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === name)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
};

const daysAgo = (amount: number) => {
  const date = new Date();
  date.setDate(date.getDate() - amount);
  return dateKey(date);
};

export default function ProgressScreen() {
  const [snapshot, setSnapshot] = useState<ProgressSnapshot | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) throw new Error('Phiên đăng nhập đã hết hạn.');
      const userId = authData.user.id;
      const startDate = daysAgo(6);
      const [bodyResult, workoutsResult, dailyResult] = await Promise.all([
        supabase.from('body_metrics').select('weight, target_weight, body_fat, body_fat_percentage, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('daily_exercise_sessions').select('log_date, is_completed, sets, actual_sets, completed_sets').eq('user_id', userId).gte('log_date', startDate).lte('log_date', dateKey(new Date())),
        supabase.from('daily_progress_logs').select('log_date, calories_burned').eq('user_id', userId).gte('log_date', startDate).lte('log_date', dateKey(new Date())),
      ]);
      const firstError = [bodyResult.error, workoutsResult.error, dailyResult.error].find(Boolean);
      if (firstError) throw firstError;
      const workouts = workoutsResult.data ?? [];
      const activeDays = new Set(workouts.filter((item) => Number(item.completed_sets ?? 0) > 0 || item.is_completed).map((item) => item.log_date)).size;
      setSnapshot({
        currentWeight: bodyResult.data?.weight ?? null,
        targetWeight: bodyResult.data?.target_weight ?? null,
        bodyFat: bodyResult.data?.body_fat_percentage ?? bodyResult.data?.body_fat ?? null,
        completedWorkouts: workouts.filter((item) => Boolean(item.is_completed)).length,
        completedSets: workouts.reduce((total, item) => total + Math.max(0, Number(item.completed_sets ?? 0)), 0),
        caloriesBurned: (dailyResult.data ?? []).reduce((total, item) => total + Math.max(0, Number(item.calories_burned ?? 0)), 0),
        activeDays,
      });
      setState('ready');
    } catch (cause) {
      setState('error');
      setError(cause instanceof Error ? cause.message : 'Không thể tải tiến độ.');
    }
  }, []);

  useEffect(() => {
    const task = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(task);
  }, [load]);

  return (
    <Screen>
      <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>← Hồ sơ</Text></Pressable>
      <Text style={styles.kicker}>7 NGÀY GẦN NHẤT</Text>
      <Text style={styles.title}>Tiến độ của bạn</Text>
      {state === 'loading' ? <View style={styles.center}><ActivityIndicator color={tokens.colors.lime} size="large" /></View> : null}
      {state === 'error' ? <FoundationCard title="Chưa thể tải tiến độ" description={error ?? 'Kiểm tra lại kết nối.'}><Pressable onPress={() => void load()}><Text style={styles.retry}>Thử lại</Text></Pressable></FoundationCard> : null}
      {state === 'ready' && snapshot ? <>
        <View style={styles.grid}>
          <Metric label="Cân nặng" value={snapshot.currentWeight ? `${snapshot.currentWeight} kg` : '—'} detail={snapshot.targetWeight ? `Mục tiêu ${snapshot.targetWeight} kg` : 'Chưa đặt mục tiêu'} />
          <Metric label="Body fat" value={snapshot.bodyFat != null ? `${snapshot.bodyFat}%` : '—'} detail="Chỉ số mới nhất" />
          <Metric label="Ngày hoạt động" value={`${snapshot.activeDays}/7`} detail="Có ít nhất một set" />
          <Metric label="Calo tiêu hao" value={`${Math.round(snapshot.caloriesBurned)}`} detail="7 ngày gần nhất" />
        </View>
        <FoundationCard eyebrow="Tập luyện" title={`${snapshot.completedSets} set đã hoàn thành`} description={`${snapshot.completedWorkouts} bài tập được hoàn tất trong 7 ngày gần đây.`} />
        {snapshot.activeDays === 0 ? <FoundationCard title="Bắt đầu chuỗi mới" description="Khi bạn hoàn thành set đầu tiên, Fitly sẽ ghi nhận tiến độ theo ngày tại đây." /> : null}
      </> : null}
    </Screen>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricDetail}>{detail}</Text></View>;
}

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start', paddingVertical: tokens.spacing.sm },
  backText: { color: tokens.colors.lime, fontWeight: '800' },
  kicker: { color: tokens.colors.lime, fontSize: tokens.type.overline, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: tokens.colors.ink, fontSize: tokens.type.title, fontWeight: '900' },
  center: { minHeight: 320, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
  metric: { width: '48%', flexGrow: 1, gap: 3, padding: tokens.spacing.md, borderRadius: tokens.radius.md, backgroundColor: tokens.colors.surface },
  metricLabel: { color: tokens.colors.muted, fontSize: tokens.type.overline, fontWeight: '800' },
  metricValue: { color: tokens.colors.ink, fontSize: 24, fontWeight: '900' },
  metricDetail: { color: tokens.colors.muted, fontSize: 12 },
  retry: { color: tokens.colors.lime, fontWeight: '900', marginTop: tokens.spacing.sm },
});
