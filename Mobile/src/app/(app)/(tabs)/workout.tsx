import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { FoundationCard } from '@/components/ui/foundation-card';
import { Screen } from '@/components/ui/screen';
import { ApiClientError, apiRequest } from '@/lib/api-client';
import { loadTodayWorkout, toWorkoutItem, type WorkoutItem } from '@/lib/fitness-read-model';
import { tokens } from '@/theme/tokens';

export default function WorkoutScreen() {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [items, setItems] = useState<WorkoutItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingSetKeys, setPendingSetKeys] = useState<Set<string>>(() => new Set());
  const pendingSetKeysRef = useRef<Set<string>>(new Set());

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

    // State updates are asynchronous. Update the ref first so repeated taps in
    // the same event loop cannot send duplicate non-idempotent POST requests.
    pendingSetKeysRef.current.add(setKey);
    setPendingSetKeys(new Set(pendingSetKeysRef.current));
    setError(null);
    try {
      const response = await apiRequest<{ exercise: unknown }>(`/api/workout/daily-exercises/${item.id}/complete-set`, {
        method: 'POST',
        body: { restSeconds: item.restSeconds ?? 0 },
        timeoutMs: 15_000,
      });
      const serverItem = toWorkoutItem(response.exercise);
      setItems((current) => current.map((currentItem) => currentItem.id === serverItem.id ? serverItem : currentItem));
    } catch (nextError) {
      if (!(nextError instanceof ApiClientError)) {
        setError('Kết nối bị gián đoạn. App đã tải lại trạng thái từ server và không gửi lại set.');
        await reconcileWorkout();
      } else {
        setError(nextError.message);
      }
    } finally {
      pendingSetKeysRef.current.delete(setKey);
      setPendingSetKeys(new Set(pendingSetKeysRef.current));
    }
  }, [reconcileWorkout]);

  return (
    <Screen>
      <Text style={styles.title}>Tập luyện</Text>
      <FoundationCard eyebrow="Hôm nay" title="Buổi tập của bạn" description="Lịch tập đọc qua Supabase RLS. Hoàn thành set đi qua Express, khóa set đang gửi và chỉ nhận trạng thái trả về từ server.">
        <Pressable style={styles.button} onPress={() => void load()} disabled={state === 'loading'}>
          {state === 'loading' ? <ActivityIndicator color={tokens.colors.canvas} /> : <Text style={styles.buttonText}>{state === 'idle' ? 'Tải buổi tập' : 'Làm mới'}</Text>}
        </Pressable>
      </FoundationCard>
      {state === 'error' ? <Text style={styles.error}>{error}</Text> : null}
      {state === 'ready' && items.length === 0 ? <FoundationCard title="Hôm nay chưa có lịch tập" description="Khi bạn tạo hoặc áp dụng kế hoạch tập trên web, lịch hôm nay sẽ xuất hiện tại đây." /> : null}
      {items.map((item, index) => (
        <FoundationCard key={item.id} eyebrow={`Bài ${index + 1}${item.isCompleted ? ' · đã xong' : ''}`} title={item.name} description={[item.bodyPart, item.targetMuscle].filter(Boolean).join(' · ') || 'Bài tập trong lịch hôm nay'}>
          <View style={styles.stats}>
            <Text style={styles.stat}>{item.completedSets}/{item.totalSets} sets</Text>
            <Text style={styles.stat}>{item.reps ?? '—'} reps</Text>
            <Text style={styles.stat}>{item.weightKg ?? '—'} kg</Text>
          </View>
          <View style={styles.setButtons}>
            {Array.from({ length: item.totalSets }, (_, index) => {
              const setNumber = index + 1;
              const setKey = `${item.id}:${setNumber}`;
              const completed = setNumber <= item.completedSets;
              const pending = pendingSetKeys.has(setKey);
              const canComplete = setNumber === item.completedSets + 1 && !pending;
              return (
                <Pressable key={setKey} style={[styles.setButton, completed && styles.setButtonDone, !canComplete && !completed && styles.setButtonDisabled]} disabled={!canComplete} onPress={() => void completeSet(item, setNumber)}>
                  {pending ? <ActivityIndicator color={tokens.colors.canvas} /> : <Text style={[styles.setButtonText, completed && styles.setButtonTextDone]}>Set {setNumber}{completed ? ' ✓' : ''}</Text>}
                </Pressable>
              );
            })}
          </View>
        </FoundationCard>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: tokens.colors.ink, fontSize: tokens.type.title, fontWeight: '900' },
  button: { alignSelf: 'flex-start', minWidth: 128, alignItems: 'center', paddingVertical: tokens.spacing.md, paddingHorizontal: tokens.spacing.lg, borderRadius: tokens.radius.pill, backgroundColor: tokens.colors.lime },
  buttonText: { color: tokens.colors.canvas, fontWeight: '900' },
  error: { color: tokens.colors.coral, lineHeight: 21 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, marginTop: tokens.spacing.xs },
  stat: { color: tokens.colors.lime, fontWeight: '800' },
  setButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, marginTop: tokens.spacing.md },
  setButton: { minWidth: 90, alignItems: 'center', paddingVertical: tokens.spacing.sm, paddingHorizontal: tokens.spacing.md, borderRadius: tokens.radius.pill, backgroundColor: tokens.colors.lime },
  setButtonDone: { backgroundColor: tokens.colors.surfaceRaised, borderWidth: 1, borderColor: tokens.colors.lime },
  setButtonDisabled: { opacity: 0.45 },
  setButtonText: { color: tokens.colors.canvas, fontWeight: '900' },
  setButtonTextDone: { color: tokens.colors.lime },
});
