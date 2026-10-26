import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../../auth/middleware';
import { AppError, ExternalProviderError } from '../../http/errors';

export const privacyRouter = Router();
const limit = rateLimit({ windowMs: 60 * 60_000, limit: 2, keyGenerator: (req) => req.auth!.user.id, standardHeaders: true, legacyHeaders: false });
let activeExports = 0;
privacyRouter.get('/account/export', requireAuth, limit, async (req, res, next) => {
  if (activeExports >= 2) return next(new AppError(503,'EXPORT_BUSY','Hệ thống đang chuẩn bị dữ liệu cho yêu cầu khác. Hãy thử lại sau ít phút.'));
  activeExports += 1;
  const controller = new AbortController();
  let released = false;
  const release = () => { if (!released) { released = true; activeExports -= 1; } };
  res.once('finish',release);
  res.once('close',() => { controller.abort(); release(); });
  const userId = req.auth!.user.id;
  const client = req.supabase!;
  let bytes = 0;
  try {
    const output: Record<string, unknown> = { exportedAt: new Date().toISOString(), formatVersion: 1 };
    const tables = [
      ['profiles','id','id'], ['body_metrics','user_id','id'], ['lifestyle_settings','user_id','user_id'], ['health_conditions','user_id','user_id'],
      ['daily_progress_logs','user_id','id'], ['daily_exercise_sessions','user_id','id'], ['daily_workout_sessions','user_id','id'],
      ['daily_meal_logs','user_id','id'], ['weekly_plans','user_id','id'], ['weekly_food_plans','user_id','id'],
      ['ai_chat_messages','user_id','id'], ['ai_plan_adjustments','user_id','id'], ['user_custom_foods','user_id','id'],
      ['ai_data_consents','user_id','user_id'], ['ai_consent_events','user_id','id'], ['user_notifications','user_id','id'],
      ['challenge_participants','user_id','id'], ['challenge_checkins','user_id','id'], ['user_blocks','blocker_id','blocked_id'],
      ['store_entitlements','user_id','user_id'],
    ];
    const read = async (table: string, filter: string, order: string) => {
      const rows: unknown[] = [];
      for (let offset = 0; offset < 10_000; offset += 500) {
        const result = await client.from(table).select('*').eq(filter,userId).order(order).range(offset,offset+499).abortSignal(controller.signal);
        if (result.error) throw new ExternalProviderError();
        bytes += Buffer.byteLength(JSON.stringify(result.data));
        if (bytes > 20 * 1024 * 1024) throw new AppError(413,'EXPORT_TOO_LARGE','Dữ liệu quá lớn để tải trực tiếp. Hãy gửi yêu cầu hỗ trợ xuất dữ liệu.');
        rows.push(...(result.data || []));
        if ((result.data?.length || 0) < 500) return rows;
      }
      throw new AppError(413,'EXPORT_TOO_LARGE','Hãy liên hệ hỗ trợ để xuất đầy đủ dữ liệu lịch sử.');
    };
    // Sequential reads bound DB fan-out and memory per export. RLS also applies
    // to child tables, so no caller-supplied IDs or service-role reads are used.
    for (const [table,filter,order] of tables) output[table] = await read(table,filter,order);
    const children = [
      ['weekly_plan_exercises','weekly_plan_id','weekly_plans'], ['weekly_food_items','food_plan_id','weekly_food_plans'],
      ['daily_workout_session_exercises','session_id','daily_workout_sessions'], ['daily_exercise_set_logs','daily_exercise_session_id','daily_exercise_sessions'],
    ];
    for (const [table,foreign,parent] of children) {
      const ids = (output[parent] as Array<{ id: string }>).map((row) => row.id);
      const rows: unknown[] = [];
      for (let offset = 0; offset < ids.length; offset += 20) {
        const result = await client.from(table).select('*').in(foreign,ids.slice(offset,offset+20)).order('id').limit(1000).abortSignal(controller.signal);
        if (result.error) throw new ExternalProviderError();
        if (result.data?.length === 1000) throw new AppError(413,'EXPORT_TOO_LARGE','Hãy liên hệ hỗ trợ để xuất đầy đủ dữ liệu lịch sử.');
        bytes += Buffer.byteLength(JSON.stringify(result.data));
        if (bytes > 20 * 1024 * 1024) throw new AppError(413,'EXPORT_TOO_LARGE','Dữ liệu quá lớn để tải trực tiếp. Hãy gửi yêu cầu hỗ trợ.');
        rows.push(...(result.data || []));
      }
      output[table] = rows;
    }
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Content-Disposition','attachment; filename="fitly-personal-data.json"');
    return res.json(output);
  } catch (error) { release(); if (!controller.signal.aborted) return next(error); }
});
