import { useResource } from '@/hooks/use-resource';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';

import { AppIcon } from '@/components/ui/app-icon';
import { Screen } from '@/components/ui/screen';
import { ApiClientError, apiRequest } from '@/lib/api-client';
import { formatWorkoutExerciseMeta, loadTodayWorkout, toWorkoutItem } from '@/lib/fitness-read-model';
import { tokens } from '@/theme/tokens';

const toClock = (totalSeconds: number) => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

function ExerciseVideo({ source, title }: { source: string | null; title: string }) {
  const player = useVideoPlayer(source, (nextPlayer) => {
    nextPlayer.loop = true;
    nextPlayer.muted = true;
  });

  if (!source) {
    return (
      <View style={styles.videoPlaceholder}>
        <View style={styles.placeholderIcon}><AppIcon name="play" size={22} color={tokens.colors.lime} /></View>
        <Text style={styles.placeholderTitle}>Video hướng dẫn</Text>
        <Text style={styles.placeholderText}>Video cho bài tập này sẽ được cập nhật trong thư viện.</Text>
      </View>
    );
  }

  return (
    <View style={styles.videoShell}>
      <VideoView style={styles.video} player={player} nativeControls contentFit="cover" surfaceType="textureView" />
      <View pointerEvents="none" style={styles.videoTag}>
        <AppIcon name="play" size={13} color={tokens.colors.ink} strokeWidth={2.4} />
        <Text style={styles.videoTagText}>HƯỚNG DẪN</Text>
      </View>
      <Text accessibilityElementsHidden style={styles.hiddenVideoLabel}>{title}</Text>
    </View>
  );
}

export default function ActiveWorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const resource = useResource('workout', loadTodayWorkout);
  const { state, load } = resource;
  const item = resource.data?.find((value) => value.id === id);
  const [error, setError] = useState<string | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [restRemaining, setRestRemaining] = useState(0);
  const [restDeadline, setRestDeadline] = useState(0);
  const pendingRef = useRef(false);

  useEffect(() => {
    const update = () => {
      const remaining = Math.max(0, Math.ceil((restDeadline - Date.now()) / 1000));
      setRestRemaining(remaining);
      if (!remaining) setRestDeadline(0);
    };
    update();
    if (!restDeadline) return;
    const timer = setInterval(update, 1000);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') update(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [restDeadline]);

  const reconcile = useCallback(async () => {
    const result = await load();
    if (result.error) setError('Không thể tải lại trạng thái. Hãy kiểm tra kết nối rồi thử lại.');
  }, [load]);

  const completeNextSet = useCallback(async () => {
    if (!item || pendingRef.current || item.isCompleted || item.completedSets >= item.totalSets) return;
    pendingRef.current = true;
    setIsCompleting(true);
    setError(null);
    try {
      const response = await apiRequest<{ exercise: unknown }>(`/api/workout/daily-exercises/${item.id}/complete-set`, {
        method: 'POST', body: { restSeconds: item.restSeconds ?? 0 }, timeoutMs: 15_000,
      });
      const serverItem = toWorkoutItem(response.exercise);
      resource.setData((items) => items?.map((entry) => entry.id === serverItem.id ? serverItem : entry));
      setRestDeadline(serverItem.isCompleted ? 0 : Date.now() + Math.max(0, Number(serverItem.restSeconds ?? 0)) * 1000);
    } catch (cause) {
      if (cause instanceof ApiClientError) setError(cause.message);
      else {
        setError('Kết nối chưa chắc chắn. Fitly đang tải lại trạng thái từ server và không gửi lại set.');
        await reconcile();
      }
    } finally {
      pendingRef.current = false;
      setIsCompleting(false);
    }
  }, [item, reconcile, resource]);

  if (state === 'loading') {
    return <Screen scroll={false} contentStyle={styles.loadingScreen}><ActivityIndicator color={tokens.colors.lime} size="large" /></Screen>;
  }

  if (state === 'error' || !item) {
    return (
      <Screen contentStyle={styles.content}>
        <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>← Danh sách bài tập</Text></Pressable>
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Không thể mở phiên tập</Text>
          <Text style={styles.errorText}>{error ?? 'Hãy thử lại.'}</Text>
          <Pressable onPress={() => void load()} style={styles.retryButton}><Text style={styles.retryText}>Thử lại</Text></Pressable>
        </View>
      </Screen>
    );
  }

  const currentSet = Math.min(item.totalSets, item.completedSets + 1);
  const progress = item.totalSets > 0 ? (item.completedSets / item.totalSets) * 100 : 0;
  const exerciseMeta = formatWorkoutExerciseMeta(item.bodyPart, item.targetMuscle);

  return (
    <Screen contentStyle={styles.content}>
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={8}>
        <Text style={styles.backText}>← Danh sách bài tập</Text>
      </Pressable>

      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.kicker}>PHIÊN TẬP ĐANG DIỄN RA</Text>
          <Text style={styles.title}>{item.name}</Text>
          <Text style={styles.description}>{exerciseMeta}</Text>
        </View>
        <View style={styles.setCount}><Text style={styles.setCountText}>{currentSet}/{item.totalSets}</Text></View>
      </View>

      <ExerciseVideo source={item.videoUrl} title={item.name} />

      <View style={styles.progressBlock}>
        <View style={styles.progressHeading}>
          <Text style={styles.progressLabel}>TIẾN ĐỘ BUỔI TẬP</Text>
          <Text style={styles.progressValue}>{item.completedSets}/{item.totalSets} set</Text>
        </View>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
      </View>

      <View style={styles.metrics}>
        <Metric label="REPS" value={item.reps ?? '—'} />
        <Metric label="TẠ" value={item.weightKg != null ? `${item.weightKg} kg` : 'Tự do'} />
        <Metric label="NGHỈ" value={`${item.restSeconds ?? 0}s`} />
      </View>

      {restRemaining > 0 ? (
        <View style={styles.restCard}>
          <View style={styles.restIcon}><AppIcon name="zap" size={20} color={tokens.colors.lime} /></View>
          <View style={styles.restCopy}>
            <Text style={styles.restKicker}>THỜI GIAN NGHỈ</Text>
            <Text style={styles.restTime}>{toClock(restRemaining)}</Text>
          </View>
          <Pressable onPress={() => setRestDeadline(0)} style={styles.skipButton}><Text style={styles.skipText}>Bỏ qua</Text></Pressable>
        </View>
      ) : null}

      <View style={styles.actionCard}>
        <Text style={styles.actionKicker}>{item.isCompleted ? 'HOÀN THÀNH' : `SET TIẾP THEO · ${currentSet}/${item.totalSets}`}</Text>
        <Text style={styles.actionTitle}>{item.isCompleted ? 'Bạn đã hoàn thành bài này' : 'Sẵn sàng bắt đầu set?'}</Text>
        <Text style={styles.actionDescription}>{item.isCompleted ? 'Kết quả đã được lưu vào tiến độ hôm nay.' : 'Xem video để kiểm tra kỹ thuật trước khi xác nhận set.'}</Text>
        <Pressable
          disabled={item.isCompleted || isCompleting || restRemaining > 0}
          onPress={() => void completeNextSet()}
          style={[styles.completeButton, (item.isCompleted || isCompleting || restRemaining > 0) && styles.completeDisabled]}
        >
          {isCompleting ? <ActivityIndicator color={tokens.colors.canvas} /> : <Text style={styles.completeText}>{item.isCompleted ? 'Đã hoàn thành' : `Hoàn thành set ${currentSet}`}</Text>}
        </Pressable>
      </View>

      {error ? <Text style={styles.errorInline}>{error}</Text> : null}

      <View style={styles.setRow}>
        {Array.from({ length: item.totalSets }, (_, index) => {
          const done = index < item.completedSets;
          const active = !item.isCompleted && index === item.completedSets;
          return <View key={index} style={[styles.setPill, done && styles.setDone, active && styles.setActive]}><Text style={[styles.setPillText, done && styles.setDoneText]}>{done ? '✓' : index + 1}</Text></View>;
        })}
      </View>
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 36, gap: 18 },
  loadingScreen: { alignItems: 'center', justifyContent: 'center' },
  back: { alignSelf: 'flex-start', paddingVertical: 5 },
  backText: { color: tokens.colors.lime, fontSize: 14, fontWeight: '800' },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headingCopy: { flex: 1, minWidth: 0, paddingRight: 4 },
  kicker: { color: tokens.colors.lime, fontSize: 11, fontWeight: '900', letterSpacing: 1.25, marginBottom: 8 },
  title: { color: tokens.colors.ink, fontSize: 31, lineHeight: 37, fontWeight: '900' },
  description: { color: tokens.colors.muted, fontSize: 15, lineHeight: 22, marginTop: 8 },
  setCount: { flexShrink: 0, minWidth: 47, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 7, borderRadius: tokens.radius.md, borderWidth: 1, borderColor: '#476025', backgroundColor: '#0C170B', transform: [{ translateX: -30 }] },
  setCountText: { color: tokens.colors.lime, fontWeight: '900', fontSize: 13 },
  videoShell: { aspectRatio: 16 / 9, overflow: 'hidden', borderRadius: 22, borderWidth: 1, borderColor: tokens.colors.border, backgroundColor: tokens.colors.surfaceRaised },
  video: { flex: 1 },
  videoTag: { position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: tokens.radius.pill, backgroundColor: 'rgba(5, 5, 5, 0.76)' },
  videoTagText: { color: tokens.colors.ink, fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
  hiddenVideoLabel: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  videoPlaceholder: { minHeight: 190, alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 30, borderRadius: 22, borderWidth: 1, borderColor: tokens.colors.border, borderStyle: 'dashed', backgroundColor: tokens.colors.surface },
  placeholderIcon: { alignItems: 'center', justifyContent: 'center', width: 46, height: 46, borderRadius: 23, borderWidth: 1, borderColor: '#4E6829', backgroundColor: '#111A0D' },
  placeholderTitle: { color: tokens.colors.ink, fontSize: 16, fontWeight: '900', marginTop: 3 },
  placeholderText: { color: tokens.colors.muted, textAlign: 'center', fontSize: 13, lineHeight: 19 },
  progressBlock: { gap: 8 },
  progressHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressLabel: { color: tokens.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  progressValue: { color: tokens.colors.ink, fontSize: 13, fontWeight: '800' },
  progressTrack: { height: 7, overflow: 'hidden', borderRadius: tokens.radius.pill, backgroundColor: tokens.colors.surfaceRaised },
  progressFill: { height: '100%', minWidth: 0, borderRadius: tokens.radius.pill, backgroundColor: tokens.colors.lime },
  metrics: { flexDirection: 'row', gap: 8 },
  metric: { flex: 1, minHeight: 78, justifyContent: 'space-between', padding: 12, borderRadius: tokens.radius.md, backgroundColor: tokens.colors.surface },
  metricLabel: { color: tokens.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 0.75 },
  metricValue: { color: tokens.colors.ink, fontSize: 17, fontWeight: '900' },
  restCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: tokens.radius.md, borderWidth: 1, borderColor: '#45532F', backgroundColor: '#11160E' },
  restIcon: { alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 19, backgroundColor: '#1A2811' },
  restCopy: { flex: 1 },
  restKicker: { color: tokens.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 0.85 },
  restTime: { color: tokens.colors.ink, fontSize: 22, fontWeight: '900', marginTop: 2 },
  skipButton: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: tokens.radius.pill, borderWidth: 1, borderColor: tokens.colors.border },
  skipText: { color: tokens.colors.ink, fontSize: 12, fontWeight: '800' },
  actionCard: { gap: 9, padding: 18, borderRadius: 22, borderWidth: 1, borderColor: tokens.colors.border, backgroundColor: tokens.colors.surface },
  actionKicker: { color: tokens.colors.lime, fontSize: 11, fontWeight: '900', letterSpacing: 1.05 },
  actionTitle: { color: tokens.colors.ink, fontSize: 23, lineHeight: 28, fontWeight: '900' },
  actionDescription: { color: tokens.colors.muted, fontSize: 14, lineHeight: 20 },
  completeButton: { alignItems: 'center', justifyContent: 'center', minHeight: 56, marginTop: 7, borderRadius: tokens.radius.pill, backgroundColor: tokens.colors.lime },
  completeDisabled: { opacity: 0.48 },
  completeText: { color: tokens.colors.canvas, fontSize: 16, fontWeight: '900' },
  errorInline: { color: tokens.colors.coral, fontSize: 13, lineHeight: 19 },
  setRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, paddingTop: 2 },
  setPill: { alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: tokens.colors.border, backgroundColor: tokens.colors.surface },
  setActive: { borderColor: tokens.colors.lime, backgroundColor: '#17200D' },
  setDone: { borderColor: tokens.colors.lime, backgroundColor: tokens.colors.lime },
  setPillText: { color: tokens.colors.muted, fontSize: 14, fontWeight: '900' },
  setDoneText: { color: tokens.colors.canvas },
  errorCard: { gap: 12, marginTop: 18, padding: 20, borderRadius: 20, borderWidth: 1, borderColor: '#60352E', backgroundColor: '#1A1110' },
  errorTitle: { color: tokens.colors.ink, fontSize: 22, fontWeight: '900' },
  errorText: { color: tokens.colors.muted, lineHeight: 21 },
  retryButton: { alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 11, borderRadius: tokens.radius.pill, backgroundColor: tokens.colors.lime },
  retryText: { color: tokens.colors.canvas, fontWeight: '900' },
});
