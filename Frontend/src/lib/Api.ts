import { supabase } from './Supabase';

const uncertainRequests = new Map<string, string>();
let keyAccount: string | null = null;
supabase.auth.onAuthStateChange((_event, session) => {
  const account = session?.user.id || null;
  if (account !== keyAccount) uncertainRequests.clear();
  keyAccount = account;
});

const PRODUCTION_API_URL = 'https://trendfit.onrender.com';

// In development, use Vite's /api proxy to avoid cross-origin calls from localhost.
export const API_BASE_URL = import.meta.env.DEV
  ? ''
  : import.meta.env.VITE_API_URL || PRODUCTION_API_URL;

export const fetchWithAuth = async (path: string, init: RequestInit = {}) => {
  const sessionRes = await supabase.auth.getSession();
  const accessToken = sessionRes.data.session?.access_token;
  if (!accessToken) {
    throw new Error('Missing access token');
  }

  const usesAi = init.method?.toUpperCase() === 'POST' && (/^\/api\/ai-coach\/generate-/.test(path) || ['/api/ai/chat', '/api/ai/coach-command'].includes(path));
  if (usesAi) {
    const userId = sessionRes.data.session!.user.id;
    const consent = await supabase.from('ai_data_consents').select('version').eq('user_id', userId).maybeSingle();
    if (consent.error) throw new Error('Chưa kiểm tra được lựa chọn quyền riêng tư. Vui lòng thử lại.');
    if (consent.data?.version !== 1) {
      const accepted = window.confirm('Cho phép Fitly gửi yêu cầu cùng dữ liệu cần thiết về mục tiêu, sức khỏe, kế hoạch và nhật ký tới Groq để tạo phản hồi AI, gồm cập nhật kế hoạch tự động theo gói? AI có thể sai và không thay thế tư vấn y tế. Bạn có thể từ chối và dùng các chức năng khác. Xem chính sách và thu hồi đồng ý trên mọi thiết bị tại trang Quyền riêng tư (/privacy).');
      if (!accepted) throw new Error('Bạn chưa đồng ý chia sẻ dữ liệu để sử dụng AI.');
      if ((await supabase.auth.getSession()).data.session?.user.id !== userId) throw new Error('Tài khoản đã thay đổi. Vui lòng thử lại.');
      const saved = await supabase.rpc('set_ai_data_consent', { p_accept: true, p_version: 1 });
      if (saved.error) throw new Error('Chưa lưu được lựa chọn quyền riêng tư. Vui lòng thử lại.');
    }
    if ((await supabase.auth.getSession()).data.session?.user.id !== userId) throw new Error('Tài khoản đã thay đổi. Vui lòng thử lại.');
  }

  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${accessToken}`);
  const durableAction = init.method?.toUpperCase() === 'POST' && (/^\/api\/ai-coach\//.test(path) || ['/api/ai/chat','/api/ai/apply-adjustment','/api/meal-plans/save','/api/meal-plans/swap'].includes(path));
  const retryIdentity = durableAction && !headers.has('Idempotency-Key')
    ? JSON.stringify([sessionRes.data.session!.user.id, path, init.body ?? null]) : null;
  if (retryIdentity) {
    const key = uncertainRequests.get(retryIdentity) || crypto.randomUUID();
    uncertainRequests.set(retryIdentity, key);
    headers.set('Idempotency-Key', key);
  } else if (init.method && !['GET','HEAD'].includes(init.method.toUpperCase()) && !headers.has('Idempotency-Key')) headers.set('Idempotency-Key',crypto.randomUUID());


  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, path === '/api/account/export' ? 60_000 : usesAi ? 45_000 : 15_000);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, signal: controller.signal });
    // Buffer JSON API responses so the deadline also covers a stalled response body.
    const body = await response.arrayBuffer();
    if (retryIdentity && (response.ok || (response.status < 500 && response.status !== 409) || response.headers.get('Idempotency-Replayed') === 'true')) uncertainRequests.delete(retryIdentity);
    return new Response(response.status === 204 || response.status === 205 || init.method === 'HEAD' ? null : body, {
      status: response.status, statusText: response.statusText, headers: response.headers,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Kết nối mất nhiều thời gian hơn dự kiến. Vui lòng thử lại.');
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
  }
};
