import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/** Real embedded Postgres for migration/RLS/transaction regression tests.
 * Only Supabase platform-owned auth/storage objects are stubbed; application
 * tables, policies, grants, triggers and functions use the actual migrations.
 * Hosted Auth, PostgREST and Storage integration require the separate Supabase CI job.
 */
export async function createTestDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    -- Supabase's local stack may already grant API roles privileges before
    -- our baseline is restored. GRANT in a dump adds to those privileges.
    alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz,
      raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as
      $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
  `);
  const directory = path.resolve(__dirname, '../../supabase/migrations');
  for (const filename of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    try { await db.exec(await readFile(path.join(directory, filename), 'utf8')); }
    catch (error) { throw new Error(`Migration ${filename} failed`, { cause: error }); }
  }
  await db.exec(`set search_path = public; set row_security = on; set check_function_bodies = on;`);
  return db;
}
