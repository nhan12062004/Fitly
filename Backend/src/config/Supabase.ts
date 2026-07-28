import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({
  // Keep deployment's Backend/.env as the primary source, while supporting
  // the existing local Backend/src/.env file regardless of the launch cwd.
  path: [
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../.env'),
  ],
});

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';

const serverAuthOptions = {
  autoRefreshToken: false,
  persistSession: false,
  detectSessionInUrl: false,
};

// Do not prevent the liveness/readiness endpoints from loading when a
// deployment is misconfigured. /ready reports missing configuration before
// issuing a database query, so these inert values are never used by a ready
// process.
export const adminSupabase = createClient(
  supabaseUrl || 'http://localhost:54321',
  supabaseServiceRoleKey || 'missing-supabase-service-role-key',
  { auth: serverAuthOptions },
);

export const hasUserScopedSupabaseConfiguration = () => Boolean(supabaseUrl && supabasePublishableKey);

export const createUserScopedSupabaseClient = (accessToken: string): SupabaseClient => {
  if (!hasUserScopedSupabaseConfiguration()) {
    throw new Error('User-scoped Supabase client is not configured.');
  }

  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: serverAuthOptions,
    accessToken: async () => accessToken,
  });
};

// Compatibility alias for endpoints that have not been migrated in this
// phase. New user-request code must use req.supabase instead.
export const supabase = adminSupabase;
