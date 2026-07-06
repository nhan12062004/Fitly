import { createClient } from '@supabase/supabase-js';
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

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL in Backend environment.');
}

if (!supabaseServiceRoleKey) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in Backend environment.');
}

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
