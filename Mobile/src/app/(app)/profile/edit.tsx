import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { AppIcon } from '@/components/ui/app-icon';
import { Screen } from '@/components/ui/screen';
import { apiRequest } from '@/lib/api-client';
import { supabase } from '@/lib/supabase';
import { tokens } from '@/theme/tokens';

type FormState = {
  fullName: string;
  height: string;
  weight: string;
  targetWeight: string;
  targetCalories: string;
  weeklyWorkouts: string;
  fitnessGoal: string;
};

const emptyForm: FormState = { fullName: '', height: '', weight: '', targetWeight: '', targetCalories: '', weeklyWorkouts: '', fitnessGoal: 'Giảm mỡ' };
const goals = ['Giảm mỡ', 'Tăng cơ', 'Sức khỏe'];
const toText = (value: unknown) => value == null ? '' : String(value);
const toNumberOrNull = (value: string) => {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export default function EditProfileScreen() {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Phiên đăng nhập đã hết hạn.');
      const [bodyResult, lifestyleResult] = await Promise.all([
        supabase.from('body_metrics').select('height, weight, target_weight').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('lifestyle_settings').select('fitness_goal, target_calories, weekly_workouts').eq('user_id', user.id).maybeSingle(),
      ]);
      if (bodyResult.error) throw bodyResult.error;
      if (lifestyleResult.error) throw lifestyleResult.error;
      const metadata = user.user_metadata ?? {};
      setForm({
        fullName: typeof metadata.full_name === 'string' ? metadata.full_name : typeof metadata.name === 'string' ? metadata.name : user.email?.split('@')[0] ?? '',
        height: toText(bodyResult.data?.height),
        weight: toText(bodyResult.data?.weight),
        targetWeight: toText(bodyResult.data?.target_weight),
        targetCalories: toText(lifestyleResult.data?.target_calories),
        weeklyWorkouts: toText(lifestyleResult.data?.weekly_workouts),
        fitnessGoal: lifestyleResult.data?.fitness_goal || 'Giảm mỡ',
      });
      setState('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu hồ sơ.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    const task = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(task);
  }, [load]);

  const update = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (state === 'saving') return;
    setState('saving');
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Phiên đăng nhập đã hết hạn.');
      await apiRequest('/api/profile', { method: 'PATCH', body: { full_name: form.fullName.trim() || null }, timeoutMs: 15_000 });
      const [bodyResult, lifestyleResult] = await Promise.all([
        supabase.from('body_metrics').insert({ user_id: user.id, height: toNumberOrNull(form.height), weight: toNumberOrNull(form.weight), target_weight: toNumberOrNull(form.targetWeight) }),
        supabase.from('lifestyle_settings').upsert({ user_id: user.id, fitness_goal: form.fitnessGoal, target_calories: toNumberOrNull(form.targetCalories), weekly_workouts: toNumberOrNull(form.weeklyWorkouts), updated_at: new Date().toISOString() }),
      ]);
      if (bodyResult.error) throw bodyResult.error;
      if (lifestyleResult.error) throw lifestyleResult.error;
      router.back();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể lưu hồ sơ.');
      setState('error');
    }
  };

  return (
    <Screen contentStyle={styles.content}>
      <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>← Hồ sơ</Text></Pressable>
      <View><Text style={styles.kicker}>CẬP NHẬT THÔNG TIN</Text><Text style={styles.title}>Hồ sơ cơ thể</Text><Text style={styles.description}>Các chỉ số này giúp Fitly và AI Coach đưa ra gợi ý sát hơn.</Text></View>
      {state === 'loading' ? <View style={styles.loading}><ActivityIndicator color={tokens.colors.lime} /></View> : null}
      {state !== 'loading' ? <>
        <SectionTitle title="Thông tin cơ bản" />
        <Field label="Họ và tên" value={form.fullName} onChangeText={(value) => update('fullName', value)} placeholder="Tên hiển thị" />
        <SectionTitle title="Cơ thể" />
        <View style={styles.doubleRow}><Field label="Chiều cao" value={form.height} onChangeText={(value) => update('height', value)} placeholder="cm" keyboardType="decimal-pad" /><Field label="Cân nặng" value={form.weight} onChangeText={(value) => update('weight', value)} placeholder="kg" keyboardType="decimal-pad" /></View>
        <Field label="Cân nặng mục tiêu" value={form.targetWeight} onChangeText={(value) => update('targetWeight', value)} placeholder="kg" keyboardType="decimal-pad" />
        <SectionTitle title="Mục tiêu và nhịp sống" />
        <Text style={styles.fieldLabel}>Mục tiêu chính</Text><View style={styles.goalRow}>{goals.map((goal) => <Pressable key={goal} onPress={() => update('fitnessGoal', goal)} style={[styles.goalChip, form.fitnessGoal === goal && styles.goalChipActive]}><Text style={[styles.goalChipText, form.fitnessGoal === goal && styles.goalChipTextActive]}>{goal}</Text></Pressable>)}</View>
        <View style={styles.doubleRow}><Field label="Mục tiêu calorie" value={form.targetCalories} onChangeText={(value) => update('targetCalories', value)} placeholder="kcal" keyboardType="number-pad" /><Field label="Buổi tập / tuần" value={form.weeklyWorkouts} onChangeText={(value) => update('weeklyWorkouts', value)} placeholder="buổi" keyboardType="number-pad" /></View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable disabled={state === 'saving'} onPress={() => void save()} style={[styles.saveButton, state === 'saving' && styles.saveButtonDisabled]}>{state === 'saving' ? <ActivityIndicator color={tokens.colors.canvas} /> : <><Text style={styles.saveText}>Lưu thay đổi</Text><AppIcon name="check" color={tokens.colors.canvas} size={18} /></>}</Pressable>
      </> : null}
    </Screen>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function Field({ label, value, onChangeText, placeholder, keyboardType = 'default' }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; keyboardType?: 'default' | 'decimal-pad' | 'number-pad' }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#69726C" keyboardType={keyboardType} style={styles.input} /></View>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: tokens.spacing.lg, paddingTop: tokens.spacing.md, paddingBottom: tokens.spacing.xl, gap: tokens.spacing.md },
  back: { alignSelf: 'flex-start', paddingVertical: 4 },
  backText: { color: tokens.colors.lime, fontSize: 14, fontWeight: '900' },
  kicker: { color: tokens.colors.lime, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  title: { marginTop: 4, color: tokens.colors.ink, fontSize: 30, fontWeight: '900' },
  description: { marginTop: 6, color: tokens.colors.muted, fontSize: 13, lineHeight: 19 },
  loading: { minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { paddingTop: tokens.spacing.sm, color: '#A5B2A8', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  field: { flex: 1, gap: 6 },
  fieldLabel: { color: '#B7C0B9', fontSize: 12, fontWeight: '800' },
  input: { minHeight: 48, paddingHorizontal: tokens.spacing.md, borderRadius: 14, borderWidth: 1, borderColor: '#354038', backgroundColor: '#151916', color: tokens.colors.ink, fontSize: 15, fontWeight: '700' },
  doubleRow: { flexDirection: 'row', gap: tokens.spacing.sm },
  goalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  goalChip: { paddingHorizontal: 13, paddingVertical: 10, borderRadius: tokens.radius.pill, borderWidth: 1, borderColor: '#39443C', backgroundColor: '#151916' },
  goalChipActive: { borderColor: tokens.colors.lime, backgroundColor: '#203017' },
  goalChipText: { color: tokens.colors.muted, fontSize: 13, fontWeight: '800' },
  goalChipTextActive: { color: tokens.colors.lime },
  error: { color: tokens.colors.coral, fontSize: 13, lineHeight: 19 },
  saveButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 54, marginTop: tokens.spacing.sm, borderRadius: tokens.radius.pill, backgroundColor: tokens.colors.lime },
  saveButtonDisabled: { opacity: 0.55 },
  saveText: { color: tokens.colors.canvas, fontSize: 16, fontWeight: '900' },
});
