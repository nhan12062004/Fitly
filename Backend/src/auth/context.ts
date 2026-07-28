import type { SupabaseClient, User } from '@supabase/supabase-js';

export interface AuthContext {
  user: User;
  accessToken: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      supabase?: SupabaseClient;
    }
  }
}

export {};
