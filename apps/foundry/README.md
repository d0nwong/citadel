# foundry

Orchestration layer for disposable **Claude Code forges** running on OrbStack.

Each forge is a Linux container with `claude`, `git`, `gh`, `node`, `python3`, and the
usual CLI tooling. Forges are cheap (<1s to start), isolated from your Mac, and
addressable at `<name>.foundry.local`.

## Why containers, not `orb` machines

OrbStack Linux machines share your host `$HOME` — that's convenient but defeats the
point of a sandbox, and they boot far slower. Containers are reproducible from
`image/Dockerfile`, disposable, and still visible in the OrbStack UI.

## Setup

```sh
export PATH="$PWD/bin:$PATH"   # or: ln -s "$PWD/bin/foundry" /usr/local/bin/foundry
foundry doctor                 # check OrbStack + prerequisites
foundry auth                   # one-time credential (see below)
foundry build                  # build the forge image (~5 min first time)
```

### Auth

Claude Code on macOS keeps its credential in the **Keychain**, which Linux containers
can't read. So `foundry auth` runs `claude setup-token` and stores the long-lived
token in `~/.foundry/env` (chmod 600), injected into every forge as
`CLAUDE_CODE_OAUTH_TOKEN`. Use `foundry auth --api-key` for a plain API key instead.

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

## Web UI

`web/` holds a TanStack Start + shadcn frontend for this CLI — a job ledger and a
"forge a job" flow. It runs on bun and is currently **UI only**, backed by an
in-memory mock:

```sh
cd web && bun install && bun run dev   # http://localhost:3777
```

See `web/README.md` for the seam where the real orchestrator gets wired in.
