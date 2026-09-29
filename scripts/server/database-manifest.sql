-- Compare source and restored databases only after stopping all writers.
-- Output contains counts and hashes, never plaintext user records or secrets.
-- Canonicalize timestamptz JSON across servers with different timezone defaults.
SET TIME ZONE 'UTC';
\pset tuples_only on
\pset format unaligned
SELECT format(
  'SELECT %L, count(*), md5(coalesce(string_agg(row_hash, '''' ORDER BY row_hash), '''')) FROM (SELECT md5(to_jsonb(t)::text) AS row_hash FROM %I.%I t) rows',
  tablename, schemaname, tablename)
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
\gexec
SELECT 'sequence:' || sequencename, last_value
FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename;
