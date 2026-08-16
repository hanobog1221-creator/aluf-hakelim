-- Applied to production on 2026-08-16.
-- New objects created by the postgres migration role in public are private by default.
-- Explicit public/client access must be granted deliberately after creation.

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- Note: changing supabase_admin default privileges requires that role's ownership/permissions
-- and is intentionally not forced from the postgres migration session.
