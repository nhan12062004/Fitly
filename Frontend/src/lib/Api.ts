const PRODUCTION_API_URL = 'https://trendfit.onrender.com';

// In development, use Vite's /api proxy to avoid cross-origin calls from localhost.
export const API_BASE_URL = import.meta.env.DEV
  ? ''
  : import.meta.env.VITE_API_URL || PRODUCTION_API_URL;
