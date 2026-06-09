import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, ImageOff, Play, Plus, X } from 'lucide-react';
import { supabase } from '../lib/Supabase';

export interface ExerciseDetailItem {
  id: string;
  name: string;
  body_part: string;
  target_muscle: string;
  gif_url: string;
  equipment?: string;
  instructions?: string[] | string;
  technique_notes?: string[] | string;
  description?: string;
  secondary_muscles?: string[] | string;
  image_url?: string;
  imageUrl?: string;
}

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
  gif_url: string;
};

type FitnessIconProps = {
  className?: string;
};

const MuscleRegionIcon = ({ className }: FitnessIconProps) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M9.5 4.5C9.5 3.67 10.17 3 11 3h2c.83 0 1.5.67 1.5 1.5v1.05c0 .4.16.78.44 1.06l1.44 1.44c.4.4.62.94.62 1.5v2.2c0 .33.13.65.37.88l1.1 1.1c.34.34.53.8.53 1.28V19a2 2 0 0 1-2 2h-1.5a1 1 0 0 1-1-1v-3.1c0-.5-.2-.98-.55-1.34L12 13.61l-1.95 1.95c-.35.36-.55.84-.55 1.34V20a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-3.5c0-.48.19-.94.53-1.28l1.1-1.1c.24-.23.37-.55.37-.88v-2.2c0-.56.22-1.1.62-1.5l1.44-1.44c.28-.28.44-.66.44-1.06V4.5Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M9.25 9.75h5.5M9.75 18v-1.1c0-.93.37-1.82 1.03-2.47L12 13.21l1.22 1.22c.66.65 1.03 1.54 1.03 2.47V18"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const TargetMuscleIcon = ({ className }: FitnessIconProps) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="1.7" />
    <circle cx="12" cy="12" r="3.25" stroke="currentColor" strokeWidth="1.7" />
    <path d="M12 2.75v2.5M12 18.75v2.5M21.25 12h-2.5M5.25 12h-2.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="m16.25 7.75-1.8 1.8M9.55 14.45l-1.8 1.8M16.25 16.25l-1.8-1.8M9.55 9.55l-1.8-1.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const SecondaryMuscleIcon = ({ className }: FitnessIconProps) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M8.5 14.25c.76-.88 1.17-1.99 1.17-3.15V9.5c0-.83.67-1.5 1.5-1.5h.8c.33 0 .64-.13.88-.37l1.03-1.03c.48-.48 1.26-.48 1.74 0l.88.88c.3.3.48.72.48 1.16v1.11c0 .97.34 1.9.96 2.65l1.06 1.29c.5.61.77 1.38.77 2.17V17a2 2 0 0 1-2 2h-2.65c-.8 0-1.55-.32-2.12-.88l-1.18-1.18a1.5 1.5 0 0 0-1.06-.44H10.5a2 2 0 0 1-2-2v-.25Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M5 12.75h2.25a1.5 1.5 0 0 1 1.5 1.5v1.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M13.75 10.75c.7 0 1.25.55 1.25 1.25s-.55 1.25-1.25 1.25-1.25-.55-1.25-1.25.55-1.25 1.25-1.25Z" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const EquipmentIcon = ({ className }: FitnessIconProps) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path d="M3.5 9.5h2v5h-2v-5ZM18.5 9.5h2v5h-2v-5ZM7 8h2.5v8H7V8ZM14.5 8H17v8h-2.5V8Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9.5 12h5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);

const normalizeGifUrl = (value: unknown): string => {
  const url = String(value || '').trim();
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://')) return `https://${url.slice(7)}`;
  return url;
};

const toGifStorageUrl = (gifUrl: unknown, imageUrl: unknown): string => {
  const direct = normalizeGifUrl(gifUrl);
  if (direct) return direct.replace(/\.(jpg|jpeg|png|webp)(?=($|\?))/i, '.gif');

  const image = normalizeGifUrl(imageUrl);
  return image.replace(/\.(jpg|jpeg|png|webp)(?=($|\?))/i, '.gif');
};

const toTextList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  const raw = String(value || '').trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || '').trim()).filter(Boolean);
    }
  } catch {
    // ignore malformed JSON values from the database
  }

  return raw
    .split(/\r?\n|(?:\d+\.\s*)|[;•]/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const getExerciseInstructions = (exercise: ExerciseDetailItem): string[] => {
  const fromData = toTextList((exercise as any).instructions || (exercise as any).steps || (exercise as any).instruction);
  if (fromData.length > 0) return fromData;
  return ['Chưa có hướng dẫn trong cơ sở dữ liệu.'];
};

const getSecondaryMuscles = (exercise: ExerciseDetailItem): string => {
  const secondary = toTextList(exercise.secondary_muscles || (exercise as any).secondaryMuscles);
  return secondary.length > 0 ? secondary.join(', ') : 'Chưa có dữ liệu';
};

const ExerciseThumb = ({ src, alt }: { src?: string; alt: string }) => {
  const candidates = useMemo(() => {
    const primary = String(src || '').trim();
    if (!primary) return [];

    const normalized = primary.startsWith('http://') ? `https://${primary.slice(7)}` : primary;
    const urlWithoutProtocol = normalized.replace(/^https?:\/\//, '');
    const proxy = `https://images.weserv.nl/?url=${encodeURIComponent(urlWithoutProtocol)}&n=-1`;

    return [normalized, proxy];
  }, [src]);

  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [src]);

  const currentSrc = candidates[candidateIndex];

  if (!currentSrc) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg-tertiary text-text-tertiary">
        <ImageOff className="h-6 w-6" />
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      className="h-full w-full object-cover"
      onError={() => setCandidateIndex((index) => index + 1)}
    />
  );
};

export default function ExerciseDetailOverlay({
  exercise,
  isSaving = false,
  onClose,
  onAdd,
  onStartNow,
  embedded = false
}: ExerciseDetailOverlayProps) {
  const [activeExercise, setActiveExercise] = useState<ExerciseDetailItem>(exercise);
  const [relatedExercises, setRelatedExercises] = useState<RelatedExercise[]>([]);
  const [isGifModalOpen, setIsGifModalOpen] = useState(false);

  useEffect(() => {
    setActiveExercise(exercise);
  }, [exercise.id, exercise.gif_url, exercise.image_url, exercise.imageUrl]);

  useEffect(() => {
    setIsGifModalOpen(false);
  }, [activeExercise.id]);

  const instructions = getExerciseInstructions(activeExercise);
  const gifMedia = toGifStorageUrl(activeExercise.gif_url, activeExercise.image_url || activeExercise.imageUrl);
  const gifSrc = gifMedia;
  const previewImageSrc = normalizeGifUrl(activeExercise.image_url || activeExercise.imageUrl || activeExercise.gif_url);
  const metadataItems = [
    {
      key: 'body-part',
      label: 'Vùng cơ',
      value: activeExercise.body_part || 'Không rõ',
      Icon: MuscleRegionIcon
    },
    {
      key: 'target-muscle',
      label: 'Cơ chính',
      value: activeExercise.target_muscle || 'Không rõ',
      Icon: TargetMuscleIcon
    },
    {
      key: 'secondary-muscles',
      label: 'Cơ phụ',
      value: getSecondaryMuscles(activeExercise),
      Icon: SecondaryMuscleIcon
    },
    {
      key: 'equipment',
      label: 'Thiết bị',
      value: activeExercise.equipment || 'Không dụng cụ',
      Icon: EquipmentIcon
    }
  ];

  useEffect(() => {
    let cancelled = false;

    const loadRelated = async () => {
      const targetMuscle = String(activeExercise.target_muscle || '').trim();
      const bodyPart = String(activeExercise.body_part || '').trim();
      if (!targetMuscle && !bodyPart) {
        if (!cancelled) setRelatedExercises([]);
        return;
      }

      const baseSelect = 'id, name, target_muscle, body_part, gif_url, image_url';

      let rows: any[] = [];

      if (targetMuscle) {
        const byTarget = await supabase
          .from('exercises')
          .select(baseSelect)
          .neq('id', activeExercise.id)
          .eq('target_muscle', targetMuscle)
          .limit(12);
        rows = byTarget.data || [];
      }

      if (rows.length < 4 && bodyPart) {
        const byBodyPart = await supabase
          .from('exercises')
          .select(baseSelect)
          .neq('id', activeExercise.id)
          .eq('body_part', bodyPart)
          .limit(12);
        const more = byBodyPart.data || [];
        const seen = new Set(rows.map((row) => String(row.id)));
        for (const item of more) {
          const id = String(item.id);
          if (!seen.has(id)) {
            rows.push(item);
            seen.add(id);
          }
        }
      }

      if (rows.length === 0) {
        const anyRows = await supabase
          .from('exercises')
          .select(baseSelect)
          .neq('id', activeExercise.id)
          .limit(12);
        rows = anyRows.data || [];
      }

      if (cancelled) return;

      const mapped = rows.map((item: any) => ({
        id: String(item.id),
        name: String(item.name || 'Bài tập'),
        primaryMuscle: String(item.target_muscle || item.body_part || 'Cơ chính'),
        gif_url: normalizeGifUrl(item.image_url || item.gif_url || '')
      }));

      setRelatedExercises(mapped);
    };

    loadRelated();

    return () => {
      cancelled = true;
    };
  }, [activeExercise.id, activeExercise.target_muscle, activeExercise.body_part]);

  const loadExerciseDetailById = async (exerciseId: string) => {
    const { data } = await supabase
      .from('exercises')
      .select('id, name, target_muscle, body_part, gif_url, image_url, equipment, instructions, secondary_muscles')
      .eq('id', exerciseId)
      .maybeSingle();

    if (!data) return;

    setActiveExercise({
      id: String(data.id),
      name: String(data.name || 'Bài tập'),
      target_muscle: String(data.target_muscle || ''),
      body_part: String(data.body_part || ''),
      gif_url: normalizeGifUrl(data.gif_url || ''),
      image_url: normalizeGifUrl(data.image_url || ''),
      equipment: String(data.equipment || ''),
      instructions: data.instructions || [],
      secondary_muscles: data.secondary_muscles || [],
      description: ''
    });
  };

  return (
    <div className={embedded ? 'h-full w-full overflow-y-auto custom-scrollbar' : 'fixed inset-0 z-[130] overflow-y-auto bg-bg-primary'}>
      <div className={embedded ? 'mx-auto w-full max-w-[1700px] px-0 py-0' : 'mx-auto min-h-screen w-full max-w-[1700px] px-4 py-4 md:px-6 md:py-6'}>
        <div className="-mt-1 mb-3 flex items-center gap-2 text-sm text-text-tertiary">
          <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 hover:text-text-primary">
            <ArrowLeft className="h-4 w-4" />
            Bài tập
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-border-primary bg-bg-secondary/85 p-3 md:p-4 lg:p-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.94fr)_minmax(360px,1.06fr)] lg:items-stretch lg:gap-6">
              <div className="relative overflow-hidden rounded-2xl border border-border-primary/70 bg-[#f8f6f1] p-3 sm:p-4">
                <button
                  type="button"
                  onClick={() => setIsGifModalOpen(true)}
                  className="absolute right-3 top-3 z-10 inline-flex h-8 items-center gap-1.5 rounded-full border border-border-primary bg-bg-secondary/90 px-3 text-xs font-semibold text-text-primary backdrop-blur-sm"
                >
                  <Play className="h-3.5 w-3.5" />
                  Xem GIF
                </button>
                {previewImageSrc ? (
                  <img
                    key={previewImageSrc}
                    src={previewImageSrc}
                    alt={activeExercise.name}
                    className="h-[180px] w-full object-contain sm:h-[220px] lg:h-[260px]"
                    referrerPolicy="no-referrer"
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
                    {metadataItems.map(({ key, label, value, Icon }) => (
                      <div
                        key={key}
                        className="flex items-start gap-3 rounded-xl border border-border-primary/70 bg-bg-tertiary/20 px-3.5 py-3"
                      >
                        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-text-tertiary">
                            {label}
                          </p>
                          <p className="mt-1 text-sm font-semibold leading-5 text-text-primary sm:text-[15px]">
                            {value}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:mt-5">
                  <button
                    type="button"
                    onClick={() => onStartNow?.(activeExercise)}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-black text-black hover:bg-accent-hover"
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
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.95fr]">
            <div className="rounded-xl border border-border-primary bg-bg-secondary/85 p-4 md:p-5">
              <h3 className="text-2xl font-bold text-text-primary">Hướng dẫn thực hiện</h3>
              <ol className="mt-4 space-y-3">
                {instructions.map((step, index) => (
                  <li
                    key={`${step}-${index}`}
                    className="flex gap-2.5 border-b border-border-primary/60 pb-2.5 text-sm leading-relaxed text-text-secondary last:border-b-0 last:pb-0"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-black text-black">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-xl border border-border-primary bg-bg-secondary/85 p-4 md:p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-2xl font-bold text-text-primary">Bài tập liên quan</h3>
              </div>
              <div className="space-y-2">
                {relatedExercises.slice(0, 4).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => loadExerciseDetailById(item.id)}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-border-primary bg-bg-secondary px-2.5 py-2 text-left hover:border-border-secondary"
                  >
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border-primary bg-bg-tertiary">
                      <ExerciseThumb src={item.gif_url || activeExercise.image_url || activeExercise.imageUrl} alt={item.name} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold text-text-primary">{item.name}</p>
                      <p className="mt-0.5 truncate text-[11px] text-text-tertiary">Cơ chính: {item.primaryMuscle}</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-text-tertiary" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {isGifModalOpen && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
          onClick={() => setIsGifModalOpen(false)}
        >
          <div
            className="relative inline-block max-w-[calc(100vw-2rem)] overflow-visible rounded-2xl border border-border-primary bg-[#0b0b0b] p-2"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setIsGifModalOpen(false)}
              className="absolute right-0 top-0 z-10 inline-flex h-8 w-8 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white hover:bg-black/85"
            >
              <X className="h-4 w-4" />
            </button>
            {gifSrc ? (
              <img
                src={gifSrc}
                alt={`${activeExercise.name} gif`}
                className="block h-auto w-[min(64vw,560px)] max-h-[62vh] rounded-xl object-contain"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-[280px] w-[320px] max-w-[calc(100vw-4rem)] items-center justify-center rounded-lg text-text-tertiary">
                <ImageOff className="h-6 w-6" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
