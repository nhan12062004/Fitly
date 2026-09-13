import type { RequestHandler } from 'express';
import { adminSupabase } from '../../config/Supabase';
import { AppError } from '../../http/errors';

export async function hasAiDataConsent(userId: string) {
  const { data, error } = await adminSupabase.from('ai_data_consents').select('version').eq('user_id', userId).maybeSingle();
  if (error) throw new AppError(503, 'CONSENT_UNAVAILABLE', 'Chưa kiểm tra được lựa chọn quyền riêng tư. Vui lòng thử lại.');
  return data?.version === 1;
}

export const requireAiDataConsent: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.auth || !await hasAiDataConsent(req.auth.user.id)) {
      return next(new AppError(403, 'AI_CONSENT_REQUIRED', 'Bạn cần đồng ý chia sẻ dữ liệu với Groq trước khi dùng AI.'));
    }
    next();
  } catch (error) { next(error); }
};
