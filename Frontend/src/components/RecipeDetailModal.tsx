import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Clock3, Loader2, X } from 'lucide-react';
import { fetchWithAuth } from '../lib/Api';
import {
  ALLERGEN_LABELS_VI,
  BUDGET_LEVEL_LABELS_VI,
  COOKING_DIFFICULTY_LABELS_VI,
  DIETARY_RESTRICTION_LABELS_VI,
  DIET_STYLE_LABELS_VI,
  MEAL_TYPE_LABELS_VI,
} from '../lib/dietaryPreferences';

type RecipeIngredient = { id: number; ingredient_name: string; amount?: number | null; unit?: string | null; preparation_note?: string | null; is_optional?: boolean | null; foods?: { name?: string | null } | null };
type Recipe = {
  id: string; name: string; name_en?: string | null; description?: string | null; image_url?: string | null;
  calories?: number | null; protein?: number | null; carbs?: number | null; fat?: number | null;
  meal_type?: string[]; dietary_restrictions?: string[]; diet_styles?: string[]; allergens?: string[];
  price_level?: keyof typeof BUDGET_LEVEL_LABELS_VI; cooking_time_minutes?: number | null;
  cooking_difficulty?: keyof typeof COOKING_DIFFICULTY_LABELS_VI; instructions?: { preparation?: string[]; steps?: string[]; tips?: string[] } | null;
  is_active?: boolean; recipe_ingredients?: RecipeIngredient[];
};

const tag = (text: string) => <span key={text} className="rounded-full border border-accent/25 bg-accent/10 px-2 py-1 text-xs font-bold text-accent">{text}</span>;
const list = (values: string[] | undefined, labels: Record<string, string>) => (values || []).map((value) => labels[value] || value);

export function RecipeDetailModal({ recipeId, onClose }: { recipeId: string | null; onClose: () => void }) {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!recipeId) return;
    let cancelled = false;
    setLoading(true); setError(''); setRecipe(null);
    void fetchWithAuth(`/api/recipes/${encodeURIComponent(recipeId)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || 'Không thể tải chi tiết món.');
        if (!cancelled) setRecipe(payload.data);
      })
      .catch((cause: Error) => { if (!cancelled) setError(cause.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [recipeId]);

  if (!recipeId) return null;
  const ingredients = [...(recipe?.recipe_ingredients || [])].sort((a, b) => Number(a.id) - Number(b.id));
  const instructions = recipe?.instructions || {};
  return (
    <div className="fixed inset-0 z-[80] flex items-end bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:justify-center sm:p-5" role="dialog" aria-modal="true" aria-label="Chi tiết món ăn">
      <section className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-border-primary bg-bg-secondary shadow-2xl sm:rounded-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border-primary p-4 md:p-5">
          <div className="min-w-0"><p className="text-xs font-black uppercase tracking-[.12em] text-accent">Recipe</p><h2 className="mt-1 text-xl font-black text-text-primary">{recipe?.name || 'Chi tiết món ăn'}</h2></div>
          <button type="button" onClick={onClose} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border-primary text-text-secondary hover:text-text-primary" aria-label="Đóng chi tiết món"><X className="h-5 w-5" /></button>
        </header>
        {loading ? <div className="flex min-h-60 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-accent" /></div> : null}
        {error ? <div className="m-5 rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm font-semibold text-danger">{error}</div> : null}
        {!loading && !error && recipe ? <div className="custom-scrollbar overflow-y-auto p-4 md:p-5">
          {recipe.image_url ? <img src={recipe.image_url} alt={recipe.name} className="mb-4 h-52 w-full rounded-xl object-cover" /> : <div className="mb-4 flex h-32 items-center justify-center rounded-xl bg-bg-tertiary text-sm font-semibold text-text-tertiary">Chưa có ảnh món</div>}
          {!recipe.is_active ? <p className="mb-4 flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm font-semibold text-warning"><AlertTriangle className="h-4 w-4" /> Món này đã ngừng hoạt động nhưng được giữ để xem lịch sử.</p> : null}
          {recipe.description ? <p className="text-sm leading-6 text-text-secondary">{recipe.description}</p> : null}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{[['Calories', `${Math.round(Number(recipe.calories || 0))} kcal`], ['Protein', `${recipe.protein || 0}g`], ['Carbs', `${recipe.carbs || 0}g`], ['Fat', `${recipe.fat || 0}g`]].map(([label, value]) => <div key={label} className="rounded-xl bg-bg-tertiary p-3"><p className="text-xs font-bold text-text-tertiary">{label}</p><p className="mt-1 font-black text-text-primary">{value}</p></div>)}</div>
          <div className="mt-4 flex flex-wrap gap-2">{list(recipe.dietary_restrictions, DIETARY_RESTRICTION_LABELS_VI).map(tag)}{list(recipe.diet_styles, DIET_STYLE_LABELS_VI).map(tag)}{list(recipe.meal_type, MEAL_TYPE_LABELS_VI).map(tag)}</div>
          <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold text-text-secondary"><span>{BUDGET_LEVEL_LABELS_VI[recipe.price_level || 'medium']}</span><span className="inline-flex items-center gap-1"><Clock3 className="h-4 w-4" />{recipe.cooking_time_minutes || 0} phút</span><span>{COOKING_DIFFICULTY_LABELS_VI[recipe.cooking_difficulty || 'easy']}</span></div>
          <DetailSection title="Nguyên liệu"><ul className="space-y-2">{ingredients.map((item) => <li key={item.id} className="rounded-lg bg-bg-tertiary/70 px-3 py-2 text-sm text-text-secondary"><strong className="text-text-primary">{item.foods?.name || item.ingredient_name}</strong>{item.amount != null ? ` — ${item.amount}${item.unit ? ` ${item.unit}` : ''}` : ''}{item.preparation_note ? ` · ${item.preparation_note}` : ''}{item.is_optional ? <em className="ml-2 text-xs text-text-tertiary">(tuỳ chọn)</em> : null}</li>)}</ul></DetailSection>
          <DetailSection title="Hướng dẫn">{instructions.preparation?.length ? <InstructionList label="Chuẩn bị" values={instructions.preparation} /> : null}<InstructionList label="Các bước" values={instructions.steps || []} ordered />{instructions.tips?.length ? <InstructionList label="Mẹo" values={instructions.tips} /> : null}</DetailSection>
          <DetailSection title="Dị ứng"><div className="flex flex-wrap gap-2">{recipe.allergens?.length ? list(recipe.allergens, ALLERGEN_LABELS_VI).map(tag) : <span className="text-sm text-text-tertiary">Chưa khai báo allergen.</span>}</div></DetailSection>
        </div> : null}
      </section>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) { return <section className="mt-6"><h3 className="mb-2 text-sm font-black text-text-primary">{title}</h3>{children}</section>; }
function InstructionList({ label, values, ordered = false }: { label: string; values: string[]; ordered?: boolean }) { const Tag = ordered ? 'ol' : 'ul'; return <div className="mb-3"><p className="mb-1 text-xs font-black uppercase tracking-[.1em] text-text-tertiary">{label}</p><Tag className={`${ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-5 text-sm leading-6 text-text-secondary`}>{values.map((value, index) => <li key={`${index}-${value}`}>{value}</li>)}</Tag></div>; }
