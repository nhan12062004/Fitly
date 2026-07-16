import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Dumbbell,
  ImageOff,
  Play,
  Plus,
  X,
} from 'lucide-react';
import { supabase } from '../lib/Supabase';
import {
  EXERCISE_LABELS,
  formatDifficultyLabel,
  formatExperienceRequirement,
  formatTrainingLocations,
  normalizeBodyPart,
  normalizeEquipment,
  normalizeExercise,
  normalizeGoalType,
  normalizeMovementPattern,
  type ExerciseInstructions,
} from '../lib/exerciseCatalog';

export type ExerciseDetailItem = {
  id: string;
  name: string;
  body_part?: string | null;
  target_muscle?: string | null;
  video_url?: string | null;
  equipment?: string | null;
  instructions?: unknown;
  technique_notes?: unknown;
  description?: string;
  secondary_muscles?: unknown;
  training_locations?: unknown;
  difficulty?: string | null;
  min_experience_months?: number | null;
  progression_level?: number | null;
  movement_pattern?: string | null;
  goal_type?: unknown;
  contraindications?: unknown;
  estimated_duration_seconds?: number | null;
  calories_per_minute?: number | null;
};

interface ExerciseDetailOverlayProps {
  exercise: ExerciseDetailItem;
  isSaving?: boolean;
  onClose: () => void;
  onAdd: (exercise: ExerciseDetailItem) => void;
  onStartNow?: (exercise: ExerciseDetailItem) => void;
  embedded?: boolean;
}

type RelatedExercise = {
  id: string;
  name: string;
  primaryMuscle: string;
  videoUrl: string;
};

type VariationExercise = {
  id: string;
  name: string;
};

const GOAL_LABELS: Record<string, string> = {
  general_fitness: 'Thể lực tổng quát',
  weight_loss: 'Giảm mỡ',
  muscle_gain: 'Tăng cơ',
  strength: 'Sức mạnh',
  endurance: 'Sức bền',
  mobility: 'Linh hoạt',
  recovery: 'Phục hồi',
};

const normalizeMediaUrl = (value: unknown): string => {
  const url = String(value || '').trim();
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://')) return `https://${url.slice(7)}`;
  return url;
};

const formatDuration = (seconds: number | null): string | null => {
  if (!seconds || seconds <= 0) return null;
  const minutes = Math.round(seconds / 60);
  return minutes > 0 ? `${minutes} phút` : `${seconds} giây`;
};

const bodyPartLabel = (value: unknown): string | null => {
  const bodyPart = normalizeBodyPart(value);
  return bodyPart ? EXERCISE_LABELS.bodyPart[bodyPart] : null;
};

const equipmentLabel = (value: unknown): string | null => {
  const equipment = normalizeEquipment(value);
  return equipment ? EXERCISE_LABELS.equipment[equipment] : null;
};

const movementPatternLabel = (value: unknown): string | null => {
  const pattern = normalizeMovementPattern(value);
  return pattern ? EXERCISE_LABELS.movementPattern[pattern] : null;
};

const goalLabels = (values: string[]): string[] => values
  .map((value) => normalizeGoalType(value))
  .filter((value): value is NonNullable<ReturnType<typeof normalizeGoalType>> => value !== null)
  .map((value) => GOAL_LABELS[value])
  .filter(Boolean);

const secondaryMuscleLabels = (values: string[]): string[] => values
  .map(bodyPartLabel)
  .filter((value): value is string => Boolean(value));

export const toExerciseDetailItem = (
  value: unknown,
  fallback: Partial<ExerciseDetailItem> = {},
): ExerciseDetailItem => {
  const normalized = normalizeExercise(value);
  return {
    ...fallback,
    ...normalized,
    id: normalized.id || fallback.id || '',
    name: normalized.name || fallback.name || 'Bài tập',
    body_part: normalized.body_part ?? fallback.body_part ?? null,
    target_muscle: normalized.target_muscle ?? fallback.target_muscle ?? null,
    equipment: normalized.equipment ?? fallback.equipment ?? null,
    video_url: normalizeMediaUrl(normalized.video_url ?? fallback.video_url ?? ''),
    description: fallback.description || '',
  };
};

const ExerciseThumb = ({ src, alt }: { src?: string | null; alt: string }) => {
  const videoUrl = normalizeMediaUrl(src);
  if (!videoUrl) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg-tertiary text-text-tertiary">
        <ImageOff className="h-6 w-6" />
      </div>
    );
  }

  return (
    <video
      src={videoUrl}
      aria-label={alt}
      className="h-full w-full object-cover"
      autoPlay muted loop playsInline preload="metadata"
    />
  );
};

function InstructionSection({
  title,
  items,
  ordered = false,
  tone = 'text-text-secondary',
}: {
  title: string;
  items: string[];
  ordered?: boolean;
  tone?: string;
}) {
  if (items.length === 0) return null;

  return (
    <section className="rounded-xl border border-border-primary bg-bg-secondary/85 p-4 md:p-5">
      <h3 className="text-lg font-black text-text-primary">{title}</h3>
      {ordered ? (
        <ol className="mt-3 space-y-3">
          {items.map((item, index) => (
            <li key={`${item}-${index}`} className={`flex gap-2.5 text-sm leading-relaxed ${tone}`}>
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-black text-text-inverse">
                {index + 1}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      ) : (
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-text-secondary">
          {items.map((item, index) => (
            <li key={`${item}-${index}`} className="flex gap-2.5">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function ExerciseDetailOverlay({
  exercise,
  isSaving = false,
  onClose,
  onAdd,
  onStartNow,
  embedded = false,
}: ExerciseDetailOverlayProps) {
  const [activeExercise, setActiveExercise] = useState<ExerciseDetailItem>(() => toExerciseDetailItem(exercise));
  const [relatedExercises, setRelatedExercises] = useState<RelatedExercise[]>([]);
  const [variationExercises, setVariationExercises] = useState<Record<string, VariationExercise>>({});
  const [isGifModalOpen, setIsGifModalOpen] = useState(false);

  useEffect(() => {
    setActiveExercise(toExerciseDetailItem(exercise));
  }, [exercise.id, exercise.name, exercise.video_url]);

  useEffect(() => {
    setIsGifModalOpen(false);
  }, [activeExercise.id]);

  const normalizedExercise = useMemo(() => normalizeExercise(activeExercise), [activeExercise]);
  const instructions: ExerciseInstructions = normalizedExercise.instructions;
  const videoSrc = normalizeMediaUrl(normalizedExercise.video_url);
  const locations = formatTrainingLocations(normalizedExercise.training_locations);
  const secondaryMuscles = secondaryMuscleLabels(normalizedExercise.secondary_muscles);
  const goals = goalLabels(normalizedExercise.goal_type);
  const contraindications = normalizedExercise.contraindications;
  const variationIds = [instructions.easier_variation_id, instructions.harder_variation_id]
    .filter((id): id is string => Boolean(id));

  const metadataItems = [
    { key: 'body-part', label: 'Nhóm cơ', value: bodyPartLabel(normalizedExercise.body_part) },
    { key: 'target-muscle', label: 'Cơ chính', value: bodyPartLabel(normalizedExercise.target_muscle) },
    { key: 'secondary-muscles', label: 'Cơ phụ', value: secondaryMuscles.join(', ') || null },
    { key: 'equipment', label: 'Dụng cụ', value: equipmentLabel(normalizedExercise.equipment) },
    { key: 'locations', label: 'Nơi tập phù hợp', value: locations },
    { key: 'difficulty', label: 'Độ khó', value: formatDifficultyLabel(normalizedExercise.difficulty) },
    { key: 'experience', label: 'Kinh nghiệm tối thiểu', value: formatExperienceRequirement(normalizedExercise.min_experience_months) },
    { key: 'progression', label: 'Cấp độ progression', value: `Cấp ${normalizedExercise.progression_level}/5` },
    { key: 'pattern', label: 'Mẫu chuyển động', value: movementPatternLabel(normalizedExercise.movement_pattern) },
    { key: 'goals', label: 'Mục tiêu', value: goals.join(', ') || null },
    { key: 'duration', label: 'Thời lượng ước tính', value: formatDuration(normalizedExercise.estimated_duration_seconds) },
    {
      key: 'calories',
      label: 'Calories/phút',
      value: normalizedExercise.calories_per_minute === null ? null : `${normalizedExercise.calories_per_minute} kcal`,
    },
  ].filter((item): item is { key: string; label: string; value: string } => Boolean(item.value));

  useEffect(() => {
    let cancelled = false;
    const loadVariations = async () => {
      if (variationIds.length === 0) {
        if (!cancelled) setVariationExercises({});
        return;
      }

      const { data } = await supabase
        .from('exercises')
        .select('id, name')
        .in('id', variationIds);
      if (cancelled) return;

      const next: Record<string, VariationExercise> = {};
      for (const row of Array.isArray(data) ? data : []) {
        const item = toExerciseDetailItem(row);
        if (item.id) next[item.id] = { id: item.id, name: item.name };
      }
      setVariationExercises(next);
    };

    void loadVariations();
    return () => {
      cancelled = true;
    };
  }, [activeExercise.id, instructions.easier_variation_id, instructions.harder_variation_id]);

  useEffect(() => {
    let cancelled = false;
    const loadRelated = async () => {
      const targetMuscle = String(activeExercise.target_muscle || '').trim();
      const bodyPart = String(activeExercise.body_part || '').trim();
      if (!targetMuscle && !bodyPart) {
        if (!cancelled) setRelatedExercises([]);
        return;
      }

      const fields = 'id, name, target_muscle, body_part, video_url';
      let rows: unknown[] = [];
      if (targetMuscle) {
        const { data } = await supabase
          .from('exercises')
          .select(fields)
          .neq('id', activeExercise.id)
          .eq('target_muscle', targetMuscle)
          .limit(12);
        rows = Array.isArray(data) ? data : [];
      }
      if (rows.length < 4 && bodyPart) {
        const { data } = await supabase
          .from('exercises')
          .select(fields)
          .neq('id', activeExercise.id)
          .eq('body_part', bodyPart)
          .limit(12);
        const seen = new Set(rows.map((row) => toExerciseDetailItem(row).id));
        for (const row of Array.isArray(data) ? data : []) {
          const id = toExerciseDetailItem(row).id;
          if (id && !seen.has(id)) {
            rows.push(row);
            seen.add(id);
          }
        }
      }
      if (rows.length === 0) {
        const { data } = await supabase
          .from('exercises')
          .select(fields)
          .neq('id', activeExercise.id)
          .limit(12);
        rows = Array.isArray(data) ? data : [];
      }
      if (cancelled) return;

      setRelatedExercises(rows.map((row) => {
        const item = toExerciseDetailItem(row);
        return {
          id: item.id,
          name: item.name,
          primaryMuscle: bodyPartLabel(item.target_muscle) || bodyPartLabel(item.body_part) || 'Cơ chính',
          videoUrl: normalizeMediaUrl(item.video_url),
        };
      }).filter((item) => Boolean(item.id)));
    };

    void loadRelated();
    return () => {
      cancelled = true;
    };
  }, [activeExercise.id, activeExercise.target_muscle, activeExercise.body_part]);

  const loadExerciseDetailById = async (exerciseId: string) => {
    const { data } = await supabase
      .from('exercises')
      .select('*')
      .eq('id', exerciseId)
      .maybeSingle();
    if (data) setActiveExercise(toExerciseDetailItem(data));
  };

  const linkedVariations = [
    { key: 'easier', label: 'Bài dễ hơn', id: instructions.easier_variation_id },
    { key: 'harder', label: 'Bài khó hơn', id: instructions.harder_variation_id },
  ].flatMap((variation) => {
    const resolved = variation.id ? variationExercises[variation.id] : null;
    return resolved ? [{ ...variation, exercise: resolved }] : [];
  });

  return (
    <div className={embedded ? 'h-full w-full overflow-y-auto custom-scrollbar' : 'fixed inset-0 z-[130] overflow-y-auto bg-bg-primary'}>
      <div className={embedded ? 'mx-auto w-full max-w-[1700px] px-0 py-0' : 'mx-auto min-h-[100dvh] w-full max-w-[1700px] px-4 py-4 md:px-6 md:py-6'}>
        <div className="-mt-1 mb-3 flex items-center gap-2 text-sm text-text-tertiary">
          <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 hover:text-text-primary">
            <ArrowLeft className="h-4 w-4" />
            Bài tập
          </button>
        </div>

        <div className="space-y-4">
          <section className="rounded-2xl border border-border-primary bg-bg-secondary/85 p-3 md:p-4 lg:p-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.94fr)_minmax(360px,1.06fr)] lg:items-stretch lg:gap-6">
              <div className="themed-image-surface relative overflow-hidden rounded-2xl border border-border-primary/70 p-3 sm:p-4">
                <button
                  type="button"
                  onClick={() => setIsGifModalOpen(true)}
                  disabled={!videoSrc}
                  className="absolute right-3 top-3 z-10 inline-flex h-8 items-center gap-1.5 rounded-full border border-border-primary bg-bg-secondary/90 px-3 text-xs font-semibold text-text-primary backdrop-blur-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  Xem video
                </button>
                {videoSrc ? (
                  <video
                    key={videoSrc}
                    src={videoSrc}
                    aria-label={activeExercise.name}
                    className="h-[180px] w-full object-contain sm:h-[220px] lg:h-[260px]"
                    autoPlay muted loop playsInline preload="metadata"
                  />
                ) : (
                  <div className="flex h-[180px] w-full items-center justify-center text-text-tertiary sm:h-[220px] lg:h-[260px]">
                    <ImageOff className="h-6 w-6" />
                  </div>
                )}
              </div>

              <div className="flex flex-col justify-between">
                <div>
                  <h2 className="text-[1.7rem] font-bold leading-tight text-text-primary sm:text-[2rem] lg:text-[2.35rem]">
                    {activeExercise.name}
                  </h2>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:mt-5">
                    {metadataItems.map(({ key, label, value }) => (
                      <div key={key} className="rounded-xl border border-border-primary/70 bg-bg-tertiary/20 px-3.5 py-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.12em] text-text-tertiary">{label}</p>
                        <p className="mt-1 text-sm font-semibold leading-5 text-text-primary sm:text-[15px]">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:mt-5">
                  <button
                    type="button"
                    onClick={() => onStartNow?.(activeExercise)}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-black text-text-inverse hover:bg-accent-hover"
                  >
                    <Play className="h-4 w-4" />
                    Bắt đầu ngay
                  </button>
                  <button
                    type="button"
                    onClick={() => onAdd(activeExercise)}
                    disabled={isSaving}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border-primary bg-bg-secondary px-5 text-sm font-bold text-text-primary hover:border-border-secondary disabled:opacity-60"
                  >
                    <Plus className="h-4 w-4" />
                    Thêm vào buổi tập
                  </button>
                </div>
              </div>
            </div>
          </section>

          {contraindications.length > 0 ? (
            <section className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-text-primary md:p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                <div>
                  <h3 className="font-black">Cảnh báo / chống chỉ định</h3>
                  <ul className="mt-2 space-y-1.5 text-text-secondary">
                    {contraindications.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                  </ul>
                </div>
              </div>
            </section>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <InstructionSection title="Chuẩn bị" items={instructions.setup} />
            <InstructionSection title="Các bước thực hiện" items={instructions.steps} ordered />
            <InstructionSection title="Nhịp thở" items={instructions.breathing} />
            <InstructionSection title="Coaching cues" items={instructions.coaching_cues} />
            <InstructionSection title="Lỗi thường gặp" items={instructions.common_mistakes} />
            {linkedVariations.length > 0 ? (
              <section className="rounded-xl border border-border-primary bg-bg-secondary/85 p-4 md:p-5">
                <h3 className="text-lg font-black text-text-primary">Biến thể progression</h3>
                <div className="mt-3 space-y-2">
                  {linkedVariations.map((variation) => (
                    <button
                      key={variation.key}
                      type="button"
                      onClick={() => void loadExerciseDetailById(variation.exercise.id)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-border-primary bg-bg-tertiary/35 px-3 py-3 text-left transition-colors hover:border-accent/40"
                    >
                      <span>
                        <span className="block text-[11px] font-black uppercase tracking-[0.12em] text-text-tertiary">{variation.label}</span>
                        <span className="mt-1 block font-bold text-text-primary">{variation.exercise.name}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-text-tertiary" />
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <section className="rounded-xl border border-border-primary bg-bg-secondary/85 p-4 md:p-5">
            <div className="mb-3 flex items-center gap-2">
              <Dumbbell className="h-5 w-5 text-accent" />
              <h3 className="text-xl font-black text-text-primary">Bài tập liên quan</h3>
            </div>
            {relatedExercises.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {relatedExercises.slice(0, 4).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void loadExerciseDetailById(item.id)}
                    className="flex items-center gap-2.5 rounded-lg border border-border-primary bg-bg-secondary px-2.5 py-2 text-left hover:border-border-secondary"
                  >
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border-primary bg-bg-tertiary">
                      <ExerciseThumb src={item.videoUrl} alt={item.name} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold text-text-primary">{item.name}</p>
                      <p className="mt-0.5 truncate text-[11px] text-text-tertiary">Cơ chính: {item.primaryMuscle}</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-text-tertiary" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-secondary">Chưa có bài tập liên quan trong catalog.</p>
            )}
          </section>
        </div>
      </div>

      {isGifModalOpen && videoSrc ? (
        <div className="themed-modal-backdrop fixed inset-0 z-[220] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setIsGifModalOpen(false)}>
          <div className="relative inline-block max-w-[calc(100vw-2rem)] overflow-visible rounded-2xl border border-border-primary bg-bg-secondary p-2" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => setIsGifModalOpen(false)}
              className="absolute right-0 top-0 z-10 inline-flex h-8 w-8 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border-primary bg-bg-secondary/90 text-text-primary hover:bg-bg-tertiary"
              aria-label="Đóng GIF"
            >
              <X className="h-4 w-4" />
            </button>
            <video src={videoSrc} aria-label={`${activeExercise.name} video`} className="block h-auto w-[min(64vw,560px)] max-h-[62vh] rounded-xl object-contain" autoPlay muted loop controls playsInline />
          </div>
        </div>
      ) : null}
    </div>
  );
}
