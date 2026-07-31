import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { FoundationCard } from '@/components/ui/foundation-card';
import { Screen } from '@/components/ui/screen';
import { loadTodayMeals, type MealItem } from '@/lib/fitness-read-model';
import { tokens } from '@/theme/tokens';

export default function MealsScreen() {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [items, setItems] = useState<MealItem[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <Screen>
      <Text style={styles.title}>Dinh dưỡng</Text>
      <FoundationCard eyebrow="Hôm nay" title="Thực đơn của bạn" description="Đọc kế hoạch ăn đang active cho tuần hiện tại thông qua RLS; màn hình này chưa ghi meal log.">
        <Pressable style={styles.button} onPress={() => void load()} disabled={state === 'loading'}>
          {state === 'loading' ? <ActivityIndicator color={tokens.colors.canvas} /> : <Text style={styles.buttonText}>{state === 'idle' ? 'Tải thực đơn' : 'Làm mới'}</Text>}
        </Pressable>
      </FoundationCard>
      {state === 'error' ? <Text style={styles.error}>{error}</Text> : null}
      {state === 'ready' && items.length === 0 ? <FoundationCard title="Hôm nay chưa có thực đơn" description="Khi có kế hoạch ăn active được tạo từ web, các món theo ngày sẽ hiển thị ở đây." /> : null}
      {items.map((item) => (
        <FoundationCard key={item.id} eyebrow={item.mealType ?? 'Bữa ăn'} title={item.name} description={item.quantity ? `Khẩu phần: ${item.quantity}` : 'Khẩu phần theo kế hoạch'}>
          <View style={styles.macros}>
            <Text style={styles.macro}>{Math.round(item.calories ?? 0)} kcal</Text>
            <Text style={styles.macro}>P {Math.round(item.protein ?? 0)}g</Text>
            <Text style={styles.macro}>C {Math.round(item.carbs ?? 0)}g</Text>
            <Text style={styles.macro}>F {Math.round(item.fat ?? 0)}g</Text>
          </View>
        </FoundationCard>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: tokens.colors.ink, fontSize: tokens.type.title, fontWeight: '900' },
  button: { alignSelf: 'flex-start', minWidth: 132, alignItems: 'center', paddingVertical: tokens.spacing.md, paddingHorizontal: tokens.spacing.lg, borderRadius: tokens.radius.pill, backgroundColor: tokens.colors.lime },
  buttonText: { color: tokens.colors.canvas, fontWeight: '900' },
  error: { color: tokens.colors.coral, lineHeight: 21 },
  macros: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm, marginTop: tokens.spacing.xs },
  macro: { color: tokens.colors.lime, fontWeight: '800' },
});
