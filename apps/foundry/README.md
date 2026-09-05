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
        mcp["MCP gateway<br/>(infra/, mcp-proxy · :9090)"]
        auth["~/.foundry/env<br/>CLAUDE_CODE_OAUTH_TOKEN"]
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
    mcp -- "LINEAR_API_KEY (host only)" --> linear
    mcp -- "SLACK_MCP_TOKEN (host only)" --> slack

    caller -- "POST /api/jobs<br/>FOUNDRY_API_TOKEN" --> web
    web -. "job.settled webhook<br/>HMAC-signed" .-> caller
    web -- "job ledger" --> pg
    web -- "clone repo" --> jobs
    web -- "append log lines" --> joblogs
    web -- "ignite job" --> jobforge
    jobforge -- "edits" --> jobs
    jobforge -. "progress callback<br/>host.docker.internal + per-job token" .-> web
    web -- "commit · push · PR<br/>(gh / bb, host creds)" --> remote
    web -. "scan agent-ready · claim<br/>LINEAR_API_KEY (host only)" .-> linear
```

## Why containers, not `orb` machines

OrbStack Linux machines share your host `$HOME` — that's convenient but defeats the
point of a sandbox, and they boot far slower. Containers are reproducible from
`image/Dockerfile`, disposable, and still visible in the OrbStack UI.

## Setup

```sh
./bin/foundry setup            # one-time: credential, forge image, web deps, local infra, db
```

`foundry setup` chains everything below — `foundry auth`, `foundry auth --linear`
(prompted), `foundry build`, `bun install` in `web/`, `bun run infra:up`, and
`bun run db:migrate` — skipping any step that's already done, so it's safe to rerun.
Pass `--linear`/`--no-linear` to preselect the Linear/MCP prompt non-interactively.
The steps below are the same thing run by hand, for when you want more control:

```sh
./bin/foundry doctor           # check OrbStack + prerequisites
./bin/foundry auth             # one-time credential (see below)
./bin/foundry auth --linear    # optional: let forges read/write Linear via the MCP gateway
./bin/foundry build            # build the forge image (~5 min first time)
```

Everything below writes a bare `foundry` for brevity. To get that, symlink it onto
your PATH — `ln -s "$PWD/bin/foundry" ~/.local/bin/foundry` (no sudo, unlike
`/usr/local/bin`). Otherwise run `./bin/foundry` from the repo root.

### Auth

`foundry auth` opens an interactive picker — the Claude credential plus every MCP
upstream from `infra/mcp/config.json`, each with its auth status; arrow keys +
enter (re)authenticate one. Non-interactive: `--claude`, `--api-key`, `--linear`,
`--slack`.

Claude Code on macOS keeps its credential in the **Keychain**, which Linux containers
can't read. So the `claude` row runs `claude setup-token` and stores the long-lived
token in `~/.foundry/env` (chmod 600), injected into every forge as
`CLAUDE_CODE_OAUTH_TOKEN`. Use `foundry auth --api-key` for a plain API key instead.

### MCP gateway (Linear, Slack)

Forges never hold third-party credentials. Instead the infra stack runs an MCP
gateway ([mcp-proxy](https://github.com/tbxark/mcp-proxy), `infra/mcp/config.json`)
that holds your Linear and Slack keys on the host and re-exposes their MCP
servers at `host.docker.internal:9090/{linear,slack}/mcp`, behind a per-install
gateway token.

```sh
foundry auth --linear          # stores LINEAR_API_KEY + a generated FOUNDRY_MCP_TOKEN in ~/.foundry/env
foundry auth --slack           # optional: a Slack user token (xoxp-…), so tickets' Slack links resolve
bun run infra:up               # now also starts foundry-mcp (mcp.foundry.local)
foundry recreate <name>        # existing forges pick the gateway up on next start
```

Every forge — interactive, `foundry run`, or a web-UI job — then has the
configured servers registered (`box-init` does it on each start, from
`FOUNDRY_MCP_SERVERS`), so `/work LIA-12` can fetch the ticket itself — and read
the Slack thread the ticket links to. The Slack token comes from a Slack app of
your workspace with MCP access enabled (one manual OAuth exchange mints the
`xoxp-…` token; see [Slack's MCP server docs](https://docs.slack.dev/ai/slack-mcp-server/)).
Adding another upstream is one more `mcpServers` entry in
`infra/mcp/config.json` plus its secret in `~/.foundry/env`; see `infra/README.md`.

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
existing code, and finishes with a PR. Skills are re-synced into `~/.claude/skills`
on every container start, so `foundry recreate` picks up new versions.

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
  change the token in `~/.foundry/env` and `bun run infra:up`. The gateway port
  (9090) listens on the Mac like the web UI does, which is what the token is for.

## Local infra

Postgres for the web UI's job ledger, in a container, from the repo root:

```sh
bun run infra:up       # postgres on localhost:5432, waits until it's healthy
bun run infra:psql     # a psql shell in it
bun run infra:down     # stop (data survives; --purge to wipe)

bun run db:migrate     # apply the app schema (web/src/db/migrations)
```

Connection string: `postgresql://foundry:foundry@localhost:5432/foundry` — also
printed by `bun run infra:url`. The app's tables live in the `foundry` schema, not
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
bun run web:dev         # http://localhost:3777
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
(it lands in `~/.foundry/env`, read per request, so rotation needs no restart):

```sh
curl -s -X POST http://localhost:3777/api/jobs \
  -H "Authorization: Bearer $FOUNDRY_API_TOKEN" -H 'content-type: application/json' \
  -d '{"repo": "my-api", "instructions": "Add a CI status badge to the README"}'
```

`202` comes back with the job the moment its row exists; `GET /api/jobs/<id>` follows it
to a PR URL, or pass a `callbackUrl` and the host POSTs you a signed `job.settled` event
instead. The full payload and the webhook contract are in `web/README.md`.

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

`db:migrate` seeds two, and both are yours to edit:

| blueprint | steps | for |
|---|---|---|
| **Plan → Execute** | plan · fable · high → execute · sonnet | anything. Read and plan first, implement second — what the ignite dialog starts on |
| **Backfill Tests** | survey · fable · high → write-tests · sonnet → verify · sonnet | tests over logic that already exists: characterise the behaviour, cover it, then check the tests would actually fail on a regression. Production code is off limits, so a bug it turns up is reported rather than fixed |

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

### Ticket scanner

Label a Linear ticket **`agent-ready`** and foundry picks it up by itself: on a poll
interval the web server scans the Liamai team for open labeled tickets, queues a job
whose brief is the full ticket body (key, title, URL, every section), assigns the
ticket to you and moves it to In Progress, then ignites the job through the exact
pipeline the UI uses. The label is the entire contract — the scanner never infers
readiness from status, assignee or anything else. A human put it there on purpose.

Two sanity checks guard the label rather than replace it: a ticket with an unresolved
blocked-by relation, or with content under a `## Pending` heading, is skipped with a
log line — it keeps the label and is retried next scan, so fix the ticket, not the
scanner. Claiming is race-safe: the job row is inserted under a unique index on the
ticket id *before* any Linear write, so two ticks (or two servers) can both try and
exactly one wins; a crash in between is repaired on the next scan. A ticket the
scanner has run stays claimed even after the job settles — re-running it is the UI's
rerun button, or purge the job and leave the label on.

Which repo a ticket lands in comes from `~/.foundry/scanner.json`, keyed by the
ticket's Linear *project* name and read fresh each scan:

```json
{
  "Foundry":  { "repoPath": "/Users/you/git/foundry" },
  "my-app":   { "repoPath": "/Users/you/git/my-app-fe", "baseBranch": "staging" }
}
```

`baseBranch` defaults to the checkout's `origin/HEAD`, and an optional `blueprintId`
overrides the default Plan → Execute blueprint. Tickets in an unmapped project (or no
project) are skipped and logged.

Off by default. `FOUNDRY_SCANNER=1` in `web/.env` turns it on;
`FOUNDRY_SCANNER_INTERVAL` sets the poll in seconds (default 300). The scan uses the
host's `LINEAR_API_KEY` from `foundry auth --linear` — like every Linear credential
here, it never enters a forge. New claims stop while `FOUNDRY_MAX_JOBS` jobs are
open, so labeled tickets queue in Linear — where you can still edit or unlabel them —
not in the ledger.

### Reaching it from your other devices

```sh
bun run web:serve          # https://<this-node>.ts.net -> localhost:3777
bun run web:serve:status
bun run web:unserve
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
