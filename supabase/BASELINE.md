# Schema baseline

`migrations/20260728000000_schema_baseline.sql` is a schema-only `public`
snapshot created with `supabase db dump --linked --schema public`. It contains
no table data, storage objects, credentials, API keys, or database passwords.

The linked project had only the three later hardening migration versions in its
history; its original schema was created before this repository recorded
migrations. The baseline absorbs the final `public` state of those historic
changes so `supabase db reset --local` can build a clean database.

`20260728053215_harden_auth_profiles_and_rpc.sql` intentionally retains only
the avatar policies in the `storage` schema because Supabase creates that schema
locally and it is outside the public-schema dump. The cascade migration is a
documented no-op locally because its final foreign key is already in the
baseline. These versions were already applied to the linked project; do not
run `db push` merely to rewrite their history.
