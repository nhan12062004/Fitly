import { supabase } from './Supabase';

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

  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${accessToken}`);

  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers
  });
};
