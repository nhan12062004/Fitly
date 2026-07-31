import 'react-native-url-polyfill/auto';

import * as SecureStore from 'expo-secure-store';
import { createClient, processLock } from '@supabase/supabase-js';

import { isSupabaseConfigured, runtimeConfig } from '@/lib/runtime-config';

const secureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

// A syntactically valid fallback keeps the app bootable before local .env setup.
// Auth actions are blocked by isSupabaseConfigured, so it cannot authenticate here.
export const supabase = createClient(
  runtimeConfig.supabaseUrl ?? 'https://fitly-unconfigured.invalid',
  runtimeConfig.supabasePublishableKey ?? 'fitly-unconfigured',
  {
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
