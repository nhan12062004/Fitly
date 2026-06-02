type AILogEvent = {
  event: string;
  intent?: string;
  actionType?: string | null;
  latencyMs?: number;
  success?: boolean;
  traceId?: string;
};

const aiMetrics = {
  totalChatRequests: 0,
  actionRequiredCount: 0,
  applyCount: 0,
  rejectCount: 0,
  errorCount: 0
};

export const logAIEvent = (payload: AILogEvent) => {
  console.log('[AI_EVENT]', JSON.stringify({
    event: payload.event,
    traceId: payload.traceId,
    intent: payload.intent,
    actionType: payload.actionType,
    latencyMs: payload.latencyMs,
    status: payload.success ? 'success' : 'failed',
  }));
};

export const incrementMetric = (key: keyof typeof aiMetrics) => {
  aiMetrics[key] += 1;
};

export const snapshotAIMetrics = () => ({ ...aiMetrics });
