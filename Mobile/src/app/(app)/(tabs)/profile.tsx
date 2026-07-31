import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { FoundationCard } from '@/components/ui/foundation-card';
import { Screen } from '@/components/ui/screen';
import { loadProfileSnapshot, type ProfileSnapshot } from '@/lib/fitness-read-model';
import { supabase } from '@/lib/supabase';
import { tokens } from '@/theme/tokens';

export default function ProfileScreen() {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [profile, setProfile] = useState<ProfileSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert('Không thể đăng xuất', error.message);
  };

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      setProfile(await loadProfileSnapshot());
      setState('ready');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Không thể tải hồ sơ.');
      setState('error');
    }
  }, []);

  return (
    <Screen>
      <Text style={styles.title}>Hồ sơ</Text>
      <FoundationCard eyebrow="Account" title="Secure session" description="Supabase access token được lưu bằng Expo SecureStore. Dữ liệu bên dưới chỉ được đọc theo RLS của tài khoản hiện tại.">
        <Pressable style={styles.refreshButton} onPress={() => void load()} disabled={state === 'loading'}>
          {state === 'loading' ? <ActivityIndicator color={tokens.colors.canvas} /> : <Text style={styles.refreshText}>{state === 'idle' ? 'Tải chỉ số' : 'Làm mới'}</Text>}
        </Pressable>
      </FoundationCard>
      {state === 'error' ? <Text style={styles.error}>{error}</Text> : null}
      {profile ? <FoundationCard title={profile.weight ? `${profile.weight} kg` : 'Chưa có cân nặng'} description={profile.fitnessGoal ? `Mục tiêu: ${profile.fitnessGoal}` : 'Chưa đặt mục tiêu tập luyện'}>
        <View style={styles.stats}>
          <Text style={styles.stat}>Lịch tập: {profile.weeklyWorkouts ?? '—'} buổi/tuần</Text>
          <Text style={styles.stat}>Mục tiêu: {profile.targetCalories ?? '—'} kcal</Text>
        </View>
      </FoundationCard> : null}
      <Pressable style={styles.button} onPress={() => void signOut()}>
        <Text style={styles.buttonText}>Đăng xuất</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: tokens.colors.ink, fontSize: tokens.type.title, fontWeight: '900' },
  refreshButton: { alignSelf: 'flex-start', minWidth: 124, alignItems: 'center', paddingVertical: tokens.spacing.md, paddingHorizontal: tokens.spacing.lg, borderRadius: tokens.radius.pill, backgroundColor: tokens.colors.lime },
  refreshText: { color: tokens.colors.canvas, fontWeight: '900' },
  error: { color: tokens.colors.coral, lineHeight: 21 },
  stats: { gap: tokens.spacing.xs, marginTop: tokens.spacing.xs },
  stat: { color: tokens.colors.lime, fontWeight: '800' },
  button: { alignSelf: 'flex-start', paddingVertical: tokens.spacing.md, paddingHorizontal: tokens.spacing.lg, borderRadius: tokens.radius.pill, borderWidth: 1, borderColor: tokens.colors.coral },
  buttonText: { color: tokens.colors.coral, fontWeight: '800' },
});
