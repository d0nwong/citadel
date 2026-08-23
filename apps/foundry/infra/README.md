# infra

The local development stack. Today that is one service — postgres — but the shape
is meant to grow (a queue, an MCP server, whatever LIA-12/13 need).

```sh
bun run infra:up      # from the repo root
```

Everything is driven from the repo root through `bun run infra:*`, which just
forwards to `infra/infra.sh`. Run `./infra/infra.sh --help` for the full list.

| command | |
|---|---|
| `bun run infra:up` | start, and block until postgres reports healthy |
| `bun run infra:up -- --tools` | also start Adminer on <http://localhost:8081> |
| `bun run infra:down` | stop; the data volume survives |
| `bun run infra:down -- --purge` | stop and delete the data volume |
| `bun run infra:reset` | purge + up — a clean database |
| `bun run infra:status` | what is running, plus the connection string |
| `bun run infra:logs` | tail postgres |
| `bun run infra:psql` | a psql shell inside the container |
| `bun run infra:url` | print `DATABASE_URL`, for scripts and `.env` files |

## Connecting

```
postgresql://foundry:foundry@localhost:5432/foundry
```

If you also run a postgres on the Mac itself (brew, Postgres.app), the two will
fight over 5432 — set `POSTGRES_PORT=5433` in `infra/.env` to move this one out
of the way. On OrbStack the container is also reachable at
`postgres.foundry.local:5432`.

Nothing in here is a secret — it is a throwaway local database with a throwaway
password. Real environments get real credentials elsewhere.

## Settings

`infra/.env` is created from `infra/.env.example` the first time you run
`infra:up`, and is gitignored. Edit it, then `bun run infra:down && bun run infra:up`.

Changing `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` after the first start
has no effect on an existing volume — those are only read by `initdb`. Follow
with `bun run infra:reset` to rebuild the cluster.

## Data

Postgres 18 keeps `PGDATA` at `/var/lib/postgresql/18/docker`, so the named
volume `foundry-pgdata` is mounted at `/var/lib/postgresql` (the image's own
`VOLUME`) rather than the pre-18 `/var/lib/postgresql/data` path. It survives
`infra:down`, `docker compose down`, and reboots; only `--purge`/`reset` remove it.

`postgres/init/*.sql` runs **once**, when that volume is first created — it is for
cluster-level setup (extensions), not for schema. Application schema belongs in
the app's migrations: `web/src/db/`, applied with `bun run db:migrate`, into the
`foundry` schema rather than `public`.
