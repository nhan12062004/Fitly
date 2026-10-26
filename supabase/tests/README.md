# Database ownership and RLS tests

`rls_ownership_test.sql` is a pgTAP regression suite for the User A/User B ownership boundary. It uses a transaction and rolls back all fixture rows, so it never requires production data.

Run it only against a local Supabase stack after the complete schema baseline has been restored:

```powershell
npx supabase start
npm --prefix Backend run db:test:rls
```

It verifies profile, daily exercise, set-log, membership, service-only, avatar-policy, and account-deletion cascade boundaries. Do not use `--linked`: testing these mutations against the linked production project is intentionally unsupported.

## Production hardening regression tests

From `Backend`, run `npm test` for the embedded Postgres migration/RLS/transaction
suite plus quota, privacy, MFA and account-cache tests. Application SQL uses the
real migrations; Auth and Storage platform objects are minimal local stubs.

CI also starts a separate Supabase local project, runs the pgTAP ownership suite,
and runs `npm run test:integration:local` against local Auth, PostgREST, Storage
and the Express API. That job requires Docker and never connects to a hosted
project. See [the release procedure](../../docs/hardening-release-2026-10-26.md).
