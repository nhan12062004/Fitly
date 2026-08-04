import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { FoundationCard } from '@/components/ui/foundation-card';
import { Screen } from '@/components/ui/screen';
import { apiRequest } from '@/lib/api-client';
import { loadHomeSnapshot, type HomeSnapshot } from '@/lib/fitness-read-model';
import { tokens } from '@/theme/tokens';

type ProfileResponse = { data?: { full_name?: string | null } };

export default function HomeScreen() {
  const [profileState, setProfileState] = useState<'loading' | 'connected' | 'error'>('loading');
  const [profileName, setProfileName] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<HomeSnapshot | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let isActive = true;
    const verifyProtectedApi = async () => {
      try {
        const response = await apiRequest<ProfileResponse>('/api/profile');
        if (!isActive) return;
        setProfileName(response.data?.full_name ?? null);
        const nextSnapshot = await loadHomeSnapshot();
        if (!isActive) return;
        setSnapshot(nextSnapshot);
        setProfileState('connected');
      } catch {
        if (isActive) setProfileState('error');
      }
    };
    void verifyProtectedApi();
    return () => { isActive = false; };
  }, [reloadCount]);

  return (
    <Screen>
      <View style={styles.heroHeader}>
        <View style={styles.heroCopy}>
          <Text style={styles.kicker}>HÔM NAY · PERFORMANCE DAY</Text>
          <Text style={styles.title}>Move with purpose.</Text>
        </View>
        <View style={styles.calendarBadge}>
          <AppIcon name="calendar" color={tokens.colors.lime} size={26} accessibilityLabel="Lịch hôm nay" />
        </View>
      </View>
      <FoundationCard
        eyebrow={profileState === 'connected' ? 'API connected' : profileState === 'error' ? 'API needs attention' : 'Checking session'}
        title={profileState === 'connected' ? `Chào ${profileName || 'bạn'}` : 'Sẵn sàng cho buổi tập'}
        description={profileState === 'connected'
          ? 'Bearer token đã gọi thành công endpoint protected /api/profile.'
          : profileState === 'error'
            ? 'Không thể xác thực API profile. Kiểm tra lại Backend API URL hoặc session.'
            : 'Đang kiểm tra session và kết nối profile.'}
      />
      <View style={styles.metrics}>
        <View style={styles.metricCard}>
          <View style={styles.metricIcon}><AppIcon name="check" color={tokens.colors.lime} size={20} /></View>
          <Text style={styles.metricValue}>{snapshot ? `${snapshot.completedExercises}/${snapshot.plannedExercises}` : '—'}</Text>
          <Text style={styles.metricLabel}>bài tập hoàn thành</Text>
        </View>
        <View style={styles.metricCard}>
          <View style={[styles.metricIcon, styles.metricIconCoral]}><AppIcon name="flame" color={tokens.colors.coral} size={20} /></View>
          <Text style={styles.metricValue}>{snapshot ? `${Math.round(snapshot.caloriesConsumed)}` : '—'}</Text>
          <Text style={styles.metricLabel}>{snapshot?.targetCalories ? `/ ${Math.round(snapshot.targetCalories)} kcal` : 'kcal hôm nay'}</Text>
        </View>
      </View>
      <View style={styles.focusCard}>
        <View style={styles.focusIcon}><AppIcon name="target" color={tokens.colors.canvas} size={22} /></View>
        <View style={styles.focusCopy}>
          <Text style={styles.focusTitle}>Tập trung vào nhịp độ của bạn</Text>
          <Text style={styles.focusText}>Hoàn thành từng set nhỏ để giữ vững đà hôm nay.</Text>
        </View>
      </View>
      {profileState === 'error' ? <Pressable style={styles.retry} onPress={() => setReloadCount((value) => value + 1)}><Text style={styles.retryText}>Thử lại</Text></Pressable> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: tokens.spacing.md },
  heroCopy: { flex: 1, gap: tokens.spacing.xs },
  kicker: { color: tokens.colors.lime, fontSize: tokens.type.overline, fontWeight: '800', letterSpacing: 1.3 },
  title: { color: tokens.colors.ink, fontSize: tokens.type.display, fontWeight: '900', letterSpacing: -1.2 },
  calendarBadge: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: tokens.radius.md, backgroundColor: tokens.colors.surfaceRaised, borderWidth: 1, borderColor: tokens.colors.border },
  metrics: { flexDirection: 'row', gap: tokens.spacing.md },
  metricCard: { flex: 1, minHeight: 148, padding: tokens.spacing.md, gap: tokens.spacing.sm, borderRadius: tokens.radius.lg, backgroundColor: tokens.colors.surface, borderWidth: 1, borderColor: tokens.colors.border },
  metricIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: tokens.radius.sm, backgroundColor: tokens.colors.surfaceRaised },
  metricIconCoral: { backgroundColor: '#2C1D1A' },
  metricValue: { color: tokens.colors.ink, fontSize: 25, fontWeight: '900', letterSpacing: -0.6 },
  metricLabel: { color: tokens.colors.muted, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  focusCard: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md, padding: tokens.spacing.lg, borderRadius: tokens.radius.lg, backgroundColor: tokens.colors.white, borderLeftWidth: 5, borderLeftColor: tokens.colors.lime },
  focusIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: tokens.colors.canvas },
  focusCopy: { flex: 1, gap: 2 },
  focusTitle: { color: tokens.colors.canvas, fontSize: tokens.type.label, fontWeight: '900' },
  focusText: { color: '#4B4F4C', fontSize: 13, lineHeight: 18, fontWeight: '600' },
  retry: { alignSelf: 'flex-start', paddingVertical: tokens.spacing.md, paddingHorizontal: tokens.spacing.lg, borderWidth: 1, borderColor: tokens.colors.lime, borderRadius: tokens.radius.pill },
  retryText: { color: tokens.colors.lime, fontWeight: '800' },
});
