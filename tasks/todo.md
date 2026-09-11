# Todo: citadel, step 1

See `tasks/plan.md` for the order and the checkpoints.

## Phase 1: De-risk

- [x] **T1: Check that headersHelper runs under `claude -p` in a container.** (S)
  - Acceptance: a throwaway container (bun + claude CLI, apps/argus `.mcp.json`,
    `MCP_GATEWAY_URL=http://host.docker.internal:9090`, `CLAUDE_CODE_OAUTH_TOKEN`) lists
    `mcp__linear__*` tools in `claude -p`. If it can't, the pre-trust fix is found and written into the spec.
  - Verify: `claude -p "list your mcp tools" --output-format json` shows both servers.
  - Files: `docs/spec/consolidation.md` (the outcome).
  - Done: it fails without persisted trust and works with `hasTrustDialogAccepted`; recorded in the spec.
- [x] **T2: Get Foundry web running in production mode.** (S–M)
  - Acceptance: `vite build` output is served by a Bun entry (as in Pensieve's `server.ts`) on
    :3777, with its server functions and job API working.
  - Verify: `curl :3777/api/jobs` with the bearer returns 200, and the forge list renders.
  - Files: `web/server.ts` (new), `web/package.json` (`start`), spec.
  - Done: the build and entry work. `server.ts` lands in citadel in T12 (a copy is in the scratchpad).

## Phase 2: One repo

- [x] **T3: Import Foundry and Pensieve with their histories.** (M)
  - Acceptance: the docs commit comes first, then Foundry under `apps/foundry` and Pensieve
    under `apps/pensieve`. Each is merged with `--allow-unrelated-histories`. Foundry's tags are
    already `foundry-v*`, and Pensieve has none.
  - Verify: `git log --oneline -- apps/foundry | wc -l` is 136, the same for `apps/pensieve` is
    102, and `git log --follow apps/foundry/bin/foundry` reaches its first commit.
  - Files: history only.
  - Done: `git rev-list --count <merge>^2` is 136 and 102 (a path-limited `git log` leaves out
    merges and empty commits, so it reads lower).
- [x] **T4: Import argus's code-only history into `apps/argus`.** (M)
  - Acceptance: `filter-repo --path` keeps scripts, skills, .claude, evals, tasks, docs, infra,
    SPEC.md, README.md, CLAUDE.md, package.json, tsconfig.json, bun.lock, .mcp.json,
    .gitignore, .env.example and .cursor. There are no `alden/`, `*/features/`, `state/` or
    `.state/` paths, and the `pre-rebuild` tag becomes `argus-pre-rebuild`.
  - Verify: `git ls-files apps/argus` matches the argus checkout's code paths, and
    `git log --oneline -- apps/argus | grep -c "quiet run"` is 0.
  - Files: history only.
  - Done: 223 commits, no data paths, no "quiet run" commits, no code file missing.
- [x] **T5: Set up one Bun workspace.** (M)
  - Acceptance: a root `package.json` with `workspaces` and `packageManager: bun@1.4.0`, one
    `bun.lock`, and the per-app lockfiles removed. The `argus` and `accio` bins resolve.
  - Verify: `bun install && bun run --filter '*' typecheck && bun run --filter '*' test`, and
    `bun run argus validate` against `ARGUS_ROOT=~/git/argus`.
  - Files: `package.json`, `bun.lock`, each app's `package.json`.
  - Baseline before the switch: Foundry web 34/34, Pensieve 135 pass. argus typecheck was already
    broken on a clean install (`@types/bun` dropped in d8f3405; the old checkout's stale
    `node_modules` hid it), so T5 declares it. 11 argus tests read data (OpenAPI cache, accio
    index, arch docs) and fail without it; T6 fixes them. The bar for T5 is "same as baseline".
  - Done: one `bun.lock`, results identical to baseline. `latest` pins resolved to the old
    locks' versions; Foundry web's react-query went 5.102.0 → 5.102.8 to match Pensieve (two
    copies of query-core broke its router types); argus got a `test` script.
  - Follow-up (not step 1): argus's 12 pre-existing type errors, the same 12 in the old checkout.

**Checkpoint A:** histories and workspace are green. Review, then push citadel `main`.

## Phase 3: Seams

- [x] **T6: Make all of argus honor `ARGUS_ROOT`.** (S)
  - Acceptance: `accio` (`manifest.ts`, `find.ts`) resolves data from `ARGUS_ROOT`, and
    `mcp-headers.ts` reads the repo-root `.env`.
  - Verify: the 11 data-reading argus tests pass with `ARGUS_ROOT=~/git/argus`, new tests in
    `scripts/argus/paths.test.ts` and `scripts/accio.test.ts` pass, and
    `ARGUS_ROOT=~/git/argus bun run accio stale` matches running it from the old checkout.
  - Files: `apps/argus/scripts/accio/manifest.ts`, `find.ts`, `mcp-headers.ts`, the tests.
  - Done: accio's `DATA_ROOT` (ARGUS_ROOT, else the checkout) feeds the app, manifest, features
    and `.state`; `ROOT` stays the code root. evals read features from it too. The data tests
    skip without data (135 pass, 13 skip) and all 148 pass with `ARGUS_ROOT=~/git/argus`.
    `mcp-headers.ts` prefers `MCP_GATEWAY_TOKEN` from the environment, then the root `.env`.
- [x] **T7: Split code from data in Pensieve.** (M)
  - Acceptance: `WORKSPACE_DIR` is the data, a new `ARGUS_DIR` (default `../argus`) is the code,
    verbs are spawned as `bun $ARGUS_DIR/scripts/argus.ts` with `ARGUS_ROOT=$WORKSPACE_DIR`, and
    Ask's cwd is `ARGUS_DIR`.
  - Verify: `bun run --filter pensieve test` (including `ask.test.ts`), and a feature page plus
    one click verb work in dev.
  - Files: `src/server/workspace.ts`, `argus.ts`, `ask.ts`, `.env.example`.
  - Done: `ARGUS_DIR` (env, else `../argus`, else the workspace) is the code. Verbs run
    `bun $ARGUS_DIR/scripts/argus.ts` with the data as cwd and `ARGUS_ROOT`. Ask's sandbox is
    `ARGUS_DIR`, with the data as `addDirs`, `env.ARGUS_ROOT`, `git -C <data>` read rules and
    absolute data paths in its prompt. 137 pass; a real `argus show tasks` from citadel
    against `~/git/argus` returns ok and writes nothing.
- [x] **T8: Move to one `.env`.** (M)
  - Acceptance: a root `.env.example` holds every key once (`FOUNDRY_MCP_TOKEN` becomes
    `MCP_GATEWAY_TOKEN`, and `BITBUCKET_TOKEN` and `GH_TOKEN` are added). Foundry reads the root
    `.env`. `ARGUS_ENV`, `argus-env.sh` and the liamai fallback are gone.
  - Verify: `grep -rn "ARGUS_ENV\|liamai/env\|argus-env" apps` is empty, and Foundry's and
    Pensieve's tests pass.
  - Files: `.env.example`, `apps/foundry/bin/foundry`, `web/.../foundry-env.ts`, `job-api.ts`,
    Pensieve's `package.json` scripts.
  - Done: one root `.env.example`; the four app copies are gone. Foundry (CLI and web) reads the
    root `.env`, with the environment as the fallback in a container, and sends forges
    `FOUNDRY_MCP_TOKEN=$MCP_GATEWAY_TOKEN`; `migrate_env`, `ARGUS_ENV` and the liamai fallback
    are gone. Pensieve's `root-env.sh` replaces `argus-env.sh` and exports only Pensieve's own
    keys (checked: a Slack or gateway token in the file never reaches it). Foundry web 34/34,
    Pensieve 137/0, no new lint.
  - Left for later: the old names still appear in the argus and Pensieve bootstraps (T9
    replaces them) and in Foundry's and Pensieve's READMEs (T15).

## Phase 4: Ops

- [x] **T9: Add the just environment recipes.** (M)
  - Acceptance: `bootstrap`, `check`, and `auth linear|slack|claude|foundry-api` port the three
    `bootstrap.sh` scripts and `foundry auth`. They're safe to run twice and write `.env` with
    mode 600.
  - Verify: on a scratch clone, `just bootstrap` then `just check` reports nothing missing, and
    running `just bootstrap` again changes nothing.
  - Files: `justfile`, `scripts/*.ts` for anything longer than a few lines; old bootstraps deleted.
  - Done: `justfile` (`bootstrap`, `check`, `auth`) over `scripts/bootstrap.ts`: phases prereqs,
    identity, deps, env, trust, data, home, links, forge, plus `import <file>...` (copies only
    keys the .env lacks and .env.example names) and `auth linear|slack|claude|foundry-api|gateway`.
    Checked on a scratch copy: `check` creates nothing; a run without a terminal creates a
    mode-600 .env and mints the two tokens; a second run leaves it byte-identical; no secret in
    any output. No global `set dotenv-load` (it would hand the Slack token to every recipe).
- [ ] **T10: Add the just stack and database recipes.** (S–M)
  - Acceptance: `up`, `down`, `logs`, `ps`, `migrate`, `psql`, `sweep-once` and `release-dry`
    replace `infra.sh`, `db.sh` and the delegating `package.json` scripts.
  - Verify: `just --list` shows each with a doc line, and
    `grep -rn "infra.sh\|db.sh" apps` is empty.
  - Files: `justfile`, `apps/foundry/package.json`, deleted scripts.

## Phase 5: Stack

- [ ] **T11: Bring up the gateway and Postgres from the root compose.** (S)
  - Acceptance: the root `compose.yaml` `include:`s `apps/argus/infra/compose.yaml` (mcp) and
    `apps/foundry/infra/compose.yaml` (postgres).
  - Verify: `just up && just ps` shows both healthy, and `curl :9090/_readyz` returns 200.
  - Files: `compose.yaml`, both infra compose files.
- [ ] **T12: Add the foundry-web service.** (M, needs T2)
  - Acceptance: an image built from the workspace, with `docker.sock` and a `foundry-home`
    volume mounted, and the host's `~/git` mounted at the same absolute path. Migrations run
    through `just migrate`, and it reaches the gateway at `http://mcp:9090`.
  - Verify: `POST /api/jobs` starts a forge job that settles, and the forge reaches Linear MCP.
  - Files: `apps/foundry/infra/Dockerfile.web`, its compose file.
- [ ] **T13: Add the Pensieve service.** (M, needs T7)
  - Acceptance: an image that includes `apps/argus`, mounts `argus-data` read-only except for
    `decisions/`, and mounts the FE/BE clones read-only. Ask runs on `CLAUDE_CODE_OAUTH_TOKEN`,
    and Send reaches `http://foundry-web:3777`.
  - The data mount can't be `/workspace`: that is the sandbox's virtual name for Ask's cwd
    (`ARGUS_DIR`). Mount it at `/argus-data` and set `WORKSPACE_DIR` and `ARGUS_DIR` explicitly.
  - Verify: the smoke test in the spec (feature page, a click verb, Send, an Ask answer).
  - Files: `apps/pensieve/Dockerfile`, `apps/pensieve/compose.yaml`.

**Checkpoint B:** the stack runs without the sweep. Review before T14.

- [ ] **T14: Add the sweep image and service, behind a profile.** (M–L, needs T1)
  - Acceptance: the image has bun, the claude CLI, git and the argus code. On first start,
    `loop.sh` clones `d0nwong/argus` into `argus-data` and FE/BE into `product` (with
    `BITBUCKET_TOKEN`), then loops `flock … claude -p "/sweep"` every 900 seconds and pushes with
    `GH_TOKEN`. The service is under `profiles: [sweep]`.
  - Verify: `just sweep-once` with `argus pull --dry-run` prints a batch, `just up` doesn't
    start the sweep, and a second `sweep-once` while one is running exits on the lock.
  - Files: `apps/argus/Dockerfile`, `apps/argus/infra/compose.yaml`, `apps/argus/infra/sweep/loop.sh`.

## Phase 6: Release, CI, docs

- [ ] **T15: Update the docs and paths.** (M)
  - Acceptance: a root README; CLAUDE.md, argus SPEC.md's Commands and Structure sections, the
    skill path references and Ask's allowlist all point at the new paths.
  - Verify: `grep -rn "git/argus\|git/foundry\|git/pensieve" apps docs` returns only intended
    hits, and `bun run --filter argus test` (`skills.test.ts`) passes.
  - Files: `README.md`, `apps/argus/CLAUDE.md`, `SPEC.md`, `skills/*`, Pensieve's `ask-tools.ts`.
- [ ] **T16: Set up release-please.** (S)
  - Acceptance: the manifest and config from the spec, `bootstrap-sha` set to the T4 merge, and
    the workflow and `pr-title.yml` moved from Foundry with app scopes.
  - Verify: `just release-dry` proposes nothing on a clean main, and a `feat(pensieve):` commit
    on a scratch branch proposes only `pensieve-v0.2.0`.
  - Files: `release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/*`.
- [ ] **T17: Add CI.** (S)
  - Acceptance: `ci.yml` installs once, then typechecks, tests and checks each app whose paths
    changed.
  - Verify: a PR touching only Pensieve runs only Pensieve's jobs, and they pass.
  - Files: `.github/workflows/ci.yml`.

**Checkpoint C:** success criteria 1–4 and 6 are met.

## Phase 7: Cutover (ask before each step)

- [ ] **T18: Cut the sweep over.** Add `just link` first: it repoints what bootstrap only
  reports: the Bun global link behind `argus`/`accio` (`~/.bun/install/global/node_modules/argus`),
  `~/.local/bin/foundry`, and the global skills (`bun scripts/sync-skills.ts` from apps/argus).
  Then Stop the host `bun run sweep`, push `d0nwong/argus`, then
  `docker compose --profile sweep up -d sweep`.
  - Verify: after 24 hours, ticks are visible in `d0nwong/argus`, `~/git/argus` has no new
    commits, and Pensieve is current (success criterion 5).
- [ ] **T19: Archive and trim.** Archive `d0nwong/foundry` and `d0nwong/pensieve` with a
  pointer README, and delete argus's code from `d0nwong/argus` in one commit.
  - Verify: the sweep still ticks after the trim.
