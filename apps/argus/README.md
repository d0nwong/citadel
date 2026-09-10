# argus

A one-person orchestration workspace for **alden-portal**: it watches the places where
change happens — #dev-team Slack, Linear (team `Liamai`), and the FE/BE repos — and keeps
three durable records honest: one JSON file per piece of work (where it stands), a
per-feature change journal (the "why" layer), and dual-tier feature docs (the "what"
layer, verified against both repos). Built for a part-time schedule: everything is
incremental, idempotent, and catch-up-safe, so the first run after days away simply
backfills.

## The three systems, as of 2026-09-07

Three repos share this work. Each has one job, and the seams between them are files and
one HTTP API — nothing else.

| | job | today | never |
|---|---|---|---|
| **argus** (this repo) | Knows. The blackboard is the single source of truth for everything not in Linear or a repo; the sweep keeps it current, reconciles landings against tickets, and surfaces what needs a decision. | Files (`workstreams/`, `marauder/`, `features/*/journal`, `features/*/docs`) plus skills run by `/loop` sessions. Renders a board; holds no queue. | Dispatch work. Close tickets. Run as a daemon. |
| **Pensieve** (`~/git/pensieve`) | The decision surface. Where you read where the work stands and decide what to act on. | Renders the board, each workstream, the journal and the docs for every app under the blackboard; the Unsorted list places what attached to nothing; Ask answers over the checkout and proposes a correction that a click confirms. Writes `decisions/` and nothing else. | Hold workflow state of its own. Write any blackboard file other than `decisions/`. |
| **Foundry** (`~/git/foundry`) | Executes. Takes a job over HTTP, runs it in an ephemeral forge, pushes a PR, reports back. | Jobs, blueprints, repos, forges, the trigger API. The `agent-ready` ticket scanner that made it a decider too is gone (LIA-93). | Read the blackboard. Judge readiness. Choose what runs. |

One line: **argus knows, you decide in Pensieve, Foundry does.**

The decision happens on the screen where the work is read: the sweep keeps one record per
workstream and renders the board from it, and Pensieve is where a queue entry is placed, a
ticket is sent to Foundry, or a held edit is confirmed. The `agent-ready` label that used
to be the handoff is retired — inert on the tickets that carry it, applied by nothing, read
by nothing — and Foundry's scanner is gone. From Ask, the model can propose a correction
that a click confirms; the tool it calls never writes. That work landed as waves 1 to 9 of
`PLAN.md`, which also holds what is still open; the diagram is `canvas/setup.json`
(`bun run canvas`, then `?g=setup`). "Downstream" at the bottom is the current contract.

## The loop at a glance

Each sweep tick walks five stages, each feeding the next; the board it renders is dashed
into Pensieve, because what happens after it is your call:

```mermaid
flowchart LR
    ingest["1 · Ingest<br/>the channel + the base<br/>branches become events"]
    journal["2 · Journal<br/>one entry per landing<br/>(the why)"]
    docs["3 · Docs<br/>dual-tier product + arch<br/>(the what)"]
    tickets["4 · Linear<br/>file what a workstream asks,<br/>fold events into open tickets"]
    board["5 · Render<br/>marauder/board.md —<br/>where the work stands"]
    decide(["you, in Pensieve"])
    foundry["Foundry executes<br/>(POST /api/jobs)"]

    ingest --> journal --> docs --> tickets --> board
    board -.-> decide
    decide -. "Send" .-> foundry
    decide -. "attach · new · dismiss · stage" .-> ingest
```

## Architecture

The design is a blackboard, not a pipeline of agents:

- **Durable state lives in files.** `workstreams/`, `features/*/journal/`,
  `features/*/docs/`. A workstream's stage per side, and the statuses in journal
  frontmatter (`decided → implemented → documented`, with `superseded` and `hold:` as the
  explicit escape hatches), are the workflow state — no agent's memory is load-bearing.
- **Reconciliation is deterministic.** `marauder ingest` turns merges and messages into
  events by thread, reference and vocabulary, and refuses to guess past that; `pr-facts
  --since` says which landings lack a journal entry; `accio audit` cross-checks docs
  against code and journal entries against each other (including decisions whose change
  landed without anyone linking back). Code does the joins an LLM would only guess at.
- **What code cannot place, a person does — once.** Anything the ladder cannot attach goes
  to `workstreams/_unsorted.json`, and the correction that places it writes its rule onto
  the workstream, so the next message like it lands on its own.
- **Agents are stateless workers.** `log-change` and `feature-docs` each make one kind of
  file current, in a subagent, and can be re-run at any time; `ticket-pass` does the same
  for Linear (files what a workstream asks for, folds each tick's events into the tickets
  it names). A stage gets a subagent when its reading is bulky *and* its output lands on
  the blackboard — ingest, the queue read and the render stay in the sweep itself.
- **`/sweep` is the scheduler, and it is deliberately dumb.** Each tick it ingests the
  channel and the base branches, reads what attached to nothing, dispatches workers per
  landing, makes Linear current, and renders the board — the files decide what runs.
  `/loop 15m /sweep` is the intended mode.

```mermaid
flowchart TB
    subgraph world["Outside world"]
        slack["#dev-team Slack"]
        linear["Linear — team Liamai"]
        staging["FE staging / BE origin/dev"]
    end

    subgraph workers["Stateless workers (subagents)"]
        lc["log-change"]
        fd["feature-docs"]
        tp["ticket-pass"]
    end

    subgraph blackboard["Durable state — the blackboard"]
        ws["workstreams/*.json<br/>(stage = workflow state)"]
        journal["features/*/journal/*.md<br/>(status = workflow state)"]
        docs["features/*/docs/<br/>product.md + arch.md"]
    end

    prfacts[["pr-facts --since<br/>deterministic: which landings<br/>are NOT JOURNALED"]]
    audit[["accio audit<br/>deterministic reconciler"]]
    ingest{"marauder ingest<br/>merges + messages → events,<br/>or the unsorted queue"}
    board(["marauder render<br/>board.md — where the work stands"])

    slack --> ingest
    staging --> ingest
    staging --> prfacts
    ingest --> ws
    ingest -. "cannot place it" .-> queue["workstreams/_unsorted.json"]
    queue -. "a person places it" .-> ws
    prfacts -- "one dispatch per landing" --> lc --> journal
    ws -- "the ticket and the story" --> lc
    journal -- "implemented, no hold" --> fd --> docs
    ws -- "this tick's events" --> tp
    docs -- "refreshed features" --> tp
    tp -- "files tickets,<br/>folds in evidence" --> linear
    tp -. "keys, pairings, held edits" .-> ws
    linear -- "ticket bodies" --> tp
    journal --> audit
    docs --> audit
    ws --> board
```

The one rule that keeps this safe to run unattended: **the sweep writes facts and
questions, never guesses.** An unattributed landing is journaled with `ticket: null` and
sits in the unsorted queue until someone places it; a ticket whose work appears already
merged is annotated with the PR link but closing it stays a human decision — a landing may
implement half a ticket, and a wrongly closed ticket vanishes from the only queue that gets
read.

### Lifecycle of one change

A journal entry is one **landing on staging** (or one decision awaiting code) — never one
day, never one commit:

```mermaid
stateDiagram-v2
    [*] --> decided : decision reached, no code yet (pr null)
    [*] --> implemented : landing journaled (pr + merge sha)
    decided --> superseded : the landing got its own entry,<br/>which links back
    implemented --> documented : feature-docs re-verified against both repos
    superseded --> [*]
    documented --> [*]
    note right of implemented
        hold: "reason" parks an entry open
        (e.g. FE shipped, BE half didn't)
        and silences the refresh nag
    end note
    note left of decided
        open >14 days with no hold →
        audit nags: it may have shipped
        without you noticing
    end note
```

`accio audit` enforces the edges: an `implemented` entry the doc refresh ran past, a
`decided` entry whose ticket landed in another entry, a `hold:` with no reason — each is
a named problem, and the tick's terminal output carries them verbatim.

## What each source is for

Every source is in the loop because it is the **only** place one kind of truth lives, and
nothing is trusted for a question it cannot answer.

| External source | Owns | Why nothing else can answer it |
|---|---|---|
| **#dev-team Slack** | Intent — what was decided, who asked, why | The only source that exists *before* code or tickets do, and the most perishable: a decision scrolls away in a day. Git can never answer "why". |
| **FE / BE repos** (`origin/staging`, `origin/dev`) | What actually happened | Code is ground truth; everything else is claims about it — a thread can say "the endpoint now fully replaces" while `origin/dev` proves it doesn't. Always read via `origin/<ref>`: local trees go stale silently, and a stale read invents facts instead of erroring. |
| **Linear** (team `Liamai`) | Your commitments | One-person truth: what you are on the hook for. Teammates don't reference these keys, so it can't say what *they* did — and it records intent-to-do, so the system annotates but never closes; only you can judge whether a landing discharged the intent. |

The derived files each cache one join so it is never recomputed:

| Derived file | The join it caches |
|---|---|
| `workstreams/` | Everything one piece of work has ever been told, in one place: the messages, the merges, the tickets and the questions, joined by the keys the work is actually named by. It is the only record that answers "is that done yet?" — Slack holds a fragment per day, Linear holds the ask, git holds the code, and none of them holds the thing itself |
| `marauder/` | Those records read out for a person, and nothing else — a page here can be deleted and re-rendered byte for byte, so it is never a source anything reads back |
| `features/*/journal/` | The spine: *this* decision + *this* ticket + *this* landing. That connection exists in no single external source — Slack doesn't know the PR, git doesn't know the why, Linear doesn't know the merge sha — which is why frontmatter is never guessed: a wrong key corrupts the only record of the join. |
| `features/*/docs/` | The repos distilled to present-tense facts, sha-stamped (`last_verified` / `last_verified_be`) so staleness is detectable rather than suspected |
| `.doc-workspace/` (manifest + OpenAPI) | Routing — which files and endpoints belong to which feature; what lets a diff or an endpoint named in Slack be attributed at all |

The sweep just walks these in order: take in the perishable one, check claims against
ground truth, place what it cannot attach, and surface only the judgement calls.

`reports/`, `reports/points.json`, `digests/` and `arcs/` are the archive: the daily digest,
the sweep report and the per-initiative arc, which the workstream replaced on 2026-09-09.
They stay readable in Pensieve as history, and nothing writes to them again.

## Layout

| Path | What it is |
|---|---|
| `workstreams/<slug>.json` | one JSON file per workstream — the thing a person asks "is that done yet?" about, which is never a PR, a ticket or a feature folder. It carries what done means, who drives it and who wants it, a stage per side (`asked`, `decided`, `building`, `landed`, `verified`, `shipped`, with "waiting on" and "parked" as overlays), the `keys` an event attaches by (tickets, PRs, thread roots, code vocabulary, people), the open questions and verified facts, and an append-only list of events. Written by `marauder ingest` and by the correction verbs, never by hand after the first seed; read by `marauder render` and by `ask`. `workstreams/_milestones.json` holds the dates workstreams point at, `workstreams/_unsorted.json` what attached to nothing, and `workstreams/.state.json` is the gitignored Slack cursor (LIA-154, LIA-161) |
| `marauder/` | the pages a person reads, rendered from `workstreams/*.json` and nothing else: `board.md` (where every open workstream stands — what needs you, what is in flight by area, what waits on someone else, what shipped this week), `<slug>.md` (one workstream's story) and `changelog/<day>.md` (what changed that day). Written by `bun run marauder render` and committed like every other rendered file; never hand-edited, and every page is held to `skills/sweep/style.md`'s three mechanical rules before it is written (LIA-155) |
| `decisions/marauder/<id>.json` | one file per verdict on what the loop could not settle, `{ id, action, slug?, name?, side?, stage?, reason, at, by }`, `action` one of `attach` \| `new` \| `dismiss` \| `stage` \| `verified`. Written by Pensieve, only ever read and committed by the sweep: `marauder ingest` applies each through the same correction functions the command line goes through, before anything new arrives, and leaves the file where it is as the history of who decided what (LIA-160). `id` names the queue entry it decides — or, for `verified`, the event it answers: the user's go-ahead for the one edit a `directed-at-person` event named, stamped onto that event (LIA-161). `decisions/send/<ticket>.json`, `{ ticket, action: "sent", job, at, by }`, is the other group — a ticket handed to Foundry, read when a ticket plan asks whether one is running |
| `alden/alden-portal/features/<dir>/docs/` | dual-tier docs — `product.md` + `arch.md` |
| `alden/alden-portal/features/<dir>/journal/YYYY-MM/YYYY-MM-DD/` | change journal, one file per landing, grouped by month and day |
| `alden/alden-portal/.doc-workspace/` | feature manifest + OpenAPI snapshot |
| `foundry/`, `pensieve/` | the same `features/<dir>/docs/` + `.doc-workspace/` layout for the two single-repo apps (`~/git/foundry`, `~/git/pensieve`). No backend repo, so their docs carry no `be:` sources and no `## FE/BE Mismatches`; their manifests are hand-curated, since `accio map` needs an FE route tree plus an OpenAPI spec and neither app has one. Pensieve discovers them by their `features/` tree and addresses a feature as `<app>/<dir>`; `accio` is hardcoded to `alden/alden-portal`, and `scripts/lib/journal.ts` `appRoots` is what walks every app's journal for `accio audit` and for `marauder ingest --landings` |
| `skills/` | the workers and the scheduler (`sweep`, `log-change`, `feature-docs`, `linear-ticket`, `api-lookup`, `office-hours`) — `skills/sweep/style.md` is the one house style every rendered page is written to (answer first, a person does something in every sentence, ids only on the evidence line), and the three rules in it that a renderer enforces — `prototyping` for fast issue-to-PR spikes, and `ask` — the read-only procedure for answering a question about the blackboard, which every session that opens this checkout (a terminal, Pensieve's Ask, the sweep) loads on a question-shaped prompt; from Pensieve it also proposes a correction or a drafted ticket, each written only by the user's click |
| `scripts/accio.ts` | the API surface and the docs, and nothing else since LIA-161: lookup, `--endpoints`, `list`, `map`, `sync`, `audit`, `stale`. The four blackboard verbs it used to carry (`journal`, `point`, `ticket`, `arc`) answer with the one `marauder` command that replaced each |
| `scripts/marauder.ts` | `marauder ingest \| huddle \| attach \| suggest \| new \| split \| stage \| check \| propose-split \| changed \| ticket-plan \| board \| show \| changelog \| render` — the verbs over `workstreams/`. `ingest` applies the decision files first, then `--landings` turns every merge on `origin/staging` and `origin/dev` since that side's newest landing into a `verified-landing` event and advances that side's stage; a merge two workstreams claim, or none, goes to `workstreams/_unsorted.json` and no record changes (LIA-156). `ingest --slack` reads the channel through `slack-pull --json` — the cursor is `workstreams/.state.json`, advanced into `.state.next.json` and promoted by the sweep after the tick's commit — runs the same ladder over messages and replies, and writes an event only where both the workstream and the kind are provable. Everything else goes to Unsorted with `needs: "read"`, an unclaimed decision or ask as `kind: "new"` with a name proposed in its own words; no script here calls a model and none creates a workstream (LIA-157). A huddle canvas is never split by a script: it goes to Unsorted as notes nobody has read, the sweep reads it and writes its key points — one sentence per thing settled, asked for or dated, in the house voice, with the workstream it belongs to — and `huddle <ts> --points <file>` validates and records them: events where a workstream is named, proposals where none is, a milestone for a date, nothing at all for small talk. Reading the same notes again replaces what the sweep recorded before and keeps what a person placed. The corrections are how a person fixes what ingest got wrong, once: `attach` moves an unsorted item onto a workstream **and learns from it** — the thread root, the tickets, the PRs and the identifiers it used — so the next message like it attaches on its own; `new` opens a workstream from a proposal, `split` cuts one in two and divides its keys, `stage` says where a side really is and outranks a landing until the next one, and every verb keeps its `--reason` on the event it writes. `check` prints the workstreams busy enough to have stopped being one thing and `propose-split` queues what a reader decided — the check never cuts anything (LIA-158). `changed --since` is what a tick hands the ticket pass, and `ticket-plan <slug> <LIA-nn> --body <file>` is the diff between a ticket body and its workstream's open questions and facts — the edits to apply, and the things only a person may decide. It is pure and holds no Linear key: the worker reads and writes Linear, argus never does (LIA-159). Nothing here reads the network beyond the channel pull, no `.state/` and no clock beyond `--now`, so a run that changes no record writes no byte; a page that breaks a style rule is never written and the run exits non-zero naming the line |
| `scripts/sync-skills.ts` | symlink every `skills/<name>/` into the global Claude skills folder, per skill; prunes only its own dangling links |
| `scripts/bootstrap.sh` | brand-new Mac → running sweep, in phases; `--check` reports without touching anything ("Setting it up") |
| `.env.example` | argus's one secret, `SLACK_TOKEN` — copy it to `.env` (gitignored, and Bun loads it for every `bun …` script) and fill it in; `./scripts/bootstrap.sh env` does both. Each tool keeps its own env file: Foundry's is `~/.foundry/env`, Pensieve's is its `.env` |
| `skills/log-change/scripts/pr-facts.ts` | resolve a landing in either repo and name the features it touches (FE via the index's reach sets, BE via `be_files` + changed route lines → endpoint owners); `--since` finds unjournaled ones, and `--since <day> --json` prints them as the structured landings `marauder ingest` reads. It exports `git`, `REPOS` and `landingsSince` so nothing else shells out to git twice |
| `skills/sweep/scripts/marauder/slack-pull.ts` | the deterministic half of `ingest --slack`: cursor bookkeeping, pagination, thread following, user-id resolution, noise filtering and permalinks. It never touches `.state.json` except to adopt the digest's old cursor once, and writes the advanced one to `.state.next.json` — a crashed tick replays the channel instead of skipping it |
| `reports/`, `reports/points.json`, `digests/`, `arcs/` | the archive: the sweep report, its Needs-you points, the daily Slack digest and the per-initiative arc, all of which the workstream replaced on 2026-09-09 (LIA-161). Still rendered in Pensieve as history; written by nothing |

## Setting it up

`./scripts/bootstrap.sh` takes a brand-new Mac to the point where `bun run sweep` works.
Same shape as Foundry's: phases that run alone (`prereqs`, `repos`, `deps`, `skills`,
`state`, `env`, `check`), `--check` to report without changing anything, a prompt before
every install, a no-op when a step is already done. It installs git / bun / `claude`,
reports whether the product checkouts the feature manifests name are where they should
be (cloning them is yours — nothing here knows a remote), runs `bun install`, links the
skills globally, rebuilds `.state/` from the FE tree, and puts `SLACK_TOKEN` in the
checkout's `.env` — created from `.env.example` at mode 600, read by slack-pull itself, so
no token is ever exported into the shell (`foundry auth --slack` prints one to paste). The
one thing it can only point you at is the Linear MCP login, which is `/mcp` → linear →
Authenticate inside a Claude session opened in this directory.

```sh
./scripts/bootstrap.sh            # everything, asking first
./scripts/bootstrap.sh --check    # what's missing, touching nothing
./scripts/bootstrap.sh check      # just: is the Linear MCP server authenticated?
```

## Running it

```sh
/loop 15m /sweep         # the whole loop, self-maintaining while a session is alive
/sweep                   # one manual pass ("catch me up")
/log-change              # journal one landing by hand
bun run marauder board   # where every open workstream stands, right now
bun run marauder show usage-page                     # one workstream's whole story
bun run marauder changelog 2026-09-09                # what changed that day
bun run marauder ingest --landings --slack           # a tick's intake (--dry-run to look first)
bun run marauder check                               # which workstreams may have stopped being one thing
bun run marauder changed --since 2026-09-09T12:00:00Z   # what a tick hands the ticket pass
bun run marauder attach <id> <slug> --reason "…"     # move an unsorted item, and learn from it
bun run marauder render  # the board, every workstream's page, and today's changelog
bun run accio audit      # reconcile without writing anything (fails when a feature's two doc tiers disagree)
bun run accio stale      # which features' docs drifted, and why (tiers / fe-core / be-handlers / journal)
bun skills/log-change/scripts/pr-facts.ts --since 2026-08-21   # what landed, what's unjournaled
bun run sync-skills      # after adding/removing a skill: make it global (--check to only report)
```

Everything commits locally and never pushes; anything needing judgement reaches you on the
board, not in a file you have to be told to open.

## Downstream: sending a ticket to Foundry

[Foundry](~/git/foundry) — the orchestration layer for disposable Claude Code forges —
executes what you approve. It never reads the blackboard and never judges readiness; it
takes one HTTP call and runs it. This section is the contract
between the three repos.

**Ready is an explicit signal, not an inference.** A ticket qualifies mechanically when
its **Pending** section is empty, it has no blocked-by relation, and its Acceptance
Criteria are concrete (observable outcomes, each grounded in a Technical Note, per the
linear-ticket house format) — but nothing acts on that alone. The handoff is two steps,
judgement staying on this side:

1. **You decide in Pensieve.** A workstream's page lists its tickets, and Send sits beside
   one whose Pending section is empty. The board is what got you there: it says what the
   ticket is for, what landed toward it and what is still open, which is the judgement Send
   is. An Ask opened from the workstream shows the same controls, and the model can propose
   a correction or a send as a card whose Confirm is the same click. The verdict lands as
   `decisions/send/<ticket>.json`.
2. **Foundry executes.** Send is a `POST /api/jobs` with `ticketId`, `repo` and the ticket
   key as the `Idempotency-Key` — no brief. Foundry composes the brief from the ticket
   body, claims the ticket atomically (job row in its Postgres ledger, unique on ticket
   key, *before* touching Linear), marks it In Progress and ignites an ephemeral job
   forge; the Acceptance Criteria are its definition of done.

The sweep no longer nominates a ready ticket: readiness was a line in a report, and the
report is gone. It still refuses to touch a ticket Foundry is running — the edits are
computed, held, and put in front of you as something the board shows (`skills/sweep/SKILL.md`,
Autonomy). Moving Send onto the workstream page is LIA-162, and until it lands there is no
button: send from Foundry directly, or wait for it.

```mermaid
flowchart LR
    sweep["/sweep"] -- "events on a workstream" --> ws["workstreams/*.json"]
    ws --> board["marauder/board.md<br/>+ the workstream page"]
    board --> pensieve["Pensieve"]
    pensieve -- "Send: POST /api/jobs" --> foundry["Foundry API"]
    foundry -- "job id + url" --> pensieve
    pensieve -. "action: sent, job" .-> decisions["decisions/send/*.json"]
    pensieve -. "attach · new · dismiss · stage" .-> mdec["decisions/marauder/*.json"]
    mdec -. "the next ingest applies it" .-> ws
    foundry -- "claim in Postgres,<br/>ignite" --> forge["job forge<br/>(ephemeral)"]
```

Ground rules, mirroring the sweep's own write policy:

- **No Send, no pickup.** An unblocked ticket is not the same as the ticket you want
  worked next; nothing downstream guesses the queue order, and no label signals it —
  `agent-ready` is retired and read by nothing.
- **Claim before work.** The Postgres insert is the lock — a double click, a retry after
  a timeout, or you plus the agent can never double-work a ticket; the ticket key is the
  idempotency key that makes the retry safe.
- **Decide after a sweep tick**, so what you send is reconciled state rather than a
  ticket a fresh landing already mooted.
- **Own worktree, always.** Job forges work in per-job clones (`~/.foundry/jobs/<id>/`),
  never the shared FE working tree.

Foundry's own README documents the API and the forge internals; this section stays the
source of truth for what a Send means.
