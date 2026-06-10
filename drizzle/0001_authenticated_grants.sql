-- Grant the Supabase `authenticated` role table access so RLS-scoped queries work
-- in production. The cloud default no longer auto-exposes new public tables, so the
-- grants must be explicit. RLS policies still restrict WHICH rows each user can touch;
-- these grants only allow the role to reach the tables at all.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
