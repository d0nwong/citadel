# foundry

Orchestration layer for disposable **Claude Code forges** running on OrbStack.

Each forge is a Linux container with `claude`, `git`, `gh`, `node`, `bun`, `pnpm`, `python3`, and the
usual CLI tooling. Forges are cheap (<1s to start), isolated from your Mac, and
addressable at `<name>.foundry.local`.

## Architecture

```mermaid
flowchart LR
    subgraph host["macOS host"]
        cli["foundry CLI<br/>(bin/)"]
        web["Web UI<br/>(web/, bun · :3777)"]
        pg[("Postgres<br/>(infra/, :5432)")]
        mcp["MCP gateway<br/>(argus's infra/, mcp-proxy · :9090)"]
        auth[".env (repo root)<br/>CLAUDE_CODE_OAUTH_TOKEN · FOUNDRY_MCP_TOKEN<br/>FOUNDRY_API_TOKEN"]
        argusenv["argus .env<br/>SLACK_TOKEN · LINEAR_API_KEY"]
        jobs["~/.foundry/jobs/&lt;id&gt;/<br/>workspace clones"]
        joblogs["~/.foundry/logs/&lt;id&gt;.jsonl<br/>job session logs"]
    end

    subgraph orb["OrbStack containers"]
        forge["forge<br/>&lt;name&gt;.foundry.local<br/>claude · git · gh · node · bun · pnpm · python3"]
        vols[("named volumes<br/>/work · ~/.claude · ~/.config")]
        jobforge["ephemeral job forge<br/>(no git creds, no DB)"]
    end

    caller["API caller<br/>CI · bot · agent · curl"]
    remote["GitHub / Bitbucket"]
    linear["Linear<br/>api.linear.app · MCP"]
    slack["Slack MCP<br/>mcp.slack.com"]

    cli -- "new · claude · shell · exec · run" --> forge
    auth -- "injected" --> forge
    auth -- "injected" --> jobforge
    forge --- vols
    forge -- "--github (opt-in token)" --> remote
    forge -. "gateway token" .-> mcp
    jobforge -. "gateway token" .-> mcp
    argusenv -- "upstream keys" --> mcp
    auth -- "API token" --> web
    argusenv -- "LINEAR_API_KEY" --> web
    mcp -- "LINEAR_API_KEY (host only)" --> linear
    mcp -- "SLACK_TOKEN (host only)" --> slack

    caller -- "POST /api/jobs<br/>FOUNDRY_API_TOKEN" --> web
    web -. "job.settled webhook<br/>HMAC-signed" .-> caller
    web -- "job ledger" --> pg
    web -- "clone repo" --> jobs
    web -- "append log lines" --> joblogs
    web -- "ignite job" --> jobforge
    jobforge -- "edits" --> jobs
    jobforge -. "progress callback<br/>host.docker.internal + per-job token" .-> web
    web -- "commit · push · PR<br/>(gh / bb, host creds)" --> remote
```

## Why containers, not `orb` machines

OrbStack Linux machines share your host `$HOME` — that's convenient but defeats the
point of a sandbox, and they boot far slower. Containers are reproducible from
`image/Dockerfile`, disposable, and still visible in the OrbStack UI.

## Setup

From a **brand-new Mac**, one script:

```sh
git clone https://github.com/d0nwong/citadel ~/git/citadel && cd ~/git/citadel
just bootstrap                 # host tooling, git identity, the one .env, dependencies
just check                     # or: report what's missing and change nothing
```

`just bootstrap` is the step *before* `foundry setup`, which checks for docker, bun and
gh and dies when they are missing. It installs them instead — OrbStack, bun, the
`claude` CLI, `gh`, `php` + the `bb` phar, `tailscale` — prompting before each one,
settles `git config --global user.name/user.email` (every forge inherits it), writes the one
`.env` at citadel's root and mints the tokens that can be minted, and reports what is left —
including where `foundry` on your PATH points, which cutover moves. Every phase is a no-op
when it's already done, and each runs on its own
(`just bootstrap prereqs|identity|deps|env|trust|data|home|links|forge`).

It never writes a credential — those stay with `foundry auth`, below — and three things
stay yours to do: `gh auth login`, `just setup-bb` for Bitbucket, and cloning
the repos you want jobs to target under `~/git`, which is the only directory the
Repos page scans.

`just setup-bb` installs the `bb` phar and walks you through an Atlassian API token.
It exists because `bb auth` stores whatever you type without checking it — including
nothing at all, which is how an empty config gets written over a working one. This
takes the token without echoing it and verifies it against a real Bitbucket repo
before writing anything, then reports which of the four scopes `bb` needs are
missing. `--verify` checks the setup and changes nothing; `--reauth` replaces the
stored credentials.

```sh
./bin/foundry setup            # one-time: credential, forge image, web deps, local infra, db
```

`foundry setup` chains everything below — `foundry auth`, `foundry auth --linear`
(prompted), `foundry build`, `bun install` for the workspace, `just up postgres mcp`, and
`just migrate` — skipping any step that's already done, so it's safe to rerun.
Pass `--linear`/`--no-linear` to preselect the Linear/MCP prompt non-interactively.
The steps below are the same thing run by hand, for when you want more control:

```sh
./bin/foundry doctor           # check OrbStack + prerequisites
./bin/foundry auth             # one-time credential (see below)
./bin/foundry auth --linear    # optional: let forges read/write Linear via the MCP gateway
./bin/foundry build            # build the forge image (~5 min first time)
```

Everything below writes a bare `foundry` for brevity. To get that, symlink it onto
your PATH — `ln -s "$PWD/apps/foundry/bin/foundry" ~/.local/bin/foundry` (no sudo, unlike
`/usr/local/bin`), which cutover does for you. Otherwise run `./apps/foundry/bin/foundry`
from citadel's root.

### Commands

`bin/foundry` is the CLI. Everything around it is a `just` recipe from citadel's root, so
nothing about setting a machine up depends on bun being there first:

| recipe | |
|---|---|
| `just bootstrap [phase]`, `just check` | host tooling, the one `.env`, dependencies |
| `just setup-bb` | the `bb` phar and an Atlassian API token, verified before it is written |
| `just migrate`, `just db-generate`, `just db-studio`, `just db-url` | the app schema |
| `just up postgres`, `just down`, `just ps`, `just logs postgres`, `just psql` | the local stack |
| `just foundry` | the web UI on this Mac, http://localhost:3777 |
| `just serve foundry up\|down\|status\|url` | share it on your tailnet |

### Auth

`foundry auth` opens an interactive picker — the Claude credential plus every MCP
upstream from argus's `infra/mcp/config.json`, each with its auth status; arrow keys +
enter (re)authenticate one. Non-interactive: `--claude`, `--api-key`, `--linear`,
`--slack`.

Claude Code on macOS keeps its credential in the **Keychain**, which Linux containers
can't read. So the `claude` row runs `claude setup-token` and stores the long-lived
token in the checkout's `.env` (chmod 600), injected into every forge as
`CLAUDE_CODE_OAUTH_TOKEN`. Use `foundry auth --api-key` for a plain API key instead.

#### One credential file

Every credential `foundry auth` stores — the Claude credential and `FOUNDRY_API_TOKEN` —
lives in citadel's one `.env` at the root (gitignored; `.env.example` lists every key):
`KEY=value` lines, mode 600, rewritten one key at a time, and read fresh by both readers
here, the CLI and the web server, so a new value needs no restart. In a container there is no
file, and the same keys arrive as environment variables. The upstream keys (`SLACK_TOKEN`,
`LINEAR_API_KEY`) and `MCP_GATEWAY_TOKEN` live in that same file, beside the MCP gateway argus
runs; a forge sees the gateway token as `FOUNDRY_MCP_TOKEN`. `foundry auth --api` prints the
`KEY=value` line Pensieve needs.

### MCP gateway (Linear, Slack)

Forges never hold third-party credentials. They reach Linear and Slack through the MCP
gateway argus runs ([mcp-proxy](https://github.com/tbxark/mcp-proxy), `apps/argus/infra/`),
which holds the Linear and Slack keys on the host and re-exposes their MCP servers at
`host.docker.internal:9090/{linear,slack}/mcp`, behind one gateway token. argus's own Claude
sessions and Pensieve's Ask are its other clients.

```sh
just auth slack ; just auth linear     # the upstream keys into citadel's .env
just auth gateway                      # mint MCP_GATEWAY_TOKEN (--rotate replaces it)
just up mcp                            # the gateway on :9090
foundry auth --linear                  # says whether the key and the token are there
foundry recreate <name>                # existing forges pick the gateway up on next start
```

Every forge — interactive, `foundry run`, or a web-UI job — then has the servers registered
(`box-init` does it on each start, from `FOUNDRY_MCP_SERVERS`, default `linear,slack`), so
`/work LIA-12` can fetch the ticket itself — and read the Slack thread the ticket links to.
The Slack token comes from a Slack app of your workspace with MCP access enabled (one manual
OAuth exchange mints the `xoxp-…` token; see [Slack's MCP server
docs](https://docs.slack.dev/ai/slack-mcp-server/)). Adding another upstream is an
`mcpServers` entry in argus's `infra/mcp/config.json`; see argus's `infra/compose.yaml`.

## Daily use

```sh
# a forge working on a repo that lives on your Mac — edits land on the host
foundry new api --mount ~/git/my-api --github

# a fully isolated forge that clones the repo itself
foundry new spike --repo https://github.com/you/thing.git --github

foundry claude api            # interactive Claude Code inside the forge
foundry shell api             # bash
foundry exec api -- npm test  # one-off command
foundry ls
```

Inside a forge, `foundry claude` passes `--dangerously-skip-permissions` by default —
that's the whole point of a sandbox. Pass `--safe` to get normal prompting back.

Forges ship a `/work` skill (`image/skills/work/SKILL.md`): give it a Linear ticket
and it reads the requirement, plans first, branches from main, verifies against the
existing code, and finishes with a PR. Five more, `forge-spec` → `forge-plan` →
`forge-test` → `forge-implement` → `forge-verify`, are the steps of the **Spec → QA**
blueprint below: each is one role, written for a headless run, adapted from the
[agent-skills](https://github.com/addyosmani/agent-skills) plugin. `forge-debug` takes
`forge-plan`'s slot in **Bug → Fix** — reproduce, localise, reduce, name the root
cause — and on its own is what a follow-up job runs on a failed check. `forge-api` is not a
step but a lens: the contract checks `forge-plan` and `forge-verify` read when a change
touches a route, a validation schema, the published API document or a generated client
type — who consumes it, additive or not, one error shape — and skip when it does not, so a
frontend-only ticket pays nothing for it. Skills are re-synced
into `~/.claude/skills` on every container start, so `foundry recreate` picks up new
versions — and a job forge is built fresh, so `foundry build` is what ships a change.

## Fan-out

Run one prompt across many forges in parallel, headless:

```sh
foundry new a --repo …; foundry new b --repo …
foundry run a b -- "upgrade to node 22 and make the tests pass"
foundry run --all -- "audit dependencies for CVEs"
```

Each run writes `~/.foundry/runs/<timestamp>/<forge>.log` plus the prompt and exit codes.

## Lifecycle

| | |
|---|---|
| `foundry stop/start <name>` | pause / resume |
| `foundry recreate <name>` | rebuild the container on a new image, keeping `/work` and `~/.claude` |
| `foundry rm <name>` | delete the container, keep volumes |
| `foundry rm <name> --purge` | delete volumes too |
| `foundry rm --all` | every forge |
| `foundry version` | print the CLI version |

## What persists

Per forge, on named volumes:

- `foundry-<name>-work` — `/work`, unless you bind-mounted a host dir
- `foundry-<name>-claude` — `~/.claude`: session history, settings, resumable conversations
- `foundry-<name>-cfg` — `~/.config`

So `foundry rm` then `foundry new` with the same name resumes where you left off.

## Security notes

- `--github` injects a real GitHub token into a forge running an agent with permissions
  disabled. It can push anywhere you can. Opt-in per forge, deliberately.
- Forges get full outbound network access. If you want egress rules, add a docker
  network with restricted DNS and pass `--network` through `foundry new`.
- Your SSH keys are never mounted.
- Forges talk to Linear only through the MCP gateway, presenting `FOUNDRY_MCP_TOKEN`;
  the Linear API key itself never enters a container. To cut every forge off,
  run `just auth gateway --rotate`, then `just up mcp`. The gateway port
  (9090) listens on the Mac like the web UI does, which is what the token is for.

## Local infra

Postgres for the web UI's job ledger, in a container, from the repo root:

```sh
just up postgres       # postgres on localhost:5432, waits until it's healthy
just psql     # a psql shell in it
just down     # stop (data survives; --purge to wipe)

just migrate     # apply the app schema (web/src/db/migrations)
```

Connection string: `postgresql://foundry:foundry@localhost:5432/foundry` — also
printed by `just db-url`. The app's tables live in the `foundry` schema, not
`public`. See `infra/README.md` and `web/README.md` for the rest.

## Web UI

`web/` holds a TanStack Start + shadcn frontend — a job ledger and an "ignite a job"
flow, running on bun. **Igniting a job actually runs it**: the web server clones the
repo to `~/.foundry/jobs/<id>/`, runs Claude Code in an ephemeral forge container
against that clone, then commits, pushes and opens a PR (`gh` for GitHub origins,
`bb` for Bitbucket) with your host credentials. Logs stream into the job detail
sheet as the agent works.

```sh
foundry setup           # once — credential, web deps, infra, schema (see Setup above)
just foundry         # http://localhost:3777
```

Two things worth knowing:

- The dev server listens on `0.0.0.0` (not just loopback) so job containers can call
  back via `host.docker.internal`. That makes it reachable from your LAN; the
  callback endpoint is authenticated with a per-job token.
- The forge container gets **no** GitHub/Bitbucket credentials and no database access
  — it can only edit its own workspace and report progress. Push and PR happen on
  the host afterwards. This is a narrower grant than `foundry new --github`.

Job workspaces accumulate under `~/.foundry/jobs/`; `foundry jobs prune [--days 7]`
clears old ones. See `web/README.md` for the full pipeline.

A job's log is a JSONL file — `~/.foundry/logs/<id>.jsonl`, one `{t, stream, text}`
record per line, the way Claude Code keeps a session under `~/.claude/projects/`. So
the sheet's output is also `tail -f`-able, `grep`-able and `jq`-able from a terminal:

```sh
jq -r 'select(.stream == "err") | .text' ~/.foundry/logs/<id>.jsonl
```

The logs live outside `~/.foundry/jobs/` on purpose — `foundry jobs prune` clears
workspace clones, which are large and reproducible, and leaves the history that
describes them. Purging a job from the ledger deletes its file with the row.

### Trigger a job over HTTP

Anything that can make a request — CI, a Slack bot, another agent, a shell script — can
queue a job with the instructions in the body. `foundry auth --api` mints the bearer token
(it lands in `.env`, read per request, so rotation needs no restart here — Pensieve
gets the printed line pasted into its own `.env`):

```sh
curl -s -X POST http://localhost:3777/api/jobs \
  -H "Authorization: Bearer $FOUNDRY_API_TOKEN" -H 'content-type: application/json' \
  -d '{"repo": "my-api", "instructions": "Add a CI status badge to the README"}'
```

`202` comes back with the job the moment its row exists; `GET /api/jobs/<id>` follows it
to a PR URL, or pass a `callbackUrl` and the host POSTs you a signed `job.settled` event
instead. A Linear `ticketId` with no `instructions` is enough too: the host composes the
brief from the issue and, once the row exists, assigns the ticket to you and moves it to
In Progress. The full contract is the OpenAPI document at `/api/openapi.json`, rendered at
`/api/reference`; `web/README.md` has the prose around it.

### Repo notes

Each repo on the **Repos** page carries free-text **notes** — standing instructions
every job against it inherits: the package manager, what to verify with, which base
branch to prefer, which shared components to reuse. They ride in as system prompt
(`FOUNDRY_REPO_NOTES` -> `--append-system-prompt`), so they hold for every step of a
blueprint, planning included, and are read fresh when the forge lights rather than
when the job was queued.

The Repos page shows the first lines of each repo's notes inline, and the ignite
dialog says which notes are about to apply. The **base branch** field starts from the
base of that repo's most recent job — read straight from the ledger, so it is the
same answer on every device — falling back to origin's default for a repo with no
jobs yet.

They live in foundry's database, never in the checkout: this is where preferences go
that don't belong in a repo's committed `CLAUDE.md` — which the agent still reads
from the workspace as usual.

### Blueprints

A **blueprint** is a reusable sequence of agent steps, each on a model of its own —
*plan with Fable, execute with Sonnet*. Pick one in the "Ignite a job" dialog and the
job's forge runs `claude -p` once per step, all in one session (`--session-id` then
`--resume`), so the executor sees the planner's exploration. Define them on the
**Blueprints** page. A job snapshots the steps it ran, so editing or deleting a
blueprint never rewrites history.

`just migrate` seeds four, and all are yours to edit:

| blueprint | steps | for |
|---|---|---|
| **Plan → Execute** | plan · fable · high → execute · sonnet | anything. Read and plan first, implement second — what the ignite dialog starts on |
| **Backfill Tests** | survey · fable · high → write-tests · sonnet → verify · sonnet | tests over logic that already exists: characterise the behaviour, cover it, then check the tests would actually fail on a regression. Production code is off limits, so a bug it turns up is reported rather than fixed |
| **Spec → QA** | spec · fable · high → plan · fable · high → test · sonnet → implement · sonnet → verify · opus · medium | a ticket with acceptance criteria. Each step is a `/forge-*` skill: write the criteria down as checks, plan and self-review, write one red test per criterion, implement to green, then review on five axes and put a QA report in the PR body. e2e tests are written for the repo's own runner and left to CI. A ticket with no checkable criteria stops at the first step with no changes, on purpose |
| **Bug → Fix** | spec · fable · high → debug · fable · high → test · sonnet → implement · sonnet → verify · opus · medium | a ticket with reproduction steps or a failing check. The reproduction is the criterion; `forge-debug` reproduces it, localises and reduces it, and writes the plan with the root cause first; then the same test, implement and verify steps as Spec → QA, so the first test is the reproduction seen red, and the PR body opens with the root cause. A ticket with neither steps nor a failing check stops at the first step, naming what is missing |

The ignite dialog preselects **Plan → Execute** — planning first is the right default
for a run nobody is watching. It matches on the seeded row's id, not its name, so
renaming or rewriting that blueprint keeps it the default; deleting it drops the
dialog back to *none — one step, default model*.

#### Versions

Prompts get better by being rewritten, so every save bumps a version and keeps the
old one. The editor's **History** section lists them — what changed, when, and whether
the text was shipped with foundry or written by you — and restores any of them with a
click. Restoring writes a *new* version rather than reopening the old one, because a
job that ran v3 has to keep meaning what it meant.

The version rides along on each job, so the ledger reads `Plan → Execute v4` and you
can ask whether v4 actually beat v3 instead of guessing. Jobs from before versioning
show a bare name.

Versions are also how foundry ships improvements to the blueprints it seeds: a
migration may rewrite one *only* while you have never saved over it. Your first edit
takes ownership of that blueprint permanently, and later releases leave it alone.

### From a Linear ticket

A ticket becomes a job through the same `POST /api/jobs` above — send a `ticketId`
and no `instructions` and foundry fetches the issue with the host's `LINEAR_API_KEY`,
composes the brief from its body (key, title, URL, every section), claims the ticket
in Linear by assigning it to you and moving it to In Progress, then ignites the
pipeline the UI uses.

**The deciding happens elsewhere.** Foundry never scans Linear and never judges
whether a ticket is ready — it has no opinion about labels, status or assignee. A
human decides in the Pensieve cockpit, which is what sends the ticket id here; this
side only executes. (Foundry used to poll for an `agent-ready` label and ignite by
itself; that made two deciders out of one, and the polling is gone. The label no
longer does anything here.)

Claiming is race-safe the same way it always was: the job row is inserted under a
unique index on the ticket id *before* any Linear write, so the same ticket sent twice
queues one job and the second request gets a `409`. A ticket that has already run
stays claimed after the job settles — re-running it is the UI's rerun button, or purge
the job first.

The full request and response contract is the OpenAPI document at
`/api/openapi.json`, rendered at [`/api/reference`](http://localhost:3777/api/reference);
`web/README.md` has the prose around it.

### Reaching it from your other devices

```sh
just serve foundry up          # https://<this-node>.ts.net -> localhost:3777
just serve foundry status
just serve foundry down
```

Tailnet only, over `tailscale serve` — the dev server never becomes public. Exposing
it to the internet is `tailscale funnel`, deliberately by hand.

### Addressing PR comments

Review feedback flows back into a forge. A settled job with a PR carries an
**Address PR comments** action in its detail sheet: it queues a follow-up job on the
*same branch*, the host fetches the PR's unresolved review threads and general
comments with your own `gh`/`bb` credentials, and a fresh forge gets them as its
task. Its push updates the existing PR — no new PR, no credentials in the container,
and the comments are read fresh when the forge lights, like repo notes.
