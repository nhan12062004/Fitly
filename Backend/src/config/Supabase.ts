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

// Do not prevent the liveness/readiness endpoints from loading when a
// deployment is misconfigured. /ready reports missing configuration before
// issuing a database query, so these inert values are never used by a ready
// process.
export const supabase = createClient(
  supabaseUrl || 'http://localhost:54321',
  supabaseServiceRoleKey || 'missing-supabase-service-role-key',
);
