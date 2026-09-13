import { useResource } from '@/hooks/use-resource';
import type { ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { Screen } from '@/components/ui/screen';
import { apiRequest } from '@/lib/api-client';
import { tokens } from '@/theme/tokens';

type Ingredient = {
  id: string | number;
  ingredient_name?: string | null;
  amount?: number | null;
  unit?: string | null;
  preparation_note?: string | null;
  is_optional?: boolean | null;
  foods?: { name?: string | null } | null;
};

type Recipe = {
  id: string;
  name: string;
  description?: string | null;
  image_url?: string | null;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  cooking_time_minutes?: number | null;
  cooking_difficulty?: string | null;
  instructions?: { preparation?: string[]; steps?: string[]; tips?: string[] } | null;
  recipe_ingredients?: Ingredient[];
};

type RecipeResponse = { success: boolean; data: Recipe };

const formatNumber = (value: number | null | undefined) => Math.round(Number(value ?? 0));

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const resource = useResource('recipe', async () => {
    if (!id) throw new Error('Không tìm thấy công thức.');
    const response = await apiRequest<RecipeResponse>(`/api/recipes/${encodeURIComponent(id)}`);
    return response.data;
  }, [id], 30 * 60_000);
  const { data: recipe, state, load, errorMessage: error } = resource;

  return (
    <Screen>
      <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>← Quay lại</Text></Pressable>
      {state === 'loading' ? <View style={styles.center}><ActivityIndicator color={tokens.colors.lime} size="large" /></View> : null}
      {state === 'error' ? <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => void load()}><Text style={styles.retry}>Thử lại</Text></Pressable></View> : null}
      {state === 'ready' && recipe ? <>
        <Text style={styles.kicker}>CÔNG THỨC</Text>
        <Text style={styles.title}>{recipe.name}</Text>
        {recipe.image_url ? <Image source={{ uri: recipe.image_url }} style={styles.image} resizeMode="cover" /> : null}
        {recipe.description ? <Text style={styles.description}>{recipe.description}</Text> : null}
        <View style={styles.macros}>
          <Macro label="Kcal" value={`${formatNumber(recipe.calories)}`} />
          <Macro label="Protein" value={`${formatNumber(recipe.protein)}g`} />
          <Macro label="Carbs" value={`${formatNumber(recipe.carbs)}g`} />
          <Macro label="Fat" value={`${formatNumber(recipe.fat)}g`} />
        </View>
        <View style={styles.meta}><Text style={styles.metaText}>⏱ {recipe.cooking_time_minutes ?? 0} phút</Text><Text style={styles.metaText}>{recipe.cooking_difficulty ?? 'Dễ'}</Text></View>
        <Section title="Nguyên liệu">
          {(recipe.recipe_ingredients ?? []).map((item) => <View key={String(item.id)} style={styles.row}>
            <Text style={styles.rowTitle}>{item.foods?.name ?? item.ingredient_name ?? 'Nguyên liệu'}</Text>
            <Text style={styles.rowDetail}>{item.amount != null ? `${item.amount}${item.unit ? ` ${item.unit}` : ''}` : ''}{item.preparation_note ? ` · ${item.preparation_note}` : ''}{item.is_optional ? ' · tùy chọn' : ''}</Text>
          </View>)}
        </Section>
        <Section title="Hướng dẫn">
          {(recipe.instructions?.preparation ?? []).map((item, index) => <Text key={`prep-${index}`} style={styles.step}>Chuẩn bị: {item}</Text>)}
          {(recipe.instructions?.steps ?? []).map((item, index) => <Text key={`step-${index}`} style={styles.step}>{index + 1}. {item}</Text>)}
          {(recipe.instructions?.tips ?? []).map((item, index) => <Text key={`tip-${index}`} style={styles.tip}>Mẹo: {item}</Text>)}
        </Section>
      </> : null}
    </Screen>
  );
}

function Macro({ label, value }: { label: string; value: string }) {
  return <View style={styles.macro}><Text style={styles.macroLabel}>{label}</Text><Text style={styles.macroValue}>{value}</Text></View>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>;
}

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start', paddingVertical: tokens.spacing.sm },
  backText: { color: tokens.colors.lime, fontWeight: '800' },
  center: { minHeight: 320, alignItems: 'center', justifyContent: 'center' },
  kicker: { color: tokens.colors.lime, fontWeight: '900', letterSpacing: 1.4, fontSize: tokens.type.overline },
  title: { color: tokens.colors.ink, fontSize: tokens.type.title, fontWeight: '900' },
  image: { width: '100%', height: 220, borderRadius: tokens.radius.lg, backgroundColor: tokens.colors.surface },
  description: { color: tokens.colors.muted, fontSize: tokens.type.body, lineHeight: 23 },
  macros: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
  macro: { flexGrow: 1, minWidth: '42%', padding: tokens.spacing.md, borderRadius: tokens.radius.md, backgroundColor: tokens.colors.surfaceRaised },
  macroLabel: { color: tokens.colors.muted, fontSize: tokens.type.overline, fontWeight: '800' },
  macroValue: { color: tokens.colors.ink, fontSize: tokens.type.label, fontWeight: '900', marginTop: 2 },
  meta: { flexDirection: 'row', gap: tokens.spacing.md },
  metaText: { color: tokens.colors.lime, fontWeight: '800' },
  section: { gap: tokens.spacing.sm, paddingTop: tokens.spacing.sm },
  sectionTitle: { color: tokens.colors.ink, fontSize: tokens.type.label, fontWeight: '900' },
  row: { gap: 2, padding: tokens.spacing.md, borderRadius: tokens.radius.md, backgroundColor: tokens.colors.surface },
  rowTitle: { color: tokens.colors.ink, fontWeight: '800' },
  rowDetail: { color: tokens.colors.muted },
  step: { color: tokens.colors.ink, lineHeight: 23 },
  tip: { color: tokens.colors.lime, lineHeight: 23 },
  errorCard: { gap: tokens.spacing.md, padding: tokens.spacing.lg, borderRadius: tokens.radius.md, backgroundColor: '#321E1B' },
  errorText: { color: tokens.colors.coral, lineHeight: 22 },
  retry: { color: tokens.colors.lime, fontWeight: '900' },
});
