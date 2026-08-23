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

## Status: jobs and repos are real, forges are mocked

**Real:** jobs and repos, both in Postgres (`bun run infra:up` from the repo root).
Everything that touches the database goes through `createServerFn`, so the node-only
modules never enter the client bundle.

- `features/jobs/server/job-store.ts` — the ledger. Creating a job writes a row; it
  survives a reload, which is the whole point.
- `features/repos/server/repo-scan.ts` — scans `~/git` with `node:fs`, reads each repo's
  branch, dirty state and last-commit time via `git`, and keeps the *imported* set in
  the `repos` table. Branch and dirty state are deliberately not stored: they are facts
  about the working tree right now.

**Still mocked:** forges, from `src/mocks/foundry-store.ts`. Their real source is
`foundry ls` / docker labels.

**Nothing runs yet.** A job is created `queued` and stays there — executing it is
LIA-13. The ledger no longer animates, because the ticker that used to fake that has
been deleted along with the jobs mock.

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
| `jobs` | one row per job; a job *is* the run here, so there is no separate runs table |
| `job_logs` | one row per log line, append-only, streamed in as a job runs |

`jobs.repo_id` links to the repo when there is one, and `jobs.repo` keeps an immutable
`RepoRef` snapshot beside it — a job can target a git URL that was never imported, and
un-importing a repo must not blank out the history of jobs that ran against it.

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

The second adapter listed on the Forges page is illustrative mock data — it exercises
the ephemeral rendering path. There is no remote adapter implementation.

## Layout

Feature-based. `src/routes/` is URL shape only — every route file is a few lines that
render a component from a feature.

```
src/
  routes/                     thin adapters, URL-shaped (generated route tree)
    __root.tsx                document shell, AppShell, toaster
    index.tsx  forges.tsx
  features/
    jobs/
      components/             job-ledger, new-job-dialog, job-detail-sheet, job-status-chip
      queries.ts              queryOptions — what routes and components import
      api.ts                  createServerFn wrappers
      server/job-store.ts     node-only: the postgres queries
      types.ts
    forges/
      components/             forge-inventory, forge-card, forge-dot
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
  mocks/
    foundry-store.ts          ← forges only; deleted once they are real
```

Cross-feature imports go through `queries.ts` — the jobs dialog reads `forgeQueries`
and `repoQueries`, never another feature's internals. There are deliberately no barrel
`index.ts` files (see the server-code note below).

`components.json` aliases point at `#/shared/*`, so `bunx shadcn@latest add <x>` lands
in `src/shared/ui` without further edits.

## Wiring it to the real orchestrator

`src/mocks/` is the only place left that knows any data is fake, and it is down to
forges. `features/forges/api.ts` wraps that slice, so it becomes real by changing that
wrapper and deleting `src/mocks/`.

| feature module | becomes |
|---|---|
| `features/forges/api.ts` | `foundry ls` / docker labels, via a `server/` module |
| `mocks/foundry-store.ts` | delete |

`features/jobs/api.ts` and `features/repos/api.ts` are the worked examples of the
pattern: thin `createServerFn` wrappers whose handlers `await import()` a node-only
module.

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
