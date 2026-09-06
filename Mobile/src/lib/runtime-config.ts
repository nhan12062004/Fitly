const isHttpUrl = (value: string | null) => Boolean(value && /^https?:\/\/[^\s/]+(?:\/|$)/i.test(value));

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || null;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || null;
const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '') || null;

export const runtimeConfig = {
  supabaseUrl: isHttpUrl(supabaseUrl) ? supabaseUrl : null,
  supabasePublishableKey,
  apiUrl: isHttpUrl(apiUrl) ? apiUrl : null,
};

export const isSupabaseConfigured = Boolean(
  runtimeConfig.supabaseUrl && runtimeConfig.supabasePublishableKey,
);

export const isApiConfigured = Boolean(runtimeConfig.apiUrl);

export const supabaseConfigurationMessage = !supabaseUrl
  ? 'Thiếu EXPO_PUBLIC_SUPABASE_URL.'
  : !isHttpUrl(supabaseUrl)
    ? 'EXPO_PUBLIC_SUPABASE_URL phải là URL http(s) hợp lệ.'
    : !supabasePublishableKey
      ? 'Thiếu EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.'
      : null;

export const apiConfigurationMessage = !apiUrl
  ? 'Thiếu EXPO_PUBLIC_API_URL.'
  : !isHttpUrl(apiUrl)
    ? 'EXPO_PUBLIC_API_URL phải là URL http(s) hợp lệ.'
    : null;
