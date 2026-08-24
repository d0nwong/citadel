# foundry

Orchestration layer for disposable **Claude Code forges** running on OrbStack.

Each forge is a Linux container with `claude`, `git`, `gh`, `node`, `bun`, `python3`, and the
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
    end

    subgraph orb["OrbStack containers"]
        forge["forge<br/>&lt;name&gt;.foundry.local<br/>claude · git · gh · node · bun · python3"]
        vols[("named volumes<br/>/work · ~/.claude · ~/.config")]
        jobforge["ephemeral job forge<br/>(no git creds, no DB)"]
    end

    remote["GitHub / Bitbucket"]
    linear["Linear MCP<br/>mcp.linear.app"]

    cli -- "new · claude · shell · exec · run" --> forge
    auth -- "injected" --> forge
    auth -- "injected" --> jobforge
    forge --- vols
    forge -- "--github (opt-in token)" --> remote
    forge -. "gateway token" .-> mcp
    jobforge -. "gateway token" .-> mcp
    mcp -- "LINEAR_API_KEY (host only)" --> linear

    web -- "job ledger" --> pg
    web -- "clone repo" --> jobs
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

```sh
export PATH="$PWD/bin:$PATH"   # or: ln -s "$PWD/bin/foundry" /usr/local/bin/foundry
foundry doctor                 # check OrbStack + prerequisites
foundry auth                   # one-time credential (see below)
foundry auth --linear          # optional: let forges read/write Linear via the MCP gateway
foundry build                  # build the forge image (~5 min first time)
```

### Auth

Claude Code on macOS keeps its credential in the **Keychain**, which Linux containers
can't read. So `foundry auth` runs `claude setup-token` and stores the long-lived
token in `~/.foundry/env` (chmod 600), injected into every forge as
`CLAUDE_CODE_OAUTH_TOKEN`. Use `foundry auth --api-key` for a plain API key instead.

### MCP gateway (Linear)

Forges never hold third-party credentials. Instead the infra stack runs an MCP
gateway ([mcp-proxy](https://github.com/tbxark/mcp-proxy), `infra/mcp/config.json`)
that holds your Linear API key on the host and re-exposes Linear's MCP server at
`host.docker.internal:9090/linear/mcp`, behind a per-install gateway token.

```sh
foundry auth --linear          # stores LINEAR_API_KEY + a generated FOUNDRY_MCP_TOKEN in ~/.foundry/env
bun run infra:up               # now also starts foundry-mcp (mcp.foundry.local)
foundry recreate <name>        # existing forges pick the gateway up on next start
```

Every forge — interactive, `foundry run`, or a web-UI job — then has a `linear`
MCP server registered (`box-init` does it on each start), so `/work LIA-12` can
fetch the ticket itself. Adding another upstream is one more `mcpServers` entry in
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

`web/` holds a TanStack Start + shadcn frontend — a job ledger and a "forge a job"
flow, running on bun. **Igniting a job actually runs it**: the web server clones the
repo to `~/.foundry/jobs/<id>/`, runs Claude Code in an ephemeral forge container
against that clone, then commits, pushes and opens a PR (`gh` for GitHub origins,
`bb` for Bitbucket) with your host credentials. Logs stream into the job detail
sheet as the agent works.

```sh
(cd web && bun install)
foundry auth           # once — the forge container needs a Claude credential
bun run db:migrate     # once, after infra:up
bun run web:dev        # http://localhost:3777
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

### Reaching it from your other devices

```sh
bun run web:serve          # https://<this-node>.ts.net -> localhost:3777
bun run web:serve:status
bun run web:unserve
```

Tailnet only, over `tailscale serve` — the dev server never becomes public. Exposing
it to the internet is `tailscale funnel`, deliberately by hand.
