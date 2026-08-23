# foundry/web

POC frontend for the Foundry orchestration layer. **TanStack Start** (SSR, file-based
routing) + **shadcn/ui** + **Tailwind v4**, running on **bun**.

```sh
bun install
bun run dev      # http://localhost:3777
bun run build
```

## Status: repos are real, the rest is mocked

**Real:** repo discovery. `features/repos/server/repo-scan.ts` scans `~/git` with
`node:fs`, reads each repo's branch, dirty state and last-commit time via `git`, and
persists your selection to `~/.foundry/repos.json` — the same state directory the CLI
uses. Reached through `createServerFn`, so the node-only module never enters the client
bundle.

**Still mocked:** jobs and forges, from `src/mocks/foundry-store.ts`, with a ticker that
walks jobs `queued → running → settled`. Seeded job history therefore references
placeholder repo paths that will not match your real ones — that resolves when jobs
become real. Mock state resets on a full page reload; the repo selection does not,
because it is on disk.

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
      api.ts                  data access (mocked; repos/api.ts is already real)
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
  mocks/
    foundry-store.ts          ← jobs + forges only; deleted once they are real
```

Cross-feature imports go through `queries.ts` — the jobs dialog reads `forgeQueries`
and `repoQueries`, never another feature's internals. There are deliberately no barrel
`index.ts` files (see the server-code note below).

`components.json` aliases point at `#/shared/*`, so `bunx shadcn@latest add <x>` lands
in `src/shared/ui` without further edits.

## Wiring it to the real orchestrator

`src/mocks/` is the only place that knows the data is fake. Each feature owns a thin
`api.ts` wrapping it, so swapping in real endpoints means changing those wrappers and
deleting `src/mocks/`.

| feature module | becomes |
|---|---|
| `features/jobs/api.ts` | `GET/POST /api/jobs`, `POST /api/jobs/:id/cancel` |
| `features/forges/api.ts` | `GET /api/forges` → `foundry ls` |
| `mocks/foundry-store.ts` | delete, simulator included |

`features/repos/api.ts` is already real and is the worked example of the pattern: thin
`createServerFn` wrappers whose handlers `await import()` a node-only module.

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
