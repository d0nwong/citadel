# infra

Foundry's postgres — the web UI's job ledger — as a service in citadel's stack. The MCP
gateway forges use is argus's (see below). The shape is meant to keep growing.

```sh
just up postgres      # from citadel's root
```

`compose.yaml` here is included by citadel's root `compose.yaml`, so the recipes drive it:

| recipe | |
|---|---|
| `just up postgres` | start, and block until postgres reports healthy |
| `just down` | stop the stack; the data volume survives |
| `just ps` | what is running |
| `just logs postgres` | tail postgres |
| `just psql` | a psql shell inside the container |
| `just db-url` | print `DATABASE_URL`, for scripts and `.env` files |
| `just migrate` | apply the app schema |

## Connecting

```
postgresql://foundry:foundry@localhost:5432/foundry
```

If you also run a postgres on the Mac itself (brew, Postgres.app), the two will fight over
5432 — set `POSTGRES_PORT=5433` in citadel's `.env` to move this one out of the way. On
OrbStack the container is also reachable at `postgres.foundry.local:5432`.

Nothing in here is a secret — it is a throwaway local database with a throwaway password.
Real environments get real credentials elsewhere.

## MCP gateway

argus's, since 2026-09-11: `apps/argus/infra/compose.yaml` runs mcp-proxy on :9090 with the
Linear and Slack keys from citadel's `.env`, started by `just up mcp`. Forges reach it at
`host.docker.internal:9090`, presenting `FOUNDRY_MCP_TOKEN` — the value of
`MCP_GATEWAY_TOKEN`, which `bin/foundry` hands them.

## Settings

`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` and `POSTGRES_VOLUME`
live in citadel's `.env` (`.env.example` lists them with their defaults). Change one, then
`just down && just up postgres`.

Changing the user, password or database name after the first start has no effect on an
existing volume — those are only read by `initdb`. To rebuild the cluster:
`just down && docker volume rm foundry-pgdata && just up postgres`.

## Data

Postgres 18 keeps `PGDATA` at `/var/lib/postgresql/18/docker`, so the named volume
(`foundry-pgdata` by default; `POSTGRES_VOLUME` points a trial stack elsewhere) is mounted at
`/var/lib/postgresql` — the image's own `VOLUME` — rather than the pre-18
`/var/lib/postgresql/data` path. It survives `just down`, `docker compose down` and reboots;
only deleting the volume removes it, and `just up` refuses to start postgres on a volume a
container from another project is holding.

`postgres/init/*.sql` runs **once**, when that volume is first created — it is for
cluster-level setup (extensions), not for schema. Application schema belongs in the app's
migrations: `web/src/db/`, applied with `just migrate`, into the `foundry` schema rather than
`public`.
