# citadel

The loop that keeps **alden-portal**'s record current, in one repo: argus knows, you decide in
Pensieve, Foundry does.

| app | what it is | where it runs |
|---|---|---|
| [`apps/argus`](apps/argus) | The ledgers, the `argus` and `accio` CLIs, the skills, and the sweep that keeps them current. | the `sweep` service in the stack |
| [`apps/pensieve`](apps/pensieve) | The reading room: it renders the ledgers, every click runs one `argus` verb, and Ask answers over the same record. | the `pensieve` service, :3778 |
| [`apps/foundry`](apps/foundry) | The executor: it takes a ticket key and a repo, runs the work in a forge container, and opens the PR. | this Mac (`just foundry`, :3777), because it pushes with your own credentials |

argus's data — the ledgers, the arch docs and `state/` — is not in this repo. It lives in its own
repo, cloned where `ARGUS_DATA_DIR` points (`~/git/argus` by default). The sweep writes it;
Pensieve reads it, and writes it through the verbs.

## Getting started

```sh
just bootstrap        # host tools, the one .env, dependencies; `just check` changes nothing
just start            # everything: the stack, Foundry's web UI, the sweep loop
just stop             # everything back down; the data volumes stay
just                  # every recipe, with what it does
```

`just start` is the three pieces in order, and each runs on its own when you want only one:
`just up` for the containers (the MCP gateway, postgres, Pensieve), `just foundry` for the web
UI on this Mac, `just sweep-on` for the loop. The sweep sits behind a compose profile so that
`just up` alone can never start a second writer on the data repo.

One `.env` at the root holds every key, and `.env.example` lists them.
`just auth linear|slack|claude|foundry-api|gateway` fills one in without echoing it.

## What is where

```
apps/argus/          the ledger CLIs, the skills, the sweep image, the MCP gateway (infra/)
apps/foundry/        the forge CLI, its web UI (web/), postgres (infra/)
apps/pensieve/       the reading room
compose.yaml         the stack; each app's compose file is included from here
justfile             every command
scripts/             what the recipes call when they outgrow one line
docs/intent, docs/spec   what was agreed, and the shape it is being built to
tasks/               the plan and its todo
```

## Reading on

- [`docs/spec/consolidation.md`](docs/spec/consolidation.md) — this repo's shape, and how the move is being done.
- [`apps/argus/SPEC.md`](apps/argus/SPEC.md) — the ledger, the sweep and the verbs.
- each app's README.
