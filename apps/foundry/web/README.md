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
  the runner uses (`patchJob`, guarded `settleJob`).
- `features/jobs/server/job-logs.ts` — the other half of a job's state, on disk:
  `appendLogs` / `readLogs` over `~/.foundry/logs/<id>.jsonl` (see below).
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
       ─► host: git push, `bb`/`gh` pr create, link the Linear ticket (`bb` only),
              diff stats, settle the row
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
  the same loop, so there is exactly one launch path. Migration `0007_seed_blueprints`
  seeds "Plan → Execute" and "Backfill Tests" at fixed ids; the ignite dialog starts
  on the former by id (`DEFAULT_BLUEPRINT_ID`), falling back to no blueprint if that
  row has been deleted. The seed adopts a hand-made "Plan → Execute" rather than
  colliding with its unique name — it repoints that row's jobs and drops it.
- **Blueprints are versioned.** `blueprints.version` is bumped on every save and each
  version's full content is appended to `blueprint_revisions` in the same transaction,
  so the history can never lag the version the row claims. The number rides along on
  the job's snapshot (`BlueprintSnapshot.version`, optional — jobs from before
  versioning have none and render as a bare name), which is what makes *did v4 beat
  v3* answerable from the ledger. Restoring an old version writes a **new** one rather
  than reopening it: a job that ran v3 has to keep meaning what it meant.
- `blueprint_revisions.source` is how shipped blueprints stay upgradable. A migration
  may improve a blueprint in place only while its newest revision is still `seed`;
  the first `user` revision hands the row over for good. Future seed upgrades take
  this shape, and must bump `version` and append a `seed` revision like any other save:

  ```sql
  UPDATE "foundry"."blueprints" b SET "steps" = $steps$…$steps$::jsonb, "version" = b."version" + 1
   WHERE b."id" = '5eeded00-…-0001'
     AND (SELECT r."source" FROM "foundry"."blueprint_revisions" r
           WHERE r."blueprint_id" = b."id" ORDER BY r."version" DESC LIMIT 1) = 'seed';
  ```
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
- **Logs are files, not rows** (LIA-18). Each job appends `{t, stream, text}` records
  to `~/.foundry/logs/<id>.jsonl`, one JSON object per line, the way Claude Code keeps
  a session under `~/.claude/projects/`. They are append-only, per-job, never joined
  and never updated, so a table bought nothing and cost a round trip per batch plus a
  full `SELECT` on every one-second poll of the detail sheet. As files they are also
  `tail -f`-able and `jq`-able without the app. `server/job-logs.ts` is the only
  module that touches them: appends are serialised per job id so concurrent writers
  (the runner, the container's callback, the queue pump) cannot interleave, a
  malformed line is skipped on read rather than thrown on, and a write that fails
  warns instead of failing the job. `purgeJobs` unlinks the files it deletes rows for,
  in place of the FK cascade `job_logs` used to have. The files sit outside
  `~/.foundry/jobs/` so `foundry jobs prune` clears workspaces without taking the
  history with them.
- **Branch names carry the job's short id.** `branchSlug` keeps only the first
  three words of the task, so two jobs on one repo often derive the same slug —
  and the runner's `ls-remote` check cannot separate concurrent ones, since
  neither has pushed when both look. The id suffix makes the name unique by
  construction (`FOUNDRY_MAX_JOBS` allows 3 at once) and reads back to the row.
- The **PR CLI** is picked by origin host in `server/forge-pr.ts`: `bb` for
  bitbucket.org, `gh` for github.com, anything else pushes the branch and says so.
- **Linear ticket links** are filed by the host for Bitbucket PRs only
  (`server/linear-link.ts`). Linear's GitHub integration already reads the
  `Closes LIA-24` magic word out of a PR description and files the link itself;
  Linear has no Bitbucket integration, so an identical description lands on a
  forge nothing is watching. For a `bb` origin the runner pulls the magic-word
  ticket ids out of the PR body and creates the attachment through Linear's API
  with `LINEAR_API_KEY` from `~/.foundry/env` — host-side, like `bb` itself, so
  the key never enters a forge. No key means no link and no complaint, and a
  failure is logged rather than fatal: the PR is already open by then. It is a
  one-shot link, not a sync — Bitbucket sends nothing back on merge, so ticket
  status stays yours to move.
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

`db:migrate` also carries two one-time hand-overs, both idempotent: it adopts
`~/.foundry/repos.json`, which is where the imported set used to live (leaving the
file alone — `~/.foundry` is the CLI's state directory), and it exports any remaining
`job_logs` rows to `~/.foundry/logs/<id>.jsonl` *before* the migration that drops that
table, so no job loses its output. A job that already has a log file is skipped, so
the export can never clobber one that is being written right now.

`DATABASE_URL` comes from `web/.env` (copy `.env.example`; bun loads it automatically),
and falls back to the local stack's URL so a fresh clone needs no configuration.
`bun run infra:url` from the repo root prints it.

| table | holds |
|---|---|
| `repos` | the imported set — what a job may target |
| `blueprints` | reusable step lists; `steps` is one jsonb column, edited and consumed whole |
| `blueprint_revisions` | every version a blueprint has held, append-only; the columns above cache the newest |
| `jobs` | one row per job; a job *is* the run here, so there is no separate runs table |

Log lines are deliberately not a table: they live in `~/.foundry/logs/<id>.jsonl`
(LIA-18, above). `bun run db:migrate` exports any rows left in the old `job_logs`
table to those files before dropping it, so an existing database keeps its history —
the same one-time-adoption pattern `src/db/migrate.ts` uses for `~/.foundry/repos.json`.

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
      server/job-logs.ts      node-only: ~/.foundry/logs/<id>.jsonl, append + read
      server/job-runner.ts    node-only: preflight, clone, docker run, push, settle
      server/job-events.ts    node-only: callback auth + stream-json -> the JSONL log
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
