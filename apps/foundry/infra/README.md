# infra

The local development stack: postgres for the web UI's job ledger, and the MCP
gateway that gives forges Linear access. The shape is meant to keep growing.

```sh
bun run infra:up      # from the repo root
```

Everything is driven from the repo root through `bun run infra:*`, which just
forwards to `infra/infra.sh`. Run `./infra/infra.sh --help` for the full list.

| command | |
|---|---|
| `bun run infra:up` | start, and block until postgres reports healthy |
| `bun run infra:down` | stop; the data volume survives |
| `bun run infra:down -- --purge` | stop and delete the data volume |
| `bun run infra:reset` | purge + up — a clean database |
| `bun run infra:status` | what is running, plus the connection string |
| `bun run infra:logs [-- mcp]` | tail postgres (or the gateway) |
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

## MCP gateway

`mcp` is [mcp-proxy](https://github.com/tbxark/mcp-proxy) (`ghcr.io/tbxark/mcp-proxy`)
configured by `mcp/config.json`. It connects upstream to Linear's and Slack's hosted
MCP servers with the host's `LINEAR_API_KEY` / `SLACK_TOKEN`, and serves them to
forges as streamable HTTP at `http://localhost:9090/{linear,slack}/mcp`
(`host.docker.internal:9090` from a container, `mcp.foundry.local` on OrbStack),
requiring `Authorization: Bearer $FOUNDRY_MCP_TOKEN`. An upstream whose key is
missing fails to mount at startup (`panicIfInvalid: false`) and the others keep
serving.

The service sits behind the `mcp` compose profile, which `infra.sh` switches on by
itself when the repo's `.env` carries the gateway token and at least one upstream
key — `foundry auth --linear` / `foundry auth --slack` write them. `infra/.env` never
holds these secrets; `infra.sh` exports the repo's `.env` into compose's environment,
and mcp-proxy expands the `${…}` references in the config.

```sh
curl localhost:9090/_readyz                     # {"status":"ok",...} once the configured upstreams mounted
curl -X POST localhost:9090/linear/mcp \
  -H "Authorization: Bearer $FOUNDRY_MCP_TOKEN" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

To add another upstream, add an entry under `mcpServers` in `mcp/config.json`
(remote: `url` + `transportType` + `headers`; local: `command` + `args`), reference
its secret as `${SOME_KEY}` — `foundry auth --<name>` then prompts for exactly that
name and stores it in the repo's `.env` — and add `SOME_KEY: ${SOME_KEY:-}` to the service's
`environment` in `compose.yaml`. Then
teach the hosts to advertise it: the `FOUNDRY_MCP_SERVERS` lists in `bin/foundry`
(`load_env`) and `web/…/job-runner.ts` (preflight), and the known-server sweep in
`image/box-init.sh`, which registers whatever the list carries. Change
`MCP_PORT` in `infra/.env` if 9090 is taken.

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
