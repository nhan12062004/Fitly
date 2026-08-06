import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';

import { AppIcon } from '@/components/ui/app-icon';
import { Screen } from '@/components/ui/screen';
import { formatWorkoutDetailLabel, formatWorkoutExerciseMeta, loadTodayWorkout, type WorkoutItem } from '@/lib/fitness-read-model';
import { tokens } from '@/theme/tokens';

function ExerciseVideo({ source }: { source: string | null }) {
  const player = useVideoPlayer(source, (nextPlayer) => {
    nextPlayer.loop = true;
  });

  if (!source) {
    return <View style={styles.videoFallback}><View style={styles.videoFallbackIcon}><AppIcon name="play" color={tokens.colors.lime} size={22} /></View><Text style={styles.videoFallbackTitle}>Video đang được cập nhật</Text><Text style={styles.videoFallbackText}>Bạn vẫn có thể xem thông số và bắt đầu bài tập khi sẵn sàng.</Text></View>;
  }

  return <View style={styles.videoShell}><VideoView style={styles.video} player={player} nativeControls contentFit="cover" surfaceType="textureView" /><View pointerEvents="none" style={styles.videoLabel}><AppIcon name="play" color={tokens.colors.ink} size={12} /><Text style={styles.videoLabelText}>XEM HƯỚNG DẪN</Text></View></View>;
}

const extractInstructions = (value: unknown) => {
  if (typeof value === 'string') return value.split(/\r?\n+/).map((line) => line.trim()).filter(Boolean);
  if (!value || typeof value !== 'object') return [];

  const instructions = value as { preparation?: unknown; steps?: unknown; tips?: unknown };
  return [instructions.preparation, instructions.steps, instructions.tips].flatMap((group) => Array.isArray(group) ? group.map((item) => String(item).trim()).filter(Boolean) : []);
};

function DetailItem({ label, value }: { label: string; value: string }) {
  return <View style={styles.detailItem}><Text style={styles.detailLabel}>{label}</Text><Text numberOfLines={2} style={styles.detailValue}>{value}</Text></View>;
}

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<WorkoutItem | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const nextItem = (await loadTodayWorkout()).find((value) => value.id === id);
      if (!nextItem) throw new Error('Bài tập này không còn trong lịch hôm nay.');
      setItem(nextItem);
      setState('ready');
    } catch (cause) {
      setState('error');
      setError(cause instanceof Error ? cause.message : 'Không thể tải chi tiết bài tập.');
    }
  }, [id]);

  useEffect(() => {
    const task = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(task);
  }, [load]);

  if (state === 'loading') return <Screen scroll={false} contentStyle={styles.loading}><ActivityIndicator color={tokens.colors.lime} size="large" /></Screen>;

  if (state === 'error' || !item) {
    return <Screen contentStyle={styles.content}><Pressable onPress={() => router.back()} style={styles.back}><AppIcon name="arrow-left" color={tokens.colors.lime} size={17} /><Text style={styles.backText}>Danh sách bài tập</Text></Pressable><View style={styles.errorCard}><Text style={styles.errorTitle}>Không thể mở bài tập</Text><Text style={styles.errorText}>{error ?? 'Hãy thử lại.'}</Text><Pressable onPress={() => void load()} style={styles.retryButton}><Text style={styles.retryText}>Thử lại</Text></Pressable></View></Screen>;
  }

  const instructions = extractInstructions(item.instructions);
  const exerciseMeta = formatWorkoutExerciseMeta(item.bodyPart, item.targetMuscle);
  const estimatedMinutes = item.estimatedDurationSeconds ? Math.max(1, Math.round(item.estimatedDurationSeconds / 60)) : null;

  return (
    <Screen contentStyle={styles.content}>
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={8}><AppIcon name="arrow-left" color={tokens.colors.lime} size={17} /><Text style={styles.backText}>Danh sách bài tập</Text></Pressable>

      <View style={styles.heading}><Text style={styles.kicker}>BÀI TẬP HÔM NAY</Text><Text style={styles.title}>{item.name}</Text><Text style={styles.meta}>{exerciseMeta}</Text></View>

      <ExerciseVideo source={item.videoUrl} />

      <View style={styles.detailsCard}>
        <Text style={styles.detailsKicker}>THÔNG TIN THÊM</Text>
        <View style={styles.detailsGrid}>
          <View style={styles.detailsRow}>
            <DetailItem label="Dụng cụ" value={formatWorkoutDetailLabel(item.equipment, 'Tự do')} />
            <DetailItem label="Độ khó" value={formatWorkoutDetailLabel(item.difficulty, 'Phù hợp mọi cấp độ')} />
          </View>
          <View style={styles.detailsRow}>
            <DetailItem label="Kiểu chuyển động" value={formatWorkoutDetailLabel(item.movementPattern, 'Chưa cập nhật')} />
            <DetailItem label="Thời lượng" value={estimatedMinutes ? `Khoảng ${estimatedMinutes} phút` : 'Theo nhịp của bạn'} />
          </View>
        </View>
      </View>

      <View style={styles.infoCard}>
        <View style={styles.infoHeader}><View style={styles.infoIcon}><AppIcon name="target" color={tokens.colors.lime} size={18} /></View><Text style={styles.infoTitle}>Cách thực hiện</Text></View>
        {instructions.length > 0 ? instructions.map((instruction, index) => <View key={`${index}-${instruction}`} style={styles.instruction}><Text style={styles.instructionNumber}>{index + 1}</Text><Text style={styles.instructionText}>{instruction}</Text></View>) : <Text style={styles.emptyInstruction}>Theo dõi video để thực hiện đúng biên độ và nhịp thở. Bạn có thể bắt đầu khi đã sẵn sàng.</Text>}
      </View>

      <Pressable onPress={() => router.push({ pathname: '/workout/[id]', params: { id: item.id } })} style={styles.startButton}><View><Text style={styles.startEyebrow}>{item.isCompleted ? 'Đã hoàn thành' : 'Sẵn sàng tập'}</Text><Text style={styles.startText}>{item.isCompleted ? 'Xem lại bài tập' : 'Bắt đầu bài tập'}</Text></View><View style={styles.startArrow}><AppIcon name="arrow-right" color={tokens.colors.canvas} size={20} /></View></Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: tokens.spacing.md, paddingBottom: 36, gap: 16 },
  loading: { alignItems: 'center', justifyContent: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, paddingVertical: 5 },
  backText: { color: tokens.colors.lime, fontSize: 13, fontWeight: '900' },
  heading: { gap: 5 },
  kicker: { color: '#87A994', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  title: { color: tokens.colors.ink, fontSize: 29, lineHeight: 35, fontWeight: '900', letterSpacing: -0.4 },
  meta: { color: tokens.colors.muted, fontSize: 13, fontWeight: '700' },
  videoShell: { aspectRatio: 16 / 9, overflow: 'hidden', borderRadius: 22, backgroundColor: '#17221B' },
  video: { flex: 1 },
  videoLabel: { position: 'absolute', top: 11, left: 11, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: tokens.radius.pill, backgroundColor: 'rgba(5, 8, 6, 0.76)' },
  videoLabelText: { color: tokens.colors.ink, fontSize: 9, fontWeight: '900', letterSpacing: 0.55 },
  videoFallback: { minHeight: 205, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 28, borderRadius: 22, backgroundColor: '#162119' },
  videoFallbackIcon: { alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 24, backgroundColor: '#213C29' },
  videoFallbackTitle: { color: tokens.colors.ink, fontSize: 15, fontWeight: '900', marginTop: 3 },
  videoFallbackText: { color: tokens.colors.muted, textAlign: 'center', fontSize: 12, lineHeight: 18 },
  detailsCard: { gap: 11, padding: 15, borderRadius: 20, backgroundColor: '#121713' },
  detailsKicker: { color: '#85A791', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  detailsGrid: { gap: 8 },
  detailsRow: { flexDirection: 'row', gap: 8 },
  detailItem: { flex: 1, minHeight: 70, justifyContent: 'space-between', padding: 11, borderRadius: 14, backgroundColor: '#1A221C' },
  detailLabel: { color: '#849087', fontSize: 10, fontWeight: '800' },
  detailValue: { color: tokens.colors.ink, fontSize: 13, lineHeight: 17, fontWeight: '900' },
  infoCard: { gap: 13, padding: 15, borderRadius: 20, backgroundColor: '#121713' },
  infoHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoIcon: { alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 18, backgroundColor: '#1D3323' },
  infoTitle: { color: tokens.colors.ink, fontSize: 15, fontWeight: '900' },
  instruction: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  instructionNumber: { alignItems: 'center', justifyContent: 'center', width: 19, height: 19, borderRadius: 10, overflow: 'hidden', color: tokens.colors.lime, textAlign: 'center', fontSize: 10, lineHeight: 19, fontWeight: '900', backgroundColor: '#203825' },
  instructionText: { flex: 1, color: '#D4D9D5', fontSize: 12, lineHeight: 18 },
  emptyInstruction: { color: tokens.colors.muted, fontSize: 12, lineHeight: 19 },
  startButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 72, paddingLeft: 17, paddingRight: 10, borderRadius: 22, backgroundColor: tokens.colors.lime },
  startEyebrow: { color: '#263008', fontSize: 10, fontWeight: '800' },
  startText: { marginTop: 2, color: tokens.colors.canvas, fontSize: 18, fontWeight: '900' },
  startArrow: { alignItems: 'center', justifyContent: 'center', width: 46, height: 46, borderRadius: 23, backgroundColor: '#D0FF5A' },
  errorCard: { gap: 10, padding: 18, marginTop: 18, borderRadius: 20, backgroundColor: '#211311' },
  errorTitle: { color: tokens.colors.ink, fontSize: 19, fontWeight: '900' },
  errorText: { color: tokens.colors.muted, fontSize: 13, lineHeight: 19 },
  retryButton: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 10, borderRadius: tokens.radius.pill, backgroundColor: tokens.colors.lime },
  retryText: { color: tokens.colors.canvas, fontSize: 12, fontWeight: '900' },
});
