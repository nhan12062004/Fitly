export const MOTIVATION_OPTIONS = [
  'Giảm cân',
  'Mặc đồ đẹp hơn',
  'Tăng cơ',
  'Cải thiện sức khỏe',
  'Tự tin hơn',
  'Ngủ tốt hơn',
  'Giảm stress',
  'Chuẩn bị sự kiện',
] as const;

export type MotivationOption = (typeof MOTIVATION_OPTIONS)[number];

export const DEFAULT_MOTIVATION: MotivationOption = 'Giảm cân';

const LEGACY_MOTIVATION_MAP: Record<string, MotivationOption> = {
  'Để mặc quần áo đẹp': 'Mặc đồ đẹp hơn',
  'Mặc quần áo đẹp': 'Mặc đồ đẹp hơn',
};

export function normalizeMotivation(raw: string | undefined | null): MotivationOption {
  const value = String(raw ?? '').trim();
  if (!value) return DEFAULT_MOTIVATION;
  if (LEGACY_MOTIVATION_MAP[value]) return LEGACY_MOTIVATION_MAP[value];
  if ((MOTIVATION_OPTIONS as readonly string[]).includes(value)) return value as MotivationOption;
  return DEFAULT_MOTIVATION;
}
