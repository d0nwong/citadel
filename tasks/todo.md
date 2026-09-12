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
    (Claude Code strips that variable from a headersHelper's environment, so a container hands
    the token over as a secret file instead; see T13.)
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
- [x] **T10: Add the just stack and database recipes.** (S–M)
  - Acceptance: `up`, `down`, `logs`, `ps`, `migrate`, `psql`, `sweep-once` and `release-dry`
    replace `infra.sh`, `db.sh` and the delegating `package.json` scripts.
  - Verify: `just --list` shows each with a doc line, and
    `grep -rn "infra.sh\|db.sh" apps` is empty.
  - Files: `justfile`, `apps/foundry/package.json`, deleted scripts.
  - Done: `up`, `down`, `ps`, `logs`, `migrate`, `db-generate`, `db-studio`, `db-url`, `psql`,
    `serve foundry|pensieve`, `setup-bb`; `scripts/stack.ts` holds the preflight, the URL and
    psql. `infra.sh`, `db.sh` and Foundry's delegating scripts are gone; `foundry setup` calls
    `just up postgres mcp` and `just migrate`. `set positional-arguments`: a quoted argument
    (SQL, a path) reaches the script whole. `sweep-once` lands with T14 and `release-dry` with
    T16, where they have something to act on.

## Phase 5: Stack

- [x] **T11: Bring up the gateway and Postgres from the root compose.** (S)
  - Acceptance: the root `compose.yaml` `include:`s `apps/argus/infra/compose.yaml` (mcp) and
    `apps/foundry/infra/compose.yaml` (postgres).
  - Verify: `just up && just ps` shows both healthy, and `curl :9090/_readyz` returns 200.
  - Files: `compose.yaml`, both infra compose files.
  - Done: root `compose.yaml` (`name: citadel`) includes both files, each given the root .env.
    The fixed container names are gone (they clashed with the live `argus-mcp` and
    `foundry-postgres`). Postgres keeps the `foundry-pgdata` volume by default so Foundry's
    history survives cutover; `POSTGRES_VOLUME` moves a trial stack, and `just up` refuses a
    volume a container from another project holds. Trial on project `citadel-t11`, ports
    19090/15432 and a throwaway volume: both healthy, `/_readyz` 200, migrations applied, the
    guard refused `foundry-pgdata`; the live stack was untouched.
- [x] **T12: Foundry web stays on the host; `just foundry` runs it.** (decided at checkpoint B)
  - Why: Foundry web runs `git push` and opens PRs with `gh` and `bb` using keychain-backed
    credentials a container cannot read. Containerizing it (tokens, a credential helper,
    same-path mounts for `~/git` and `~/.foundry`, the Docker socket, and T2's `server.ts`) moves
    to the deploy work.
  - Done: `just foundry` runs the dev server with the stack's DATABASE_URL; it reads the root
    .env itself. Pensieve's container reaches it at `host.docker.internal:3777`. Until cutover the
    live Foundry holds :3777 and the live postgres :5432, so it is for after the switch.
- [x] **T13: Add the Pensieve service.** (M, needs T7)
  - Acceptance: an image that includes `apps/argus`, mounts `argus-data` read-only except for
    `decisions/`, and mounts the FE/BE clones read-only. Ask runs on `CLAUDE_CODE_OAUTH_TOKEN`,
    and Send reaches `http://foundry-web:3777`.
  - The data mount can't be `/workspace`: that is the sandbox's virtual name for Ask's cwd
    (`ARGUS_DIR`). Mount it at `/argus-data` and set `WORKSPACE_DIR` and `ARGUS_DIR` explicitly.
  - Verify: the smoke test in the spec (feature page, a click verb, Send, an Ask answer).
  - Done: the image builds from the repo root with argus's code, trusts `/app/apps/argus`, and
    sets a system-wide git `safe.directory`; a root `.dockerignore` keeps `.env` out (checked:
    none in the image). Compose passes only Pensieve's keys, mounts the data at `/argus-data`,
    the FE/BE checkouts read-only, and a volume for Claude's transcripts so a resumed
    conversation survives a restart. Three fixes found by the trial: `apps/argus/.claude/
    settings.json` approves the linear and slack servers (trust alone left them pending); the
    gateway token reaches the headersHelper as a compose secret file, because Claude Code runs
    helpers without secret-looking variables; the gateway's healthcheck waits for every
    upstream route. Trial on port 13778 against a copy of the data: pages serve, Claude is
    logged in by token, both MCP servers connect, `argus show` reads the data. Send waits on
    T12's decision.
  - Files: `apps/pensieve/Dockerfile`, `apps/pensieve/compose.yaml`.

**Checkpoint B:** the stack runs without the sweep. Review before T14. (passed 2026-09-11)

- [x] **T14: Add the sweep image and service, behind a profile.** (M–L, needs T1)
  - Acceptance: the image has bun, the claude CLI, git and the argus code. On first start,
    `loop.sh` clones `d0nwong/argus` into `argus-data` and FE/BE into `product` (with
    `BITBUCKET_TOKEN`), then loops `flock … claude -p "/sweep"` every 900 seconds and pushes with
    `GH_TOKEN`. The service is under `profiles: [sweep]`.
  - Verify: `just sweep-once` with `argus pull --dry-run` prints a batch, `just up` doesn't
    start the sweep, and a second `sweep-once` while one is running exits on the lock.
  - Files: `apps/argus/Dockerfile`, `apps/argus/infra/compose.yaml`, `apps/argus/infra/sweep/loop.sh`.
  - Done: `citadel/sweep` runs as `bun` (uid 1000; root is refused). `loop.sh` clones what is
    missing, runs `/sweep` under `.git/sweep.lock`, and pushes only when a `gh_token` secret exists.
    Recipes `sweep-once [--dry-run]`, `sweep-on`, `sweep-off`; the preflight refuses a real tick
    while the host's `/loop 15m /sweep` runs. Trial on a copy of the data: FE/BE cloned with the
    API-token git username, `argus pull --dry-run` printed a batch and wrote nothing, the lock and
    the refusal held, both MCP servers connect, Bitbucket REST 200. `GH_TOKEN` is still unset:
    create a fine-grained token (contents: write on d0nwong/argus) before cutover.

## Phase 6: Release, CI, docs

- [x] **T15: Update the docs and paths.** (M)
  - Acceptance: a root README; CLAUDE.md, argus SPEC.md's Commands and Structure sections, the
    skill path references and Ask's allowlist all point at the new paths.
  - Verify: `grep -rn "git/argus\|git/foundry\|git/pensieve" apps docs` returns only intended
    hits, and `bun run --filter argus test` (`skills.test.ts`) passes.
  - Files: `README.md`, `apps/argus/CLAUDE.md`, `SPEC.md`, `skills/*`, Pensieve's `ask-tools.ts`.
  - Done: a root README; argus's README, SPEC, CLAUDE.md and sweep skill now name `apps/…`, the
    data repo (`ARGUS_ROOT`) and the sweep service instead of `/loop 15m /sweep`; Pensieve's and
    Foundry's READMEs, CONTRIBUTING, `infra/README.md` and `serve.sh` use the recipes. Ask's
    allowlist needed nothing: its rules are relative to argus's directory, which is still the
    working directory, and the FE/BE defaults are right on a host and set by env in the stack.
- [x] **T16: Set up release-please.** (S)
  - Acceptance: the manifest and config from the spec, `bootstrap-sha` set to the T4 merge, and
    the workflow and `pr-title.yml` moved from Foundry with app scopes.
  - Verify: `just release-dry` proposes nothing on a clean main, and a `feat(pensieve):` commit
    on a scratch branch proposes only `pensieve-v0.2.0`.
  - Files: `release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/*`.
  - Done: manifest mode at the root, component tags, `bootstrap-sha` at the argus import merge
    (9eac352) so imported history is never re-released. Foundry keeps 1.4.0 and its tag, with 16
    commits after it to release; argus and Pensieve start at 0.1.0. Its workflows moved from
    `apps/foundry/.github` to the root, where GitHub reads them, and the release token falls back
    to `GITHUB_TOKEN`. `just release-dry` shows what it would propose — it needs a GH_TOKEN,
    so it is unrun so far.
- [x] **T17: Add CI.** (S)
  - Acceptance: `ci.yml` installs once, then typechecks, tests and checks each app whose paths
    changed.
  - Verify: a PR touching only Pensieve runs only Pensieve's jobs, and they pass.
  - Files: `.github/workflows/ci.yml`.
  - Done: one job — install once, typecheck Pensieve and foundry-web, then the four test suites,
    with a postgres service and the extensions the local stack's init SQL creates. Checked
    locally the way a runner has it: Pensieve's tests pass with no data directory and no `claude`
    on PATH. argus's 12 pre-existing type errors were fixed (unchecked indexes and regex groups),
    so its typecheck is in CI too. Lint stays out: foundry-web has 1133 Biome diagnostics,
    Pensieve 2, all pre-existing. Path filters were not worth it — the whole job is seconds.

**Checkpoint C** (2026-09-12): criteria 1–4 are met — histories, a fresh clone that installs,
typechecks and passes its tests, `just bootstrap`/`just check` on a clean machine, and one
`just up` with the gateway, postgres and Pensieve healthy, `just foundry` on the host, Ask's
servers connected and the pages serving. Criterion 6 (release-please proposes one app's version)
waits on a `GH_TOKEN`. Criterion 5 is cutover, below.

## Phase 7: Cutover (ask before each step)

- [x] **T18: Cut the sweep over.** In order, one at a time:
  1. `just auth gh` — a fine-grained GitHub token, contents: write on the data repo alone.
     Without it the sweep commits locally and never pushes.
  2. `just auth bitbucket` — the account's email and a read-only Atlassian API token
     (`read:repository:bitbucket`, `read:pipeline:bitbucket`) for the product repos and pipelines.
  3. Stop the host loop if it runs (`pgrep -f 'loop 15m /sweep'`), and push `~/git/argus`.
  4. Make sure the old containers stay stopped: citadel's stack wants 9090, 5432 and 3778.
  5. `just link` — the 9 links (dry-run checked: bun's global argus link, foundry, seven skills).
  6. `just up` — gateway, postgres, Pensieve.
  7. `just foundry` — Foundry's web UI on this Mac.
  8. `just sweep-on` — the loop, one tick per SWEEP_INTERVAL against `ARGUS_DATA_DIR`.
  - Done 2026-09-12: both tokens checked first (GitHub push on d0nwong/argus, Bitbucket REST and
    git). `just link` moved 9 links; `just up` brought the gateway, postgres and Pensieve up in
    13s over the live data; Foundry runs on the host. The first container tick cloned the product
    repos, read Slack and both repos, closed A-1 on admin/projects, refreshed six arch docs,
    validated 26 features, committed `93fd26f` and pushed it. Pensieve renders the result.
    Commits are authored `argus sweep <sweep@citadel.local>` (`SWEEP_GIT_NAME`/`SWEEP_GIT_EMAIL`
    change that). `.state/last-api-sync.md` stays modified: `argus commit` stages only ledgers,
    threads and docs.
  - Criterion 6 done 2026-09-12: `just release-dry` proposes one pull request — argus 0.1.0 →
    0.2.0, foundry 1.4.0 → 1.5.0 (continuing from its imported tag), pensieve 0.1.0 → 0.2.0. It
    reads citadel, so it uses gh's token: `.env`'s GH_TOKEN is scoped to the data repo alone.
  - Left: after 24 hours, check that ticks keep landing in `d0nwong/argus` and that no commit
    appeared that the sweep did not make (criterion 5).
- [ ] **T19: Archive and trim.** Archive `d0nwong/foundry` and `d0nwong/pensieve` with a
  pointer README, and delete argus's code from `d0nwong/argus` in one commit.
  - Verify: the sweep still ticks after the trim.
