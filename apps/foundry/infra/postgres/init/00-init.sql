-- Runs once, when the pgdata volume is first created. Schema itself lives with
-- the app's migrations (web/src/db, `bun run db:migrate`, into the `foundry`
-- schema); this file is only for cluster-level setup that has to exist before
-- any migration runs -- so it stays in public, where everything can see it.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_bytes, digest
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive text (repo slugs, names)
