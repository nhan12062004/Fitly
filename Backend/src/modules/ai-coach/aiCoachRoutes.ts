import { resolveAdjustmentQuota, type AiQuotaKey } from '../../services/ai/aiOperationService';
import type { Request } from 'express';
import { requireAdmin, requireAuth } from '../../auth/middleware';
import { requireAiDataConsent } from '../../services/ai/aiConsentService';
import type { Express, RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { validateBody } from '../../http/validation';

type AiCoachRouteDependencies = {
  withAiOperation: (handler: RequestHandler, quota: AiQuotaKey | null | ((req: Request) => Promise<AiQuotaKey>)) => RequestHandler;
  aiLimiter: RequestHandler;
  aiChatSchema: ZodType;
  getQuota: RequestHandler;
  chat: RequestHandler;
  coachCommand: RequestHandler;
  clearChat: RequestHandler;
  applyAdjustment: RequestHandler;
  rejectAdjustment: RequestHandler;
  metrics: RequestHandler;
  generateDailyWorkout: RequestHandler;
  generateWeeklyPlan: RequestHandler;
  generateMealPlan: RequestHandler;
  recordMealSwap: RequestHandler;
  generateOnboardingMealPlan: RequestHandler;
};

/** Centralizes AI Coach endpoint policy without changing handler contracts. */
export const registerAiCoachRoutes = (app: Express, dependencies: AiCoachRouteDependencies) => {
  const {
    aiLimiter,
    withAiOperation,
    aiChatSchema,
    getQuota,
    chat,
    coachCommand,
    clearChat,
    applyAdjustment,
    rejectAdjustment,
    metrics,
    generateDailyWorkout,
    generateWeeklyPlan,
    generateMealPlan,
    recordMealSwap,
    generateOnboardingMealPlan,
  } = dependencies;

  app.get('/api/ai/quota', aiLimiter, getQuota);
  app.post('/api/ai/chat', aiLimiter, validateBody(aiChatSchema), requireAuth, requireAiDataConsent, withAiOperation(chat, 'chatMessages'));
  app.post('/api/ai/coach-command', aiLimiter, requireAuth, requireAiDataConsent, coachCommand);
  app.post('/api/ai/chat/clear', aiLimiter, requireAuth, clearChat);
  app.post('/api/ai/apply-adjustment', aiLimiter, withAiOperation(applyAdjustment, resolveAdjustmentQuota));
  app.post('/api/ai/reject-adjustment', aiLimiter, rejectAdjustment);
  app.get('/api/ai/metrics', requireAdmin, metrics);
  app.post('/api/ai-coach/generate-daily-workout', aiLimiter, requireAuth, requireAiDataConsent, withAiOperation(generateDailyWorkout, 'planGenerations'));
  app.post('/api/ai-coach/generate-weekly-plan', aiLimiter, requireAuth, requireAiDataConsent, withAiOperation(generateWeeklyPlan, 'planGenerations'));
  app.post('/api/ai-coach/generate-meal-plan', aiLimiter, requireAuth, requireAiDataConsent, withAiOperation(generateMealPlan, 'mealAdjustments'));
  app.post('/api/ai-coach/record-meal-swap', recordMealSwap);
  app.post('/api/ai-coach/generate-onboarding-meal-plan', aiLimiter, requireAuth, requireAiDataConsent, withAiOperation(generateOnboardingMealPlan, null));
};
