# Spec: citadel, step 1 (one repo, one stack)

Status: draft for review. Intent: `docs/intent/monorepo.md` (confirmed 2026-09-11).
Step 2, moving the ledgers to Postgres, gets its own spec once this lands.

## Objective

Move argus, Foundry and Pensieve into one repo and run the whole loop from one compose stack,
with the ledger data still in files. When step 1 is done:

- A fresh clone plus one `.env` runs the loop with `just bootstrap && docker compose up -d`.
- A change that crosses apps is one PR in one repo.
- The sweep runs in a container, on its own clone of the data, and never commits into a
  developer's checkout.
- Each app keeps its git history and gets its own release-please version.

## Assumptions

1. **Data leaves the code repo now, not in step 2.** Only argus's code comes into citadel. The
   data (ledgers, arch docs, manifests, `state/`) stays in `d0nwong/argus`, which becomes the
   data repo. The sweep container clones it into a volume and pushes to it, and Pensieve reads
   the same volume. Step 2 then moves the ledgers from that repo into Postgres. Without this, the
   sweep would commit to citadel every 15 minutes until step 2.
2. **argus's history is imported code-only.** `git filter-repo --path …` over the code paths
   drops the commits that only touched data, so the "quiet run" commits don't come along. The
   full history stays in `d0nwong/argus`.
3. **argus locates its data through `ARGUS_ROOT`,** which already exists in `scripts/argus/paths.ts` and defaults to argus's own directory so
   today's checkout keeps working. Step 1 extends it to `accio` and points `mcp-headers.ts` at the root `.env`.
4. **argus owns the infra files because they live under `apps/argus/infra/`.** Root
   `compose.yaml` only `include:`s each app's compose file, so almost nothing sits at the root
   for release-please to attribute.
5. **The sweep container loops with a shell `while` + `sleep 900`** around `claude -p "/sweep"`,
   guarded by `flock`. `/loop` is interactive and doesn't belong in a container.
6. **Foundry web runs on the host in step 1** (decided at checkpoint B). It pushes and opens PRs
   with the user's own git, gh and bb credentials, which live in the macOS keychain, so
   `just foundry` runs it with the root .env. Containerizing it (tokens and a credential helper,
   same-path mounts, the Docker socket) is part of the deploy work.

## Tech stack

- Bun 1.4.0 (`packageManager` in every `package.json`), Bun workspaces, one `bun.lock`.
- TypeScript 5.9, tests in `bun test`, Biome via ultracite in foundry/web and pensieve.
- TanStack Start + Vite (Foundry web, Pensieve), drizzle (Foundry), Postgres 18.
- Docker Compose v2 with `include:` (Docker 29 is installed), OrbStack on the host.
- `just` for ops (not installed yet: `brew install just`).
- release-please (`googleapis/release-please-action@v4`), manifest mode.

## Project structure

```
citadel/
  package.json            workspaces: apps/argus, apps/foundry, apps/foundry/web, apps/pensieve
  bun.lock  justfile  compose.yaml (include only)  .env.example (the one env file)
  release-please-config.json  .release-please-manifest.json
  .github/workflows/      release-please.yml, pr-title.yml (from Foundry), ci.yml
  docs/intent/  docs/spec/
  apps/
    argus/                scripts/ (argus, accio), skills/, .claude/, .mcp.json, CLAUDE.md,
                          SPEC.md, evals/, tsconfig.json, Dockerfile (the sweep image)
      infra/              compose.yaml (mcp gateway, sweep), mcp/config.json, sweep/loop.sh
    foundry/              bin/, image/ (forge), web/, CHANGELOG.md
      infra/              compose.yaml (postgres, foundry-web), postgres/init/, Dockerfile.web
    pensieve/             src/, server.ts, Dockerfile, compose.yaml

d0nwong/argus (data repo, cloned by the sweep into the `argus-data` volume)
  alden/  foundry/features/  pensieve/features/  state/  .state/
```

Foundry's untracked `.claude/skills/` is not in its history and won't come across on its own.
Copy it over by hand if you want it.

## Compose stack

| Service | Image | Port | Talks to |
|---|---|---|---|
| `mcp` | mcp-proxy, pinned digest | 9090 | Slack and Linear upstreams |
| `postgres` | postgres:18-alpine | 5432 | Foundry (step 2: argus as well) |
| `foundry-web` | host process (`just foundry`), not compose | 3777 | postgres, mcp, host Docker, your git/gh/bb |
| `pensieve` | built from apps/pensieve | 3778 | `argus-data` (ro, except `decisions/`), foundry-web, mcp |
| `sweep` | built from apps/argus | none | `argus-data` (rw), FE/BE clones, mcp, Slack, Bitbucket |

Inside the stack, services find each other by name (`http://mcp:9090`); Pensieve reaches Foundry
on the host at `host.docker.internal:3777`. Forges are started by Foundry, not by compose, so they keep
reaching the gateway through the published host port.

## Commands

```sh
# ops (just, from the repo root; a recipe loads .env only where it needs it)
just                      # list recipes with their docs
just bootstrap            # prereqs, .env from .env.example (prompts, mode 600), deps, data clone
just check                # what bootstrap would do, changing nothing
just up | down | logs [svc] | ps
just auth linear|slack|claude|foundry-api   # write one key into .env
just migrate              # Foundry's drizzle migrations
just psql
just sweep-once           # one /sweep tick in the sweep container
just release-dry          # release-please --dry-run

# dev (per app, through the workspace)
bun install
bun run --filter '*' typecheck
bun run --filter '*' test
bun run --filter pensieve dev      # and foundry-web dev, as today
bun run argus <verb>  |  bun run accio <verb>     # names unchanged
```

just recipes may call bun. Nothing in `package.json` calls just.

## Code style

Match each app as it is today. Ops code moves out of the bash dispatchers (`infra.sh`, `db.sh`,
`serve.sh`, the three `bootstrap.sh`) and into small recipes. A recipe that grows past a few
lines becomes a Bun script that the recipe calls. There is no global `set dotenv-load`: it
would hand every key, the Slack token included, to every process a recipe starts, which is
what Pensieve's `root-env.sh` exists to prevent. Compose gets the file with `--env-file`.

```just
# Apply Foundry's database migrations.
migrate: (wait "postgres")
    bun run --filter foundry-web db:migrate

# One sweep tick, the same as the loop runs it.
sweep-once:
    docker compose exec sweep flock /tmp/sweep.lock claude -p "/sweep" --model claude-sonnet-5
```

Commit titles are Conventional Commits with the app as scope (`feat(pensieve): …`,
`fix(argus): …`), which the PR-title lint enforces.

## Versioning

```json
// .release-please-manifest.json
{ "apps/argus": "0.1.0", "apps/foundry": "1.4.0", "apps/pensieve": "0.1.0" }
```

`release-please-config.json` has three `node` packages with `include-component-in-tag: true`
(tags look like `foundry-v1.5.0`) and `bootstrap-sha` set to the import merge commit, so
imported history never gets released a second time. By default release-please opens one
combined release PR. Images are tagged `<app>:<version>`, and compose reads the tags from `.env`.

## Testing strategy

- **Unit:** each app's existing `bun test` suite, which moves across unchanged. New: a test for
  `ARGUS_ROOT` resolution (`apps/argus/scripts/argus/*.test.ts`).
- **Static:** `tsc --noEmit` and `ultracite check` for each app.
- **CI (`ci.yml`):** on PRs, install once, then typecheck, test and check each app whose path
  changed.
- **Stack smoke test:** `just up`, then every service reports healthy, Pensieve serves a feature
  page from `argus-data`, Foundry lists forges, and the gateway answers `/_readyz`.
- **Sweep:** `just sweep-once` with `argus pull --dry-run`, then one real tick that commits to
  the data repo.

## Cutover

The old repos keep running until the stack has proven itself. Only one sweep may run at a time:

1. Build and smoke-test the stack with the sweep service **stopped**.
2. Stop the host loop (`bun run sweep` in `~/git/argus`), then push the data repo.
3. Start the sweep service. Watch it for a day.
4. Archive `d0nwong/foundry` and `d0nwong/pensieve` (with a README pointing at citadel), and
   trim `d0nwong/argus` down to data.

## Boundaries

- **Always:** keep the old repos working until cutover step 4. Run each app's tests and
  typecheck before committing. Use scoped Conventional Commit titles. Make every just recipe
  safe to run twice.
- **Ask first:** archiving or trimming any old repo, force-pushing citadel, starting the sweep
  container (the second-writer risk), adding a dependency, and any change to the ledger schema
  or the `argus` verbs beyond `ARGUS_ROOT`.
- **Never:** run two sweeps at once, edit ledgers or `state/` by hand, commit `.env`, or bake
  secrets or data into an image.

## Success criteria

1. Each import merge's second parent carries the whole imported history:
   `git rev-list --count <merge>^2` is 136 for Foundry, 102 for Pensieve and 223 for argus's
   code-only history, and `git log --follow apps/foundry/bin/foundry` reaches its first commit.
2. `bun install && bun run --filter '*' typecheck && bun run --filter '*' test` passes from a
   fresh clone.
3. On a fresh clone, `just bootstrap` writes one `.env` and `just check` reports nothing
   missing. There's no `.env` in any app directory, and nothing reads `ARGUS_ENV` or
   `~/.config/liamai/env`.
4. After `just up`, the gateway, postgres, Pensieve and the sweep are healthy, and `just foundry`
   runs Foundry. Pensieve at :3778 shows today's ledgers, Send to Foundry creates a job at
   :3777, and Ask answers a question.
5. The sweep service finishes a tick and pushes to `d0nwong/argus`, and `~/git/argus` has no new
   commits for 24 hours after cutover.
6. A `feat(pensieve):` merge makes release-please propose `pensieve-v0.2.0` and nothing else.

## Decided

- **Arch docs, step 2:** they move into citadel next to the code they describe. When the sweep
  refreshes one, it opens a PR in citadel rather than pushing. In step 1 they stay in the data
  repo with the ledgers.
- **Bitbucket from the container:** one read-only Atlassian API token and its account in `.env`
  (`BITBUCKET_TOKEN`, `BITBUCKET_USERNAME`, the email), used both to fetch the FE/BE repos and to
  read pipelines. REST authenticates as email:token, git as `x-bitbucket-api-token-auth`:token
  (checked in T14).
- **MCP in a container (checked 2026-09-11, T1):** in a fresh container `claude -p` refuses to
  run `.mcp.json`'s headersHelper ("this workspace has no persisted trust") and gets no Slack
  or Linear tools. Every image that runs Claude over the argus directory ships a
  `~/.claude.json` with `projects["<argus dir>"].hasTrustDialogAccepted: true`. With it, both
  servers connect and the tools load.

- **Foundry web in production (checked 2026-09-11, T2):** `vite build` then a Bun entry,
  `apps/foundry/web/server.ts`, the same shape as Pensieve's, serves the app, and its API routes
  work (`GET /api/repos` returns JSON with the bearer and 401 without it).
- **Foundry sees host paths:** tracked repos and `--mount` forges are stored as absolute host
  paths, so `foundry-web` mounts the host's `~/git` at the same absolute path.

- **Tokens reach Claude's helpers as files (checked 2026-09-11, T13):** Claude Code runs a
  headersHelper without any variable that looks like a secret (`MCP_GATEWAY_TOKEN` and
  `CLAUDE_CODE_OAUTH_TOKEN` never reach it), so compose mounts the gateway token as a secret at
  `/run/secrets/mcp_gateway_token`, and `mcp-headers.ts` reads it there.

- **Foundry web stays on the host in step 1 (checkpoint B, 2026-09-11):** it runs `git push`
  and opens PRs with `gh` and `bb`, and its credentials are keychain-backed. `just foundry`
  runs it; containerizing it moves to the deploy work.

- **The sweep in the stack (checked 2026-09-11, T14):** it runs as the image's `bun` user, since
  Claude refuses `--dangerously-skip-permissions` as root. Its Bash commands see every variable in
  its environment, and its model reads Slack, so it gets only Claude's token, the Slack token and
  the read-only Bitbucket pair; the gateway and push tokens are secret files, and the push token
  should be fine-grained to the data repo. The lock is `.git/sweep.lock` in the data repo, shared
  by every container on it; `just sweep-once` and `just sweep-on` refuse while the host's loop runs.

## Open questions

None.
