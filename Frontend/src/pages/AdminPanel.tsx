import { useCallback, useEffect, useMemo, useState, type ElementType, type FormEvent } from 'react';
import {
  Activity,
  BarChart3,
  Brain,
  Crown,
  Dumbbell,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Send,
  Shield,
  Trash2,
  Users,
  Utensils,
  X
} from 'lucide-react';
import { fetchWithAuth } from '../lib/Api';
import { useAuth } from '../contexts/AuthContext';

type AdminTab = 'overview' | 'users' | 'exercises' | 'foods';

type OverviewStats = {
  users: number;
  premiumUsers: number;
  newUsers7d: number;
  telegramLinkedUsers: number;
  exercises: number;
  foods: number;
  aiAdjustments: {
    proposed: number;
    applied: number;
    rejected: number;
  };
  todayCompletedWorkouts: number;
  todayCompletedMeals: number;
};

type AdminUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  membership_tier: string | null;
  telegram_chat_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ExerciseRow = {
  id: string;
  name: string;
  body_part?: string | null;
  equipment?: string | null;
  target_muscle?: string | null;
  gif_url?: string | null;
  image_url?: string | null;
  difficulty?: string | null;
  instructions?: string[] | Record<string, unknown> | string | null;
  secondary_muscles?: string[] | null;
  goal_type?: string[] | null;
  contraindications?: string[] | null;
  estimated_duration_seconds?: number | null;
  calories_per_minute?: number | null;
  movement_pattern?: string | null;
};

type FoodRow = {
  id: string;
  name: string;
  category?: string | null;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  serving_unit?: string | null;
  image_url?: string | null;
  meal_type?: string[] | null;
  goal_type?: string[] | null;
  allergens?: string[] | null;
  price_level?: string | null;
  cooking_time_minutes?: number | null;
  region?: string | null;
  is_easy_to_prepare?: boolean | null;
};

type ExerciseForm = {
  id: string;
  name: string;
  body_part: string;
  equipment: string;
  target_muscle: string;
  gif_url: string;
  image_url: string;
  difficulty: string;
  instructions: string;
  secondary_muscles: string;
  goal_type: string;
  contraindications: string;
  estimated_duration_seconds: string;
  calories_per_minute: string;
  movement_pattern: string;
};

type FoodForm = {
  name: string;
  category: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  serving_unit: string;
  image_url: string;
  meal_type: string;
  goal_type: string;
  allergens: string;
  price_level: string;
  cooking_time_minutes: string;
  region: string;
  is_easy_to_prepare: boolean;
};

const emptyExerciseForm: ExerciseForm = {
  id: '',
  name: '',
  body_part: '',
  equipment: '',
  target_muscle: '',
  gif_url: '',
  image_url: '',
  difficulty: '',
  instructions: '',
  secondary_muscles: '',
  goal_type: '',
  contraindications: '',
  estimated_duration_seconds: '',
  calories_per_minute: '',
  movement_pattern: ''
};

const emptyFoodForm: FoodForm = {
  name: '',
  category: '',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
  serving_unit: '100g',
  image_url: '',
  meal_type: '',
  goal_type: '',
  allergens: '',
  price_level: '',
  cooking_time_minutes: '',
  region: 'Vietnam',
  is_easy_to_prepare: true
};

const tabs: Array<{ id: AdminTab; label: string; icon: ElementType }> = [
  { id: 'overview', label: 'Tổng quan', icon: BarChart3 },
  { id: 'users', label: 'Người dùng', icon: Users },
  { id: 'exercises', label: 'Bài tập', icon: Dumbbell },
  { id: 'foods', label: 'Thức ăn', icon: Utensils }
];

const formatDate = (value: string | null | undefined) => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date(value));
};

const formatList = (value: unknown) => {
  if (Array.isArray(value)) return value.join(', ');
  return String(value || '');
};

const instructionsToText = (value: ExerciseRow['instructions']) => {
  if (Array.isArray(value)) return value.join('\n');
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
  return '';
};

const toExerciseForm = (row?: ExerciseRow | null): ExerciseForm => {
  if (!row) return emptyExerciseForm;
  return {
    id: row.id || '',
    name: row.name || '',
    body_part: row.body_part || '',
    equipment: row.equipment || '',
    target_muscle: row.target_muscle || '',
    gif_url: row.gif_url || '',
    image_url: row.image_url || '',
    difficulty: row.difficulty || '',
    instructions: instructionsToText(row.instructions),
    secondary_muscles: formatList(row.secondary_muscles),
    goal_type: formatList(row.goal_type),
    contraindications: formatList(row.contraindications),
    estimated_duration_seconds: row.estimated_duration_seconds ? String(row.estimated_duration_seconds) : '',
    calories_per_minute: row.calories_per_minute ? String(row.calories_per_minute) : '',
    movement_pattern: row.movement_pattern || ''
  };
};

const toFoodForm = (row?: FoodRow | null): FoodForm => {
  if (!row) return emptyFoodForm;
  return {
    name: row.name || '',
    category: row.category || '',
    calories: row.calories !== null && row.calories !== undefined ? String(row.calories) : '',
    protein: row.protein !== null && row.protein !== undefined ? String(row.protein) : '',
    carbs: row.carbs !== null && row.carbs !== undefined ? String(row.carbs) : '',
    fat: row.fat !== null && row.fat !== undefined ? String(row.fat) : '',
    serving_unit: row.serving_unit || '100g',
    image_url: row.image_url || '',
    meal_type: formatList(row.meal_type),
    goal_type: formatList(row.goal_type),
    allergens: formatList(row.allergens),
    price_level: row.price_level || '',
    cooking_time_minutes: row.cooking_time_minutes ? String(row.cooking_time_minutes) : '',
    region: row.region || 'Vietnam',
    is_easy_to_prepare: row.is_easy_to_prepare !== false
  };
};

export default function AdminPanel() {
  const { isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [exercises, setExercises] = useState<ExerciseRow[]>([]);
  const [foods, setFoods] = useState<FoodRow[]>([]);
  const [editingExercise, setEditingExercise] = useState<ExerciseRow | null>(null);
  const [isExerciseFormOpen, setIsExerciseFormOpen] = useState(false);
  const [exerciseForm, setExerciseForm] = useState<ExerciseForm>(emptyExerciseForm);
  const [editingFood, setEditingFood] = useState<FoodRow | null>(null);
  const [isFoodFormOpen, setIsFoodFormOpen] = useState(false);
  const [foodForm, setFoodForm] = useState<FoodForm>(emptyFoodForm);

  const querySuffix = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('q', search.trim());
    params.set('limit', '160');
    return `?${params.toString()}`;
  }, [search]);

  const requestJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetchWithAuth(path, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || 'Không thể tải dữ liệu quản trị');
    }
    return payload.data ?? payload;
  };

  const loadData = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError('');
    try {
      if (activeTab === 'overview') {
        setOverview(await requestJson<OverviewStats>('/api/admin/overview'));
      }
      if (activeTab === 'users') {
        setUsers(await requestJson<AdminUser[]>(`/api/admin/users${querySuffix}`));
      }
      if (activeTab === 'exercises') {
        setExercises(await requestJson<ExerciseRow[]>(`/api/admin/exercises${querySuffix}`));
      }
      if (activeTab === 'foods') {
        setFoods(await requestJson<FoodRow[]>(`/api/admin/foods${querySuffix}`));
      }
    } catch (err: any) {
      setError(err?.message || 'Không thể tải dữ liệu quản trị');
    } finally {
      setLoading(false);
    }
  }, [activeTab, isAdmin, querySuffix]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openNewExerciseForm = () => {
    setEditingExercise(null);
    setExerciseForm(emptyExerciseForm);
    setIsExerciseFormOpen(true);
  };

  const openEditExerciseForm = (row: ExerciseRow) => {
    setEditingExercise(row);
    setExerciseForm(toExerciseForm(row));
    setIsExerciseFormOpen(true);
  };

  const submitExercise = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const path = editingExercise ? `/api/admin/exercises/${editingExercise.id}` : '/api/admin/exercises';
      const method = editingExercise ? 'PUT' : 'POST';
      await requestJson<ExerciseRow>(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exerciseForm)
      });
      setIsExerciseFormOpen(false);
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Không thể lưu bài tập');
    } finally {
      setSaving(false);
    }
  };

  const deleteExercise = async (row: ExerciseRow) => {
    if (!confirm(`Xóa bài tập "${row.name}"?`)) return;
    setSaving(true);
    setError('');
    try {
      await requestJson(`/api/admin/exercises/${row.id}`, { method: 'DELETE' });
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Không thể xóa bài tập');
    } finally {
      setSaving(false);
    }
  };

  const openNewFoodForm = () => {
    setEditingFood(null);
    setFoodForm(emptyFoodForm);
    setIsFoodFormOpen(true);
  };

  const openEditFoodForm = (row: FoodRow) => {
    setEditingFood(row);
    setFoodForm(toFoodForm(row));
    setIsFoodFormOpen(true);
  };

  const submitFood = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const path = editingFood ? `/api/admin/foods/${editingFood.id}` : '/api/admin/foods';
      const method = editingFood ? 'PUT' : 'POST';
      await requestJson<FoodRow>(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(foodForm)
      });
      setIsFoodFormOpen(false);
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Không thể lưu món ăn');
    } finally {
      setSaving(false);
    }
  };

  const deleteFood = async (row: FoodRow) => {
    if (!confirm(`Xóa món ăn "${row.name}"?`)) return;
    setSaving(true);
    setError('');
    try {
      await requestJson(`/api/admin/foods/${row.id}`, { method: 'DELETE' });
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Không thể xóa món ăn');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="dashboard-page-shell flex min-h-[50vh] items-center justify-center">
        <div className="rounded-xl border border-border-primary bg-bg-secondary p-6 text-center">
          <Shield className="mx-auto h-8 w-8 text-danger" />
          <h2 className="mt-3 text-lg font-bold text-text-primary">Không có quyền truy cập</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page-shell flex flex-col gap-4 pb-4 md:gap-5 md:pb-6 lg:pb-7">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-black text-text-primary">Quản trị viên</h1>
          <p className="mt-1 text-sm font-semibold text-text-secondary">Người dùng, bài tập, thức ăn và vận hành hệ thống.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border-primary bg-bg-secondary px-4 text-sm font-black text-text-primary transition-colors hover:border-accent/40 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          Làm mới
        </button>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-border-primary bg-bg-secondary/80 p-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setSearch('');
                setError('');
              }}
              className={`inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-black transition-colors ${
                isActive
                  ? 'bg-accent text-text-inverse'
                  : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="rounded-xl border border-danger/25 bg-danger/10 px-4 py-3 text-sm font-semibold text-danger">
          {error}
        </div>
      )}

      {activeTab !== 'overview' && (
        <div className="flex flex-col gap-3 rounded-xl border border-border-primary bg-bg-secondary/80 p-3 md:flex-row md:items-center md:justify-between">
          <div className="relative max-w-xl flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void loadData();
              }}
              placeholder="Tìm kiếm..."
              className="h-11 w-full rounded-xl border border-border-primary bg-bg-tertiary pl-10 pr-3 text-sm text-text-primary outline-none transition-colors focus:border-accent"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void loadData()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border-primary bg-bg-tertiary px-4 text-sm font-black text-text-primary transition-colors hover:border-accent/40"
            >
              <Search className="h-4 w-4" />
              Tìm
            </button>
            {activeTab === 'exercises' && (
              <button type="button" onClick={openNewExerciseForm} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover">
                <Plus className="h-4 w-4" />
                Thêm
              </button>
            )}
            {activeTab === 'foods' && (
              <button type="button" onClick={openNewFoodForm} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover">
                <Plus className="h-4 w-4" />
                Thêm
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-xl border border-border-primary bg-bg-secondary/70" />
          ))}
        </div>
      ) : (
        <>
          {activeTab === 'overview' && <OverviewTab overview={overview} />}
          {activeTab === 'users' && <UsersTab users={users} />}
          {activeTab === 'exercises' && <ExercisesTab rows={exercises} onEdit={openEditExerciseForm} onDelete={deleteExercise} saving={saving} />}
          {activeTab === 'foods' && <FoodsTab rows={foods} onEdit={openEditFoodForm} onDelete={deleteFood} saving={saving} />}
        </>
      )}

      {isExerciseFormOpen && (
        <ExerciseFormPanel
          form={exerciseForm}
          isEditing={!!editingExercise}
          saving={saving}
          onClose={() => setIsExerciseFormOpen(false)}
          onSubmit={submitExercise}
          onChange={(patch) => setExerciseForm((prev) => ({ ...prev, ...patch }))}
        />
      )}

      {isFoodFormOpen && (
        <FoodFormPanel
          form={foodForm}
          isEditing={!!editingFood}
          saving={saving}
          onClose={() => setIsFoodFormOpen(false)}
          onSubmit={submitFood}
          onChange={(patch) => setFoodForm((prev) => ({ ...prev, ...patch }))}
        />
      )}
    </div>
  );
}

function OverviewTab({ overview }: { overview: OverviewStats | null }) {
  const stats = [
    { label: 'Người dùng', value: overview?.users || 0, icon: Users, tone: 'text-info' },
    { label: 'Premium', value: overview?.premiumUsers || 0, icon: Crown, tone: 'text-warning' },
    { label: 'User mới 7 ngày', value: overview?.newUsers7d || 0, icon: Activity, tone: 'text-accent' },
    { label: 'Telegram', value: overview?.telegramLinkedUsers || 0, icon: Send, tone: 'text-info' },
    { label: 'Bài tập', value: overview?.exercises || 0, icon: Dumbbell, tone: 'text-accent' },
    { label: 'Thức ăn', value: overview?.foods || 0, icon: Utensils, tone: 'text-warning' }
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {stats.map((item) => {
        const Icon = item.icon;
        return (
          <article key={item.label} className="rounded-xl border border-border-primary bg-bg-secondary/80 p-5 shadow-[0_18px_48px_rgba(0,0,0,0.12)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">{item.label}</p>
                <p className="mt-3 text-2xl font-black text-text-primary">{item.value.toLocaleString('vi-VN')}</p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-bg-tertiary">
                <Icon className={`h-5 w-5 ${item.tone}`} />
              </span>
            </div>
          </article>
        );
      })}

      <article className="rounded-xl border border-border-primary bg-bg-secondary/80 p-5 md:col-span-2 xl:col-span-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-ai/10">
            <Brain className="h-5 w-5 text-ai" />
          </span>
          <div>
            <p className="text-sm font-black text-text-primary">AI Coach adjustments</p>
            <p className="text-xs font-semibold text-text-tertiary">
              Đề xuất: {overview?.aiAdjustments.proposed || 0} · Đã áp dụng: {overview?.aiAdjustments.applied || 0} · Từ chối: {overview?.aiAdjustments.rejected || 0}
            </p>
          </div>
        </div>
      </article>
    </div>
  );
}

function UsersTab({ users }: { users: AdminUser[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border-primary bg-bg-secondary/80">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-border-primary bg-bg-tertiary/55 text-xs font-black uppercase tracking-[0.12em] text-text-tertiary">
            <tr>
              <th className="px-4 py-3">Người dùng</th>
              <th className="px-4 py-3">Gói</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Telegram</th>
              <th className="px-4 py-3">Ngày tạo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-primary/70">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-bg-tertiary/35">
                <td className="px-4 py-3">
                  <p className="font-black text-text-primary">{user.full_name || user.email || 'Chưa có tên'}</p>
                  <p className="text-xs text-text-tertiary">{user.email || user.phone || user.id}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-black ${user.membership_tier === 'premium' ? 'bg-warning/10 text-warning' : 'bg-bg-tertiary text-text-secondary'}`}>
                    {user.membership_tier || 'free'}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-secondary">{user.role || 'user'}</td>
                <td className="px-4 py-3 text-text-secondary">{user.telegram_chat_id ? 'Đã kết nối' : 'Chưa kết nối'}</td>
                <td className="px-4 py-3 text-text-secondary">{formatDate(user.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExercisesTab({
  rows,
  onEdit,
  onDelete,
  saving
}: {
  rows: ExerciseRow[];
  onEdit: (row: ExerciseRow) => void;
  onDelete: (row: ExerciseRow) => void;
  saving: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border-primary bg-bg-secondary/80">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-border-primary bg-bg-tertiary/55 text-xs font-black uppercase tracking-[0.12em] text-text-tertiary">
            <tr>
              <th className="px-4 py-3">Bài tập</th>
              <th className="px-4 py-3">Nhóm cơ</th>
              <th className="px-4 py-3">Thiết bị</th>
              <th className="px-4 py-3">Độ khó</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-primary/70">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-bg-tertiary/35">
                <td className="px-4 py-3">
                  <p className="font-black text-text-primary">{row.name}</p>
                  <p className="text-xs text-text-tertiary">{row.id}</p>
                </td>
                <td className="px-4 py-3 text-text-secondary">{row.target_muscle || row.body_part || '-'}</td>
                <td className="px-4 py-3 text-text-secondary">{row.equipment || '-'}</td>
                <td className="px-4 py-3 text-text-secondary">{row.difficulty || '-'}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => onEdit(row)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border-primary bg-bg-tertiary text-text-secondary hover:text-accent">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" disabled={saving} onClick={() => onDelete(row)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-danger/20 bg-danger/10 text-danger hover:bg-danger/15 disabled:opacity-60">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FoodsTab({
  rows,
  onEdit,
  onDelete,
  saving
}: {
  rows: FoodRow[];
  onEdit: (row: FoodRow) => void;
  onDelete: (row: FoodRow) => void;
  saving: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border-primary bg-bg-secondary/80">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-border-primary bg-bg-tertiary/55 text-xs font-black uppercase tracking-[0.12em] text-text-tertiary">
            <tr>
              <th className="px-4 py-3">Món ăn</th>
              <th className="px-4 py-3">Kcal</th>
              <th className="px-4 py-3">Protein</th>
              <th className="px-4 py-3">Carbs</th>
              <th className="px-4 py-3">Fat</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-primary/70">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-bg-tertiary/35">
                <td className="px-4 py-3">
                  <p className="font-black text-text-primary">{row.name}</p>
                  <p className="text-xs text-text-tertiary">{row.category || row.serving_unit || row.id}</p>
                </td>
                <td className="px-4 py-3 text-text-secondary">{row.calories || 0}</td>
                <td className="px-4 py-3 text-text-secondary">{row.protein || 0}g</td>
                <td className="px-4 py-3 text-text-secondary">{row.carbs || 0}g</td>
                <td className="px-4 py-3 text-text-secondary">{row.fat || 0}g</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => onEdit(row)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border-primary bg-bg-tertiary text-text-secondary hover:text-accent">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" disabled={saving} onClick={() => onDelete(row)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-danger/20 bg-danger/10 text-danger hover:bg-danger/15 disabled:opacity-60">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  disabled = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-xs font-black uppercase tracking-[0.12em] text-text-tertiary">{label}</span>
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-11 w-full rounded-xl border border-border-primary bg-bg-tertiary px-3 text-sm text-text-primary outline-none transition-colors focus:border-accent disabled:opacity-60"
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  rows = 3
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-xs font-black uppercase tracking-[0.12em] text-text-tertiary">{label}</span>
      <textarea
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full resize-y rounded-xl border border-border-primary bg-bg-tertiary px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent"
      />
    </label>
  );
}

function ExerciseFormPanel({
  form,
  isEditing,
  saving,
  onClose,
  onSubmit,
  onChange
}: {
  form: ExerciseForm;
  isEditing: boolean;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  onChange: (patch: Partial<ExerciseForm>) => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/50 backdrop-blur-sm">
      <form onSubmit={onSubmit} className="flex h-full w-full max-w-3xl flex-col border-l border-border-primary bg-bg-secondary shadow-2xl">
        <PanelHeader title={isEditing ? 'Sửa bài tập' : 'Thêm bài tập'} saving={saving} onClose={onClose} />
        <div className="custom-scrollbar grid flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-2 md:p-5">
          <Field label="ID" value={form.id} disabled={isEditing} onChange={(value) => onChange({ id: value })} />
          <Field label="Tên bài tập" value={form.name} onChange={(value) => onChange({ name: value })} />
          <Field label="Nhóm cơ" value={form.body_part} onChange={(value) => onChange({ body_part: value })} />
          <Field label="Cơ chính" value={form.target_muscle} onChange={(value) => onChange({ target_muscle: value })} />
          <Field label="Thiết bị" value={form.equipment} onChange={(value) => onChange({ equipment: value })} />
          <Field label="Độ khó" value={form.difficulty} onChange={(value) => onChange({ difficulty: value })} />
          <Field label="GIF URL" value={form.gif_url} onChange={(value) => onChange({ gif_url: value })} />
          <Field label="Ảnh URL" value={form.image_url} onChange={(value) => onChange({ image_url: value })} />
          <Field label="Thời lượng giây" type="number" value={form.estimated_duration_seconds} onChange={(value) => onChange({ estimated_duration_seconds: value })} />
          <Field label="Kcal/phút" type="number" value={form.calories_per_minute} onChange={(value) => onChange({ calories_per_minute: value })} />
          <Field label="Movement pattern" value={form.movement_pattern} onChange={(value) => onChange({ movement_pattern: value })} />
          <Field label="Mục tiêu" value={form.goal_type} onChange={(value) => onChange({ goal_type: value })} />
          <Field label="Cơ phụ" value={form.secondary_muscles} onChange={(value) => onChange({ secondary_muscles: value })} />
          <Field label="Chống chỉ định" value={form.contraindications} onChange={(value) => onChange({ contraindications: value })} />
          <div className="md:col-span-2">
            <TextAreaField label="Hướng dẫn" value={form.instructions} onChange={(value) => onChange({ instructions: value })} rows={6} />
          </div>
        </div>
        <PanelFooter saving={saving} onClose={onClose} />
      </form>
    </div>
  );
}

function FoodFormPanel({
  form,
  isEditing,
  saving,
  onClose,
  onSubmit,
  onChange
}: {
  form: FoodForm;
  isEditing: boolean;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  onChange: (patch: Partial<FoodForm>) => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/50 backdrop-blur-sm">
      <form onSubmit={onSubmit} className="flex h-full w-full max-w-3xl flex-col border-l border-border-primary bg-bg-secondary shadow-2xl">
        <PanelHeader title={isEditing ? 'Sửa món ăn' : 'Thêm món ăn'} saving={saving} onClose={onClose} />
        <div className="custom-scrollbar grid flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-2 md:p-5">
          <Field label="Tên món" value={form.name} onChange={(value) => onChange({ name: value })} />
          <Field label="Danh mục" value={form.category} onChange={(value) => onChange({ category: value })} />
          <Field label="Calories" type="number" value={form.calories} onChange={(value) => onChange({ calories: value })} />
          <Field label="Protein" type="number" value={form.protein} onChange={(value) => onChange({ protein: value })} />
          <Field label="Carbs" type="number" value={form.carbs} onChange={(value) => onChange({ carbs: value })} />
          <Field label="Fat" type="number" value={form.fat} onChange={(value) => onChange({ fat: value })} />
          <Field label="Serving unit" value={form.serving_unit} onChange={(value) => onChange({ serving_unit: value })} />
          <Field label="Ảnh URL" value={form.image_url} onChange={(value) => onChange({ image_url: value })} />
          <Field label="Meal type" value={form.meal_type} onChange={(value) => onChange({ meal_type: value })} />
          <Field label="Goal type" value={form.goal_type} onChange={(value) => onChange({ goal_type: value })} />
          <Field label="Allergens" value={form.allergens} onChange={(value) => onChange({ allergens: value })} />
          <Field label="Price level" value={form.price_level} onChange={(value) => onChange({ price_level: value })} />
          <Field label="Thời gian nấu" type="number" value={form.cooking_time_minutes} onChange={(value) => onChange({ cooking_time_minutes: value })} />
          <Field label="Region" value={form.region} onChange={(value) => onChange({ region: value })} />
          <label className="flex items-center gap-3 rounded-xl border border-border-primary bg-bg-tertiary px-3 py-3 md:col-span-2">
            <input
              type="checkbox"
              checked={form.is_easy_to_prepare}
              onChange={(event) => onChange({ is_easy_to_prepare: event.target.checked })}
              className="h-4 w-4 accent-accent"
            />
            <span className="text-sm font-semibold text-text-primary">Dễ chuẩn bị</span>
          </label>
        </div>
        <PanelFooter saving={saving} onClose={onClose} />
      </form>
    </div>
  );
}

function PanelHeader({ title, saving, onClose }: { title: string; saving: boolean; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border-primary px-4 py-4 md:px-5">
      <h2 className="text-lg font-black text-text-primary">{title}</h2>
      <button type="button" disabled={saving} onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border-primary bg-bg-tertiary text-text-secondary hover:text-text-primary disabled:opacity-60">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function PanelFooter({ saving, onClose }: { saving: boolean; onClose: () => void }) {
  return (
    <div className="flex justify-end gap-2 border-t border-border-primary px-4 py-4 md:px-5">
      <button type="button" disabled={saving} onClick={onClose} className="inline-flex h-11 items-center justify-center rounded-xl border border-border-primary bg-bg-tertiary px-4 text-sm font-black text-text-primary disabled:opacity-60">
        Hủy
      </button>
      <button type="submit" disabled={saving} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-60">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Lưu
      </button>
    </div>
  );
}
