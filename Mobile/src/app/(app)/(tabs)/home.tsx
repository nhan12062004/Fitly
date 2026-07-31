import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
      <Text style={styles.kicker}>THỨ SÁU · PERFORMANCE DAY</Text>
      <Text style={styles.title}>Move with purpose.</Text>
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
        <FoundationCard title={snapshot ? `${snapshot.completedExercises}/${snapshot.plannedExercises}` : '—'} description="bài tập hoàn thành" />
        <FoundationCard title={snapshot ? `${Math.round(snapshot.caloriesConsumed)}` : '—'} description={snapshot?.targetCalories ? `/ ${Math.round(snapshot.targetCalories)} kcal` : 'kcal hôm nay'} />
      </View>
      {profileState === 'error' ? <Pressable style={styles.retry} onPress={() => setReloadCount((value) => value + 1)}><Text style={styles.retryText}>Thử lại</Text></Pressable> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  kicker: { color: tokens.colors.lime, fontSize: tokens.type.overline, fontWeight: '800', letterSpacing: 1.3 },
  title: { color: tokens.colors.ink, fontSize: tokens.type.display, fontWeight: '900', letterSpacing: -1.2 },
  metrics: { flexDirection: 'row', gap: tokens.spacing.md },
  retry: { alignSelf: 'flex-start', paddingVertical: tokens.spacing.md, paddingHorizontal: tokens.spacing.lg, borderWidth: 1, borderColor: tokens.colors.lime, borderRadius: tokens.radius.pill },
  retryText: { color: tokens.colors.lime, fontWeight: '800' },
});
