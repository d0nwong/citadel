# Intent: one repo for argus, Foundry and Pensieve

Confirmed 2026-09-11. This is what the consolidation is for; the spec says how.

## Outcome

One repo, `citadel`, with Bun workspaces (`apps/argus`, `apps/foundry`, `apps/pensieve`), and one
`docker compose up` that runs the whole stack: the MCP gateway, Postgres, Pensieve, Foundry and
the sweep. The same stack deploys later with little extra work.

## Why now

- A change that crosses repos (the MCP gateway move) takes three commits in three repos, and one
  of them sat unpushed.
- Three `.env` files, three bootstraps, three compose files.
- The sweep commits onto whatever branch the argus working tree has checked out.

## Success

- A fresh clone with one `.env` gets the loop running with `just bootstrap && docker compose up`.
- A cross-cutting change is one PR.
- The sweep never touches a developer's checkout.

## Decisions

- **History:** each repo's git history is kept, rewritten into its `apps/<name>/` directory with
  `git filter-repo`.
- **Data:** ledgers and sweep state move from git files into Postgres (a JSONB document per
  feature and a `ledger_revisions` table, one row per feature per run, for time travel), behind
  the existing `argus` verbs. Arch docs stay markdown in the repo. Pensieve is the only review
  surface; nobody reads sweep runs through `git log`.
- **CLIs:** `argus` and `accio` keep their names and verbs; only paths change.
- **Commands:** `just` for ops (bootstrap, Linear/Slack auth, migrations, compose, psql, running
  the sweep once, release). Each app's `package.json` keeps its own dev tasks (`dev`, `build`,
  `check`, `typecheck`, `test`). just recipes may call bun, never the other way round.
- **Versioning:** release-please in manifest mode, one version per app. argus owns `infra/` and
  the root files. Each image is tagged with its app's version and compose pins the tags.
- **Sweep auth in the container:** `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, on the
  subscription rather than a billed API key. The same token unblocks Pensieve's Ask in Docker.
- **Foundry:** runs in compose with the host Docker socket mounted, so it can start forges.

## Order

1. Move into the monorepo and compose, with the data still in files.
2. Swap storage to Postgres behind the verbs, as its own step.

## Out of scope

- Deploying to the cloud. Deferred until the loop is reliable.
- DynamoDB.
- Changing the ledger schema.
- Making Foundry decide anything. It stays a pure executor; argus decides.
