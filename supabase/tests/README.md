# Database ownership and RLS tests

`rls_ownership_test.sql` is a pgTAP regression suite for the User A/User B ownership boundary. It uses a transaction and rolls back all fixture rows, so it never requires production data.

Run it only against a local Supabase stack after the complete schema baseline has been restored:

```powershell
npx supabase start
npm --prefix Backend run db:test:rls
```

It verifies profile, daily exercise, set-log, membership, service-only, avatar-policy, and account-deletion cascade boundaries. Do not use `--linked`: testing these mutations against the linked production project is intentionally unsupported.
