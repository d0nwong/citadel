# argus

The record behind **alden-portal**, and the loop that keeps it current. It watches
#dev-team Slack and the two repos' base branches, and keeps one `ledger.json` per feature:
the requirements the business asked for and whether anyone confirmed them, the asks and
what happened to each, the user's tickets with what they wait on, the landings, and the
tickets waiting to be filed. Built for one tech lead on a part-time schedule: every run is
safe to repeat, and the first run after days away catches up.

## The three systems

| | job | never |
|---|---|---|
| **argus** (this repo) | Knows. One ledger per feature, kept by the sweep; the arch doc beside it; the `argus` and `accio` CLIs. | Post to Slack. Close a ticket. Send work anywhere. |
| **Pensieve** (`apps/pensieve`) | Shows and decides. Renders the ledgers; every click runs one `argus` verb; Ask answers over the same record and proposes changes for a click. | Write the checkout with its own code. |
| **Foundry** (`apps/foundry`) | Executes. Takes a ticket key and a repo over HTTP, runs it in a forge, pushes a PR. | Read the ledger. Judge readiness. |

One line: **argus knows, you decide in Pensieve, Foundry does.**

## The ledger

`<app>/features/<dir>/ledger.json` is the record of one feature. `SPEC.md` is the source
of truth for its shape; in short:

- **story** — four answers with evidence: is it going well, do the two codebases agree,
  does the code do what was asked, is the architecture sound. The fifth, what is on you,
  is derived from the asks.
- **requirements** — one row per business rule, `assumed`, `confirmed`, `contradicted`
  or `retired`, with who settled it and when. This is the product doc.
- **asks** — who asked for what, when, and its history from `asked` to `closed`. An ask
  may carry blockers (a landing, an answer, another ticket); code clears the landings.
- **tickets** — the user's own, with typed blockers; `ready` is derived.
- **landings** and **proposals** — what merged to a base branch, and the tickets the
  reader wants filed.

Every claim carries evidence: a Slack permalink, a PR, a commit, a file and line, or the
word "assumption". `argus validate` refuses anything else, and ids are never reused.

`docs/arch.md` beside the ledger is how the feature is built, under 250 curated lines;
`accio sync` writes its generated regions from the code and the OpenAPI spec. `docs/spec.md`
beside it, where one exists, is the feature's spec: numbered criteria `S-n` that are never
reused, written only when a revision folds.

## The revision

A **revision** is one confirmed piece of work — its intent, the revised spec of every feature
it touches, and the plan that cuts it into tickets — kept under `revisions/<slug>` while a
draft and `revisions/<KEY>` once filed on its Linear parent, and under `revisions/archive/`
once done or dropped. `revision.json` is the record and only the `argus revision` verbs and
`reconcile` write it; the markdown beside it (`intent.md`, `specs/<app>/<dir>.md`, `plan.md`)
is the `scope` skill's. Nothing under `revisions/` is ever deleted: the archive is the only
exit. Every app with a `features/` tree — `alden/alden-portal`, `foundry`, `pensieve`, `argus` —
can be named by a revision as `<app>/<dir>`.

## The run

`/sweep` (`skills/sweep/SKILL.md`), on a loop or on demand:

1. `argus pull` — Slack since the cursor, landings on `origin/staging` and `origin/dev`.
2. `argus place <batch>` — the deterministic joins: files to features, replies to threads,
   ticket keys and PRs to the ledger that lists them. The rest is unplaced. Each backend
   landing gets its finished `dev` pipeline, checked again every run until it has one. A
   feature whose earlier landing just finished deploying gets a slice, so its reader
   corrects the prose.
3. Attribute — the model places what it would bet on (`skills/sweep/attribute.md`).
4. Read — one Opus subagent per feature with a slice returns a patch
   (`skills/sweep/reader.md`, `shapes.md`); code applies and validates the whole. Then one
   subagent per proposal whose Technical Notes name no file reads the code and writes
   them (`skills/sweep/ground.md`, `argus prompt ground`).
5. `argus reconcile` — a landing blocker clears when Bitbucket says the merge deployed. An
   open ticket settles when its provider says Done (its asks close) or Canceled (they drop),
   or, with no asks, once the landing carrying its key is live — Linear for `CTD` and `ALD`,
   the Alden Trello board for `AP`. A filed revision whose parent is Done folds into its
   features' `docs/spec.md` (retiring a `product.md`) and moves to `revisions/archive/`;
   Canceled archives it untouched. Both providers are read, never written.
6. `accio stale` and the `feature-docs` skill for arch docs that drifted.
7. `argus validate`, commit, promote the cursor.

What the run cannot place waits in `state/unplaced.json` for a click in Pensieve. What
it proposes waits under the feature's proposals for File. It never writes Linear or Slack.

## Layout

```
SPEC.md  tasks/  docs/intent  docs/ideas       the rebuild's spec, plan and why
scripts/argus.ts  scripts/argus/               the argus CLI and its verbs
scripts/accio.ts  scripts/accio/               the code-and-docs index
skills/sweep  ask  feature-docs  linear-ticket  scope  the skills; sweep/reader.md, attribute.md, shapes.md, style.md; scope/interview.md, spec.md, plan.md, SHAPES.md
alden/alden-portal/.doc-workspace/feature-manifest.json
alden/alden-portal/features/<dir>/ledger.json  docs/arch.md
pensieve/features  foundry/features             arch docs for the other two apps
state/                                          cursor (local), threads.json, unplaced.json, deploys.json, batches/ (local)
evals/                                          the 14-day fixture, expectations, replay scorer, scores.md
```

## Setting it up

This directory is `apps/argus` in citadel; the commands come from citadel's root:

```sh
just bootstrap                # host tools, the one .env, dependencies
just auth slack               # SLACK_TOKEN into that .env, mode 600
bun run argus <verb>          # and `bun run accio <verb>`; `just link` puts them on PATH at cutover
```

Both product checkouts must exist (`~/git/alden-portal-fe`, `~/git/alden-connect-portal-be`,
or `FE_REPO` / `BE_REPO`); the run reads them at `origin/*` and never switches a branch. The
sweep container clones its own copies instead.
The deploy check reads the credentials `bb` keeps in `~/.bitbucket-rest-cli-config.json`
(`BITBUCKET_CONFIG` to point elsewhere); the ticket-state check reads `LINEAR_API_KEY` and
`TRELLO_API_KEY`/`TRELLO_TOKEN` from `.env`, and without either a provider's credential its
tickets settle only from landings. Linear and Slack are the MCP servers in `.mcp.json`, both
behind the local MCP gateway (mcp-proxy on :9090, `infra/compose.yaml`, started by
`just up mcp`); a session presents `MCP_GATEWAY_TOKEN` from `.env`, and the gateway holds the
keys. Trello is not behind the gateway — `packages/tickets` reads `TRELLO_API_KEY` and
`TRELLO_TOKEN` straight from `.env`, as `foundry auth --trello` writes them.

## Running it

```sh
just sweep-once [--dry-run]   # one tick in the stack; --dry-run only pulls
just sweep-on                 # the loop: one tick per SWEEP_INTERVAL (900s)
argus pull                    # the batch, or "nothing new"
argus place <batch>           # the joins
argus reconcile               # clear what deployed, settle what each ticket's provider closed
argus deployed be#797         # is a backend merge live on dev? (--json for skills)
argus validate                # every ledger and arch doc
argus show admin/usage        # one ledger
argus close admin/usage A-7 --reason "..."         # the click verbs, as Pensieve runs them
argus confirm admin/usage R-3 --reason "..." [--contradict]
argus place <message-ts> admin/usage
argus file admin/usage P-2 · argus ticket admin/usage P-2 ALD-52 · argus sent admin/usage ALD-52 --repo <name> --job <id>
argus seed --all              # requirement rows from the old rule tables (once)
argus revision new <slug> --title "…" --feature foundry/jobs   # a draft; then show <slug|KEY> · file <slug> <KEY> --tickets K1,K2 · drop <slug|KEY> --reason "…"
accio find "status select"    # what backs a thing
accio stale · accio sync --offline · accio audit
bun test · bun run typecheck · bun run evals [--model]
```

Everything commits locally and never pushes. Anything needing your judgement reaches you
in Pensieve, not in a file you have to be told to open.

## The gate

The replay under `evals/` is how a change to a prompt or a join is measured: 14 real days
of the channel and both repos, the expectations placed by hand, and the closure cases
that must close on the right message. `bun run evals --model` runs the real prompts;
`evals/scores.md` keeps every score. The rebuild passed at 85% attribution and 4 of 4
closures on 2026-09-11.
