import 'react-native-url-polyfill/auto';

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createClient, processLock } from '@supabase/supabase-js';

import { isSupabaseConfigured, runtimeConfig } from '@/lib/runtime-config';
import { fetchWithTimeout } from '@/lib/network';

const secureStoreAdapter = {
  getItem: async (key: string) => Platform.OS === 'web' ? (typeof window === 'undefined' ? null : window.sessionStorage.getItem(key)) : SecureStore.getItemAsync(key),
  setItem: async (key: string, value: string) => { if (Platform.OS === 'web') window.sessionStorage.setItem(key, value); else await SecureStore.setItemAsync(key, value); },
  removeItem: async (key: string) => { if (Platform.OS === 'web') window.sessionStorage.removeItem(key); else await SecureStore.deleteItemAsync(key); },
};

// A syntactically valid fallback keeps the app bootable before local .env setup.
// Auth actions are blocked by isSupabaseConfigured, so it cannot authenticate here.
export const supabase = createClient(
  runtimeConfig.supabaseUrl ?? 'https://fitly-unconfigured.invalid',
  runtimeConfig.supabasePublishableKey ?? 'fitly-unconfigured',
  {
    global: { fetch: fetchWithTimeout },
    auth: {
      storage: secureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      lock: processLock,
    },
  },
);

export { isSupabaseConfigured };
