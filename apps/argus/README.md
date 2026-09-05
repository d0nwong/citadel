# argus

A one-person orchestration workspace for **alden-portal**: it watches the places where
change happens — #dev-team Slack, Linear (team `Liamai`), and the FE/BE repos — and keeps
three durable records honest: a daily Slack digest, a per-feature change journal (the
"why" layer), and dual-tier feature docs (the "what" layer, verified against both repos).
Built for a part-time schedule: everything is incremental, idempotent, and catch-up-safe,
so the first run after days away simply backfills.

## The three systems, as of 2026-09-05

Three repos share this work. Each has one job, and the seams between them are files and
one HTTP API — nothing else.

| | job | today | never |
|---|---|---|---|
| **argus** (this repo) | Knows. The blackboard is the single source of truth for everything not in Linear or a repo; the sweep keeps it current, reconciles landings against tickets, and nominates what needs a decision. | Files (`digests/`, `reports/`, `features/*/journal`, `features/*/docs`) plus skills run by `/loop` sessions. Produces a report; holds no queue. | Dispatch work. Close tickets. Run as a daemon. |
| **Pensieve** (`~/git/pensieve`) | The decision surface. Where you read what argus reports and decide what to act on. | A reading room: renders the report, digests, journal and docs for every app under the blackboard. Writes nothing. | Hold workflow state of its own. Write any blackboard file other than `decisions/`. |
| **Foundry** (`~/git/foundry`) | Executes. Takes a job over HTTP, runs it in an ephemeral forge, pushes a PR, reports back. | Jobs, blueprints, repos, forges, the trigger API. Also still carries the `agent-ready` ticket scanner, which makes it a decider as well. | Read the blackboard. Judge readiness. Choose what runs. |

One line: **argus knows, you decide in Pensieve, Foundry does.**

The gap between today and that line is the scanner and the label: today the handoff is
"sweep nominates, you label in Linear, Foundry polls the label". The decided target moves
the decision onto the screen where the report is read — the sweep emits each Needs-you
point as data, Pensieve lets you send a point to Foundry or ignore it with a reason, and
the scanner and the label retire. That is tickets LIA-87 → LIA-94 across the three Linear
projects, in the order `PLAN.md` gives; the diagram is `canvas/setup.json` (`bun run canvas`, then `?g=setup`). The
"Downstream" section at the bottom describes the label path and is superseded when LIA-89
lands.

## The loop at a glance

Each sweep tick walks four stages, each feeding the next; a fifth, dashed because it is
planned and gated on your label, hands ready tickets off to Foundry:

```mermaid
flowchart LR
    capture["1 · Capture<br/>Slack digests +<br/>repo landings"]
    journal["2 · Journal<br/>one entry per landing<br/>(the why)"]
    docs["3 · Docs<br/>dual-tier product + arch<br/>(the what)"]
    tickets["4 · Linear<br/>file tickets from ✋ items,<br/>annotate + review open ones"]
    nominate["5 · Nominate<br/>report: 'LIA-xx looks<br/>agent-ready — label it?'"]
    pickup["Foundry pickup<br/>(planned)"]

    capture --> journal --> docs --> tickets
    tickets -.-> nominate -. "you apply the<br/>agent-ready label" .-> pickup
```

## Architecture

The design is a blackboard, not a pipeline of agents:

- **Durable state lives in files.** `digests/`, `features/*/journal/`, `features/*/docs/`.
  Statuses in journal frontmatter (`decided → implemented → documented`, with
  `superseded` and `hold:` as the explicit escape hatches) are the workflow state — no
  agent's memory is load-bearing.
- **Reconciliation is deterministic.** `pr-facts --since` says which landings lack a
  journal entry; `accio audit` cross-checks docs against code and journal entries against
  each other (including decisions whose change landed without anyone linking back). Code
  does the joins an LLM would only guess at.
- **Agents are stateless workers.** `slack-digest`, `log-change`, `feature-docs` each make
  one kind of file current, in a subagent, and can be re-run at any time; `ticket-pass`
  does the same for Linear (files tickets from ✋ items, reviews open ones against
  refreshed docs) and marks the digest file so its work is visible to the next tick. A
  stage gets a subagent when its reading is bulky *and* its output lands on the
  blackboard — the join, nomination and the report stay in the sweep itself.
- **`/sweep` is the scheduler, and it is deliberately dumb.** Each tick it makes the
  digest current, scans for unjournaled landings, joins them against open tickets and
  open decisions, dispatches workers per item, audits, and reports — the files decide
  what runs. `/loop 2h /sweep` is the intended mode.

```mermaid
flowchart TB
    subgraph world["Outside world"]
        slack["#dev-team Slack"]
        linear["Linear — team Liamai"]
        staging["FE staging / BE origin/dev"]
    end

    subgraph workers["Stateless workers (subagents)"]
        sd["slack-digest"]
        lc["log-change"]
        fd["feature-docs"]
        tp["ticket-pass"]
    end

    subgraph blackboard["Durable state — the blackboard"]
        digest["digests/YYYY-MM-DD.md"]
        journal["features/*/journal/*.md<br/>(status = workflow state)"]
        docs["features/*/docs/<br/>product.md + arch.md"]
    end

    prfacts[["pr-facts --since<br/>deterministic: which landings<br/>are NOT JOURNALED"]]
    audit[["accio audit<br/>deterministic reconciler"]]
    join{"/sweep — the join<br/>landings × open decisions × open tickets"}
    report(["report — leads with 'needs you'"])

    slack --> sd --> digest
    sd -. "files action items" .-> linear
    staging --> prfacts --> join
    digest --> join
    linear -- "open tickets" --> join
    journal -- "open decided / hold" --> join
    join -. "annotate PR link —<br/>NEVER close" .-> linear
    join -- "one dispatch per landing" --> lc --> journal
    journal -- "implemented, no hold" --> fd --> docs
    digest -- "✋ items" --> tp
    docs -- "refreshed features" --> tp
    tp -- "files tickets,<br/>annotates evidence" --> linear
    tp -. "→ LIA-xx marker" .-> digest
    journal --> audit
    docs --> audit
    audit --> report
```

The one rule that keeps this safe to run unattended: **the sweep writes facts and
questions, never guesses.** An unattributed landing is journaled with `ticket: null` and
asked about in the report; a ticket whose work appears already merged is annotated with
the PR link but closing it stays a human decision — a landing may implement half a
ticket, and a wrongly closed ticket vanishes from the only queue that gets read.

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
a named problem, and the sweep report carries them verbatim.

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
| `digests/` | Slack made durable — permalinked and triaged, so nothing ever re-reads raw threads |
| `reports/` | The sweep's judgement calls made durable — the only file that holds inference (appears-implemented, appears-redundant, nominations), so it is a snapshot per day, never a source anything else reads back |
| `features/*/journal/` | The spine: *this* decision + *this* ticket + *this* landing. That connection exists in no single external source — Slack doesn't know the PR, git doesn't know the why, Linear doesn't know the merge sha — which is why frontmatter is never guessed: a wrong key corrupts the only record of the join. |
| `features/*/docs/` | The repos distilled to present-tense facts, sha-stamped (`last_verified` / `last_verified_be`) so staleness is detectable rather than suspected |
| `.doc-workspace/` (manifest + OpenAPI) | Routing — which files and endpoints belong to which feature; what lets a diff or an endpoint named in Slack be attributed at all |

The sweep just walks these in order: capture the perishable one, check claims against
ground truth, join, and surface only the judgement calls.

## Layout

| Path | What it is |
|---|---|
| `digests/` | daily Slack digests (`.state.json` is gitignored cursor state) |
| `reports/` | one sweep report per day, updated in place each tick — Needs-you / Linear / Audit re-emitted as current state, Done-today appended per tick; never shrunk by a quiet tick |
| `alden/alden-portal/features/<dir>/docs/` | dual-tier docs — `product.md` + `arch.md` |
| `alden/alden-portal/features/<dir>/journal/YYYY-MM/YYYY-MM-DD/` | change journal, one file per landing, grouped by month and day |
| `alden/alden-portal/.doc-workspace/` | feature manifest + OpenAPI snapshot |
| `foundry/`, `pensieve/` | the same `features/<dir>/docs/` + `.doc-workspace/` layout for the two single-repo apps (`~/git/foundry`, `~/git/pensieve`). No backend repo, so their docs carry no `be:` sources and no `## FE/BE Mismatches`; their manifests are hand-curated, since `accio map` needs an FE route tree plus an OpenAPI spec and neither app has one. Pensieve discovers them by their `features/` tree and addresses a feature as `<app>/<dir>`; `accio` is still hardcoded to `alden/alden-portal` |
| `skills/` | the workers and the scheduler (`sweep`, `slack-digest`, `log-change`, `feature-docs`, `linear-ticket`, `api-lookup`, `office-hours`), plus `prototyping` for fast issue-to-PR spikes |
| `scripts/accio.ts` | index / sync / audit over docs + journal |
| `scripts/sync-skills.ts` | symlink every `skills/<name>/` into the global Claude skills folder, per skill; prunes only its own dangling links |
| `scripts/bootstrap.sh` | brand-new Mac → running sweep, in phases; `--check` reports without touching anything ("Setting it up") |
| `.env.example` | the one secret the loop needs, `SLACK_TOKEN`, and where it comes from; copy to `.env` |
| `skills/log-change/scripts/pr-facts.ts` | resolve a landing; `--since` finds unjournaled ones |

## Setting it up

`./scripts/bootstrap.sh` takes a brand-new Mac to the point where `bun run sweep` works.
Same shape as Foundry's: phases that run alone (`prereqs`, `repos`, `deps`, `skills`,
`state`, `env`, `check`), `--check` to report without changing anything, a prompt before
every install, a no-op when a step is already done. It installs git / bun / `claude`,
verifies (or offers to clone) the two alden checkouts at the paths `accio` expects and
never switches their branches, runs `bun install`, links the skills globally, rebuilds
`.state/` from the FE tree, and creates `.env` from `.env.example`. Two things it can
only point you at: `SLACK_TOKEN` in `.env` (documented there) and the Linear MCP login,
which is `/mcp` → linear → Authenticate inside a Claude session opened in this directory.

```sh
./scripts/bootstrap.sh            # everything, asking first
./scripts/bootstrap.sh --check    # what's missing, touching nothing
./scripts/bootstrap.sh check      # just: is the Linear MCP server authenticated?
```

## Running it

```sh
/loop 2h /sweep          # the whole loop, self-maintaining while a session is alive
/sweep                   # one manual pass ("catch me up")
/slack-digest            # digest only
/log-change              # journal one landing by hand
bun run accio audit      # reconcile without writing anything (fails when a feature's two doc tiers disagree)
bun run accio stale      # which features' docs drifted, and why (tiers / fe-core / be-handlers / journal)
bun run accio journal    # day view over landings (a date, or --since YYYY-MM-DD)
bun skills/log-change/scripts/pr-facts.ts --since 2026-08-21   # what landed, what's unjournaled
bun run sync-skills      # after adding/removing a skill: make it global (--check to only report)
```

Everything commits locally and never pushes; anything needing judgement lands in the
sweep report, not in a file.

## Downstream: Foundry ticket pickup (planned)

[Foundry](~/git/foundry) — the orchestration layer for disposable Claude Code forges —
will consume the queue this workspace maintains: a periodic scanner picks up Linear
tickets that are ready to be worked on and ignites a job forge per ticket. The design is
agreed but not yet built; this section is the contract between the two repos.

**Ready is an explicit signal, not an inference.** A ticket qualifies mechanically when
its **Pending** section is empty, it has no blocked-by relation, and its Acceptance
Criteria are concrete (observable outcomes, each grounded in a Technical Note, per the
linear-ticket house format) — but Foundry
never acts on that alone. The handoff is three steps, judgement staying on this side:

1. **Sweep nominates.** Sweep step 6d checks every open ticket against that bar each
   tick; a ticket that newly qualifies gets a Needs-you line ("LIA-xx looks agent-ready —
   label it?"). Nomination is inference, so it goes in the report, never into Linear.
2. **You confirm** by putting the `agent-ready` label on the ticket. The label is the
   whole API between the repos.
3. **Foundry executes.** A host-side scanner in Foundry's web server polls for labeled
   tickets, claims one atomically (job row in its Postgres ledger, unique on ticket key,
   *before* touching Linear), marks it In Progress, and ignites an ephemeral job forge
   with the ticket body as the brief; the Acceptance Criteria are its definition of done.

```mermaid
flowchart LR
    sweep["/sweep 6c<br/>ticket pass"] -- "nominate in report" --> you(["you"])
    you -- "agent-ready label" --> linear["Linear — Liamai"]
    scanner["Foundry scanner<br/>(web/, host-side)"] -- "poll label,<br/>claim in Postgres" --> linear
    scanner -- "ignite" --> forge["job forge<br/>(ephemeral)"]
```

Ground rules, mirroring the sweep's own write policy:

- **No label, no pickup.** An unblocked ticket is not the same as the ticket you want
  worked next; Foundry never guesses the queue order.
- **Claim before work.** The Postgres insert is the lock — two scan ticks, or you plus
  the agent, can never double-work a ticket.
- **Scan after a sweep tick**, so the scanner reads reconciled state rather than tickets
  a fresh landing already mooted.
- **Own worktree, always.** Job forges work in per-job clones (`~/.foundry/jobs/<id>/`),
  never the shared FE working tree.

When this ships, Foundry's own README (architecture diagram + `web/README.md`) documents
the scanner's internals; this section stays the source of truth for the label contract
and the nomination flow.
