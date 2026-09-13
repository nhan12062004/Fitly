import { createClient } from '@supabase/supabase-js';
import { fetchWithTimeout } from './Network';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase environment variables in Frontend!');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: fetchWithTimeout } });
