-- Runs once, when the pgdata volume is first created. Schema itself lives with
-- the app's migrations (LIA-11); this file is only for cluster-level setup that
-- has to exist before any migration runs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_bytes, digest
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive text (repo slugs, names)
