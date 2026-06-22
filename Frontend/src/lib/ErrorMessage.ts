const DEFAULT_ERROR_MESSAGE = 'Có lỗi xảy ra. Vui lòng thử lại sau.';
const DEFAULT_API_ERROR_MESSAGE = 'Máy chủ đang tạm thời không sẵn sàng. Vui lòng thử lại sau.';

const HTML_PATTERN = /(?:<!doctype\s+html|<html\b|<head\b|<body\b|<\/?[a-z][\s\S]*>)/i;

export const isHtmlLikeMessage = (value: unknown): boolean => {
  return typeof value === 'string' && HTML_PATTERN.test(value);
};

const isRenderSuspendedMessage = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const normalized = value.toLowerCase();
  return normalized.includes('service suspended') || normalized.includes('service has been suspended');
};

const normalizePlainMessage = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
};

export const sanitizeErrorMessage = (
  value: unknown,
  fallback = DEFAULT_ERROR_MESSAGE
): string => {
  const normalized = normalizePlainMessage(value);
  if (!normalized) return fallback;

  if (isRenderSuspendedMessage(normalized)) {
    return 'Dịch vụ backend đang bị tạm ngưng. Vui lòng kiểm tra deploy hoặc thử lại sau.';
  }

  if (isHtmlLikeMessage(normalized)) {
    return DEFAULT_API_ERROR_MESSAGE;
  }

  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
};

export const getApiErrorMessage = ({
  status,
  payload,
  responseText,
  fallbackMessage = DEFAULT_API_ERROR_MESSAGE,
  fallbackByStatus = {}
}: {
  status?: number;
  payload?: any;
  responseText?: string;
  fallbackMessage?: string;
  fallbackByStatus?: Record<number, string>;
}) => {
  const payloadCandidates = [
    payload?.error,
    payload?.message,
  ];

  for (const candidate of payloadCandidates) {
    if (isRenderSuspendedMessage(candidate)) {
      return sanitizeErrorMessage(candidate, fallbackMessage);
    }

    const message = normalizePlainMessage(candidate);
    if (message && !isHtmlLikeMessage(message)) {
      return sanitizeErrorMessage(message, fallbackMessage);
    }
  }

  if (isRenderSuspendedMessage(responseText)) {
    return sanitizeErrorMessage(responseText, fallbackMessage);
  }

  const responseMessage = normalizePlainMessage(responseText);
  if (responseMessage && !isHtmlLikeMessage(responseMessage)) {
    return sanitizeErrorMessage(responseMessage, fallbackMessage);
  }

  const fallbackCandidates = [
    status ? fallbackByStatus[status] : undefined,
    status ? `${fallbackMessage} (HTTP ${status})` : fallbackMessage
  ];

  for (const candidate of fallbackCandidates) {
    const message = sanitizeErrorMessage(candidate, '');
    if (message) return message;
  }

  return fallbackMessage;
};
