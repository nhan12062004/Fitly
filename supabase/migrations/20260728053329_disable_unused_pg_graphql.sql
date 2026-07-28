-- Fitly uses PostgREST through supabase-js and has no GraphQL consumers.
-- Removing the unused extension prevents authenticated schema introspection.
drop extension if exists pg_graphql;
