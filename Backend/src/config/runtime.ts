const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

export const isExplicitlyEnabled = (value: string | undefined, defaultValue = false): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return defaultValue;
};

export const isTestEnvironment = (): boolean => process.env.NODE_ENV === 'test';

export const isJobsEnabled = (): boolean =>
  !isTestEnvironment() && isExplicitlyEnabled(process.env.ENABLE_JOBS, false);

export const isTelegramEnabled = (): boolean =>
  !isTestEnvironment() && isExplicitlyEnabled(process.env.ENABLE_TELEGRAM, false);

export const isTelegramRequired = (): boolean => isExplicitlyEnabled(process.env.TELEGRAM_REQUIRED, false);

export const getBoundedTimeoutMs = (
  value: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : defaultValue;
};
