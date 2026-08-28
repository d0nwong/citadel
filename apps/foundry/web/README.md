# foundry/web

POC frontend for the Foundry orchestration layer. **TanStack Start** (SSR, file-based
routing) + **shadcn/ui** + **Tailwind v4**, running on **bun**.

```sh
bun install
bun run infra:up   # from the repo root — postgres
bun run db:migrate # apply the schema
bun run dev        # http://localhost:3777
bun run build
```

## Status: everything is real

Nothing in the app is mocked any more. Jobs and repos live in Postgres, forges are
read live from docker labels, and **igniting a job actually runs it**: Claude Code in
an ephemeral container, a commit, a push, and a PR on the repo's forge. Everything
that touches the database or a CLI goes through `createServerFn`, so the node-only
modules never enter the client bundle.

- `features/jobs/server/job-store.ts` — the ledger's queries, plus the write paths
  the runner uses (`appendLogs`, `patchJob`, guarded `settleJob`).
- `features/jobs/server/job-runner.ts` — the orchestrator (see below).
- `features/repos/server/repo-scan.ts` — scans `~/git` with `node:fs`, reads each repo's
  branch, dirty state and last-commit time via `git`, and keeps the *imported* set in
  the `repos` table. Branch and dirty state are deliberately not stored: they are facts
  about the working tree right now. It also carries each repo's notes and its
  `lastBaseBranch` — the base of its most recent job (`job-store.lastBaseBranchByRepo`,
  a `distinct on` over the ledger), which is what the ignite dialog starts from. No
  separate store and no per-browser state: the same answer from any device.
- `features/forges/server/forge-scan.ts` — the forge inventory from docker labels:
  `foundry.forge` containers are pooled (`foundry new`), `foundry.job` ones are the
  ephemeral per-job forges.

## Running a job

One job = one throwaway container. The host (this dev server) does everything that
needs the user's credentials; the container gets none of them.

```
Ignite ─► insert row (queued, with a per-job callback token)
       ─► preflight: docker, image, ~/.foundry/env credential, repo, base, origin
       ─► clone the repo to ~/.foundry/jobs/<id>/work, branch from origin/<base>
              branch name: foundry/<first 3 words of the task>-<job short id>
       ─► docker run foundry/forge:latest forge-run   (image/forge-run.sh, bind-mounted)
              container: for each blueprint step (or the one bare task):
                           claude -p <prompt> --model <m> --session-id|--resume <sid>
              container: git add -A && git commit
              container ─POST─► /api/jobs/$id/events   (Bearer <token>)
       ─► host: git push, `bb`/`gh` pr create, diff stats, settle the row
```

- The **container** holds a Claude credential (`foundry auth`), the workspace, and a
  token that authorises callbacks for its own job id. No `GH_TOKEN`, no Bitbucket app
  password, no `DATABASE_URL` — the agent runs with permissions skipped, so it gets
  nothing it could misuse. If `foundry auth --linear` (or `--slack`) has been run it
  also gets `FOUNDRY_MCP_URL`/`FOUNDRY_MCP_TOKEN` plus `FOUNDRY_MCP_SERVERS`, so the
  agent can reach Linear/Slack through the infra stack's MCP gateway
  (`host.docker.internal:9090`, override with the `FOUNDRY_MCP_URL` env of this
  server) — a gateway token, never the upstream keys.
- **Repo notes** (`features/repos/`) are the target repo's standing instructions,
  edited on the Repos page and stored on its `repos` row. Preflight reads them at
  launch — not at insert, so the notes standing when the forge lights are the ones
  that apply — and passes them as `FOUNDRY_REPO_NOTES`; `forge-run.sh` appends them
  to the unattended system prompt, so they hold for every blueprint step, planning
  included. A repo with none changes nothing.
- A **blueprint** (`features/blueprints/`) turns the agent phase into N steps, each
  `{name, model, effort?, prompt}`; `{{task}}` in a prompt is the job's task text.
  The runner gets them as `FOUNDRY_STEPS` JSON, runs every step against one Claude
  session, labels each step's log lines `[name] …` (the detail sheet folds those
  into one collapsible section per step), and stops at the first
  non-zero exit (remaining steps are reported as skipped). `FOUNDRY_TIMEOUT` is the
  whole job's budget. No blueprint means one unlabelled step on the default model —
  the same loop, so there is exactly one launch path.
- A settled job with a PR can spawn a **follow-up job** that addresses the PR's review
  comments (LIA-40) — the "Address PR comments" action in the detail sheet. The row
  copies the source's branch and PR URL (`source_job_id` marks it; deliberately no FK,
  so purging the source never strands it). Preflight fetches the PR's unresolved
  review threads and general comments with the host's own CLI (`gh api graphql` /
  `bb pr show <id> true` — `server/forge-pr.ts`), fresh at launch like repo notes,
  and hands them to the forge as its task; the workspace checks out origin's tip of
  the PR branch, and the finishing push updates the existing PR instead of opening a
  new one. The container still holds no credentials.
- The **callback endpoint** (`src/routes/api/jobs.$id.events.ts`) is the only server
  route. It maps Claude's stream-json onto the `sys|out|tool|err` log streams
  (`server/job-events.ts`) and hands the pipeline back to the host on commit.
- **Branch names carry the job's short id.** `branchSlug` keeps only the first
  three words of the task, so two jobs on one repo often derive the same slug —
  and the runner's `ls-remote` check cannot separate concurrent ones, since
  neither has pushed when both look. The id suffix makes the name unique by
  construction (`FOUNDRY_MAX_JOBS` allows 3 at once) and reads back to the row.
- The **PR CLI** is picked by origin host in `server/forge-pr.ts`: `bb` for
  bitbucket.org, `gh` for github.com, anything else pushes the branch and says so.
- `vite dev` runs with `--host` so containers can reach the server at
  `host.docker.internal:3777` — which also means it listens on your LAN; the token
  auth on the callback route is what makes that acceptable.
- A `docker wait` watcher and lazy reconciliation (first `listJobs` per process)
  cover the crash cases: a container that dies silently fails its job, a dev-server
  restart re-adopts jobs whose containers are still running.
- Knobs: `FOUNDRY_MAX_JOBS` (default 3), `FOUNDRY_TIMEOUT` (seconds, default 1800),
  `FOUNDRY_CALLBACK_BASE`, `FOUNDRY_BB_REVIEWERS=1` to add Bitbucket default
  reviewers. Old workspaces: `foundry jobs prune [--days 7]`.

## The database

Schema in `src/db/schema.ts`, migrations generated from it into `src/db/migrations/`
and committed. Everything lives in the **`foundry`** schema — `public` is left to the
extensions `infra/postgres/init/00-init.sql` installs.

```sh
bun run db:generate   # schema.ts -> a new migration; commit it
bun run db:migrate    # apply
bun run db:studio     # drizzle studio
```

`db:migrate` also does a one-time adoption of `~/.foundry/repos.json`, which is where
the imported set used to live. It leaves the file alone — `~/.foundry` is the CLI's
state directory.

`DATABASE_URL` comes from `web/.env` (copy `.env.example`; bun loads it automatically),
and falls back to the local stack's URL so a fresh clone needs no configuration.
`bun run infra:url` from the repo root prints it.

| table | holds |
|---|---|
| `repos` | the imported set — what a job may target |
| `blueprints` | reusable step lists; `steps` is one jsonb column, edited and consumed whole |
| `jobs` | one row per job; a job *is* the run here, so there is no separate runs table |
| `job_logs` | one row per log line, append-only, streamed in as a job runs |

`jobs.repo_id` links to the repo when there is one, and `jobs.repo` keeps an immutable
`RepoRef` snapshot beside it — a job can target a git URL that was never imported, and
un-importing a repo must not blank out the history of jobs that ran against it.
`jobs.blueprint_id` / `jobs.blueprint` follow the same pattern for the steps a job ran.

## Adding repos

A job can only target a repo you have added. **Repos → Add repos** scans the configured
roots and lists every git checkout it finds, newest commit first; tick the ones you
want. Already-added repos show as disabled. `SCAN_ROOTS` in `server/repo-scan.ts` is the
list of directories scanned — one entry, `~/git`, today.

This is deliberately a curated set rather than "everything on disk": the job picker
stays short, and nothing can be targeted by accident.

## Runtime model

Foundry runs forges locally on OrbStack today, but that is one adapter, not the
domain. Two unions keep the remote story expressible without building it yet.

**Where a forge runs.** `Forge` carries `adapter`, a free-form `runtime` map and a
`runtimeSummary`, instead of Docker's `image`/`cpus`/`memory`. The UI renders whatever
the adapter reports — an OrbStack forge shows image and cores, a remote one would show
region and size — and nothing in the UI knows what an image is.

`lifecycle` separates **pooled** forges (named, long-lived, reused — the containers)
from **ephemeral** ones (provisioned per job, nothing to list in between). The Forges
page groups by adapter and renders capacity rather than empty cards for the ephemeral
case.

**Where the code lives.** `RepoRef` is a discriminated union:

```ts
| { kind: 'local'; name; path }        // bind-mounted — edits land on the user's disk
| { kind: 'git'; name; url; ref }      // cloned — results come back as a pushed branch
```

This is the distinction that actually breaks across adapters. No remote forge can
bind-mount your Mac, so "your working tree stays untouched" stops being true and the
result arrives as a branch instead. The job detail sheet states which of the two
applies per job rather than assuming the local case.

Today the one adapter is `orbstack`, running ephemeral containers — one per job,
listed on the Forges page only while they exist. Pooled forges created with
`foundry new` show up beside them. There is no remote adapter implementation.

## Layout

Feature-based. `src/routes/` is URL shape only — every route file is a few lines that
render a component from a feature.

```
src/
  routes/                     thin adapters, URL-shaped (generated route tree)
    __root.tsx                document shell, AppShell, toaster
    api/jobs.$id.events.ts    the forge container's callback (the one server route)
    index.tsx  forges.tsx  repos.tsx  blueprints.tsx
  features/
    jobs/
      components/             job-ledger, new-job-dialog, job-detail-sheet, job-status-chip
      queries.ts              queryOptions — what routes and components import
      api.ts                  createServerFn wrappers
      server/job-store.ts     node-only: the postgres queries
      server/job-runner.ts    node-only: preflight, clone, docker run, push, settle
      server/job-events.ts    node-only: callback auth + stream-json -> job_logs
      server/forge-pr.ts      node-only: bb / gh pr create, by origin host
      types.ts
    blueprints/
      components/             blueprint-inventory, blueprint-editor-dialog
      server/blueprint-store.ts  node-only: CRUD + hand-rolled step validation
      queries.ts  api.ts  types.ts
    forges/
      components/             forge-inventory, forge-card, forge-dot
      server/forge-scan.ts    node-only: docker labels -> the inventory
      queries.ts  api.ts  types.ts
    repos/
      components/             repo-inventory, add-repos-dialog
      server/repo-scan.ts     node-only: fs + git, never a component import
      queries.ts  api.ts  types.ts
  shared/
    ui/                       shadcn primitives (generated — don't hand-edit)
    components/               app-shell, page-header, foundry-mark
    lib/                      format, utils
  db/
    schema.ts                 drizzle schema (the `foundry` postgres schema)
    client.ts                 node-only: the pool
    migrate.ts                bun run db:migrate
    migrations/               generated SQL, committed
```

Cross-feature imports go through `queries.ts` — the jobs dialog reads `forgeQueries`
and `repoQueries`, never another feature's internals. There are deliberately no barrel
`index.ts` files (see the server-code note below).

`components.json` aliases point at `#/shared/*`, so `bunx shadcn@latest add <x>` lands
in `src/shared/ui` without further edits.

## Conventions for server code

`src/mocks/` is gone — every feature's `api.ts` is now the same shape: thin
`createServerFn` wrappers whose handlers `await import()` a node-only module from
`features/<name>/server/`.

Two Start-specific rules worth keeping:

- **Server routes must live in `src/routes/api/*`** and follow the same file-based path
  conventions as page routes. Keep them thin and delegate to `features/<name>/server/`.
  Server *functions* (`createServerFn`) have no such constraint — the docs say they can
  be "called from anywhere in your application", so they can live inside the feature.
- **Keep node-only code out of shared modules.** `child_process` (for shelling out to
  `bin/foundry`) belongs in `features/*/server/*.ts`, imported only from inside a server
  handler — never from a module a client component also imports.

## Design

Dark-only "heat control panel": iron greys, a molten `--ember` accent reserved for
things that are actually hot (running jobs, the primary action), Archivo for UI and
JetBrains Mono for every machine-generated value — ids, paths, branches, durations,
logs. Status has one vocabulary everywhere: an ember dot pulses only while a job runs.

Palette and type tokens live at the top of `src/styles.css`.

Responsive down to ~360px. The `lg` breakpoint is the switch: below it the rail becomes
a drawer behind a top bar, and the ledger's fixed column grid becomes stacked bands.
Both layouts share one DOM — the mobile wrappers are `lg:contents`, so at desktop they
vanish and their children drop straight into the grid.
