# Spec: Argus and Pensieve, rebuilt around the ledger

Written 2026-09-10 from the confirmed intent (`docs/intent/argus-pensieve-rebuild.md`) and
the refined idea (`docs/ideas/argus-pensieve-rebuild.md`). This file is the source of
truth for the rebuild. When a decision changes, change it here first.

## Objective

Give one part-time tech lead, soon full-time, a trustworthy answer at any moment of the day
to "how is this feature going, and what is on me?" for alden-portal, when the business
rules are discovered after launch and the intent lives in #dev-team Slack.

The answer is the one a tech lead gives a founder, in five parts: is it going well, do the
two codebases agree, does the code satisfy the requirements, what is on me, is the
architecture sound. Under it sit a Needs-me list that closes itself on evidence, a list of
the user's own tickets that are ready versus blocked, and a chat with Argus over the same
record.

Three systems, unchanged in their split:

- **argus** knows. This repo. The ledger per feature, the run that keeps it current, and
  the skills and scripts that do it.
- **Pensieve** shows and decides. `~/git/pensieve`. Renders the ledger, takes the clicks,
  hosts Ask.
- **Foundry** executes. `~/git/foundry`. Unchanged by this rebuild; receives a ticket key
  and a repo.

### User stories

1. I open a feature I have not looked at in a day and, from the page alone, reply in its
   Slack thread within a minute.
2. I fixed something, the team acknowledged it in Slack, no doc was written. On the next
   run the ask is closed with the acknowledgement as its evidence, and it is gone from
   Needs-me.
3. Sam merges a backend endpoint to `origin/dev` and it deploys. On the next run my
   frontend ticket that waited on it becomes ready, without a click.
4. Foong says "actually the payment term lives on the billing profile." The requirement
   that said otherwise flips to contradicted, citing his message, and a new ask appears.
5. Every rule on the page says assumed, confirmed, or contradicted, with who and when.
6. I ask Argus "what did Foong ask for on invoicing this week" and get a cited answer from
   the ledger, not from a re-read of Slack.
7. A message the run could not place sits in an Unplaced list. One click places it, and
   the rest of that thread never asks again.
8. I see which of my tickets are ready, press Send, and Foundry gets it.

### Acceptance criteria, testable

- Replay of the last 14 days of #dev-team attributes at least 80% of messages the user
  placed by hand to the same feature, without reading any `work.json`.
- The invoicing thread for the Due-on-invoice button (the case the user named) closes on
  the run that first sees the team's acknowledgement, in a replay.
- A ticket with one `landing` blocker flips `ready: true` on the run after `pr-facts`
  reports the PR on `origin/dev` and the deploy check passes.
- `argus validate` refuses any ledger where a story sentence, a requirement, or an ask
  status change carries no evidence.
- The sweep skill is under 120 lines. Each other skill is under 100. `arch.md` is under
  250 curated lines per feature (the regions `accio sync` generates do not count). The validator enforces the doc cap; a line count test enforces
  the skill caps.
- A run with no new Slack messages and no new landings makes no model call and writes no
  byte.

## Tech Stack

- Bun 1.x, TypeScript 5.9, `bun test`. No Node-only libraries where Bun has the API.
- Claude Code skills in this repo, run by `/loop 15m /sweep` or on demand. Workers are
  subagents spawned by the sweep with `model: "opus"`; the loop session runs on Sonnet.
- Slack Web API with a user token (`SLACK_TOKEN` in `.env`), read only.
- Git over local checkouts of the FE and BE repos, fetched to `origin/staging` and
  `origin/dev`, never switched. Pinned by sha in every evidence pointer.
- Linear via the MCP tools in a session (filing, editing) and the API key in Pensieve
  (filing from a proposal card).
- A session's Linear and Slack MCP tools come through one local gateway (mcp-proxy on
  :9090), `.mcp.json`'s `linear` and `slack`: the gateway holds the upstream keys and a
  session presents `MCP_GATEWAY_TOKEN` from `.env`, via `scripts/mcp-headers.ts`.
  `slack-pull` stays on the Web API.
- Pensieve: TanStack Start, React 19, Tailwind 4, `@tanstack/ai-claude-code` for Ask, as
  today. It shells out to `bun scripts/argus.ts <verb>` in the argus checkout for every write.

## The record

One file per feature, `<app>/features/<feature>/ledger.json`, written only by
`argus write` after validation, and only ever replaced whole. The model produces the next
version; code checks it and diffs it. Nested features (`admin/usage`) keep their nesting.

```jsonc
{
  "feature": "admin/invoicing",
  "as_of": "2026-09-10T14:05:00Z",
  "summary": "Invoices per entity, with credit usage, payment terms and the emails that go out.",

  // The founder's five questions. "on_you" is derived from asks, never written.
  "story": {
    "health":       { "text": "Going well. The launch build is on staging and Sam is closing the email defects.", "evidence": [ ... ] },
    "gaps":         { "text": "The frontend sends paymentTerm on the invoice; the backend reads it from the billing profile.", "evidence": [ ... ] },
    "requirements": { "text": "Eleven of fourteen rules confirmed. Two contradicted since Tuesday, both on the retainer floor.", "evidence": [ ... ] },
    "architecture": { "text": "Sound. One concern: the credit email builder duplicates the invoice total formula.", "evidence": [ ... ] }
  },

  // The product doc. One row per business requirement, in the team's words.
  "requirements": [
    {
      "id": "R-3",
      "text": "A closed cycle that used more than its base credits is flagged.",
      "status": "confirmed",            // assumed | confirmed | contradicted | retired
      "by": "Foong Leung",
      "at": "2026-09-04",
      "evidence": [ { "kind": "slack", "url": "https://…/p1788…", "quote": "yes flag it red" } ],
      "code": [ { "kind": "file", "repo": "fe", "sha": "6dbc01f", "path": "src/features/usage/components/history-tab/history-tab-content.tsx", "line": 88 } ]
    }
  ],

  // Who asked for what, when, and what happened to it. The trail. An ask may carry
  // blockers like a ticket ("let me know when merged"); code clears them the same way.
  "asks": [
    {
      "id": "A-17",
      "text": "Foong wants the Due header to follow the payment term.",
      "by": "Foong Leung",
      "to": "you",                     // a person's name, "you", or null
      "at": "2026-09-08",
      "status": "closed",              // asked | answered | built | acknowledged | closed | dropped
      "origin": { "kind": "slack", "url": "…", "thread": "1788927279.211769" },
      "history": [
        { "at": "2026-09-09", "status": "built",        "evidence": [ { "kind": "pr", "repo": "fe", "number": 421, "url": "…" } ] },
        { "at": "2026-09-10", "status": "acknowledged", "evidence": [ { "kind": "slack", "url": "…", "quote": "looks great thanks" } ] },
        { "at": "2026-09-10", "status": "closed",       "evidence": [ { "kind": "slack", "url": "…" } ] }
      ],
      "requirements": [ "R-9" ],
      "ticket": "ALD-41"
    }
  ],

  // The user's own tickets. Ready is derived: no blocker left uncleared.
  "tickets": [
    {
      "key": "ALD-41",
      "title": "[FE] Due header follows the payment term",
      "asks": [ "A-17" ],
      "blockers": [
        { "kind": "landing", "repo": "be", "ref": "be#771", "branch": "origin/dev", "deployed": true, "cleared": { "at": "2026-09-10", "evidence": [ ... ] } },
        { "kind": "answer",  "from": "Foong Leung", "question": "on the invoice or the profile?", "cleared": null },
        { "kind": "ticket",  "key": "ALD-40", "cleared": null }
      ],
      "ready": false
    }
  ],

  // Landings on the base branches that touched this feature. The timeline.
  "landings": [
    { "at": "2026-09-10", "repo": "be", "ref": "be#771", "number": 771, "sha": "…", "title": "credit emails link to the production domain", "by": "Sam O", "url": "…", "asks": [ "A-17" ], "files": [ "src/services/emailService.ts" ] }
  ],

  // Proposals the model wants a click for. Pensieve renders them; a click runs the verb.
  "proposals": [
    { "id": "P-2", "kind": "ticket", "title": "[FE] Payment term on the billing profile", "body": "## Summary …", "asks": [ "A-19" ], "at": "2026-09-10" }
  ]
}
```

Evidence kinds: `slack` (permalink, optional quote), `pr` (repo, number, url), `commit`
(repo, sha), `file` (repo, sha, path, line), `ticket` (key), `assumption` (no pointer,
allowed only on a requirement with status `assumed` and on `story` text that says so).

Global state, under `state/`, gitignored except where noted:

- `state/cursor.json` — the Slack cursor and watched threads. Promoted after the commit.
- `state/threads.json` — thread root to feature, written by attribution and by a click.
  Committed. This is the only learned state.
- `state/batches/<iso>.json` — what one run pulled, kept for replay and debugging.
- `state/unplaced.json` — messages neither `place` nor the sweep could attribute, with
  the feature list each was read against. Pensieve's Unplaced list; a click empties it.

## Commands

`argus` and `accio` are CLIs: `bin` entries in `package.json`, `bun link` once, then
callable from anywhere. Skills call them bare. Pensieve spawns `bun scripts/argus.ts <verb>`
inside `WORKSPACE_DIR`, never relying on PATH.

```sh
# the run, one verb per stage; every verb takes --dry-run and is safe to repeat
argus pull      [--since <date>]          # slack + landings → state/batches/<iso>.json, cursor → cursor.next.json
argus place     <batch>                   # deterministic joins: files→feature, reply→thread root; prints per-feature batches + unplaced
argus write     <feature> <ledger.json>   # validate, diff, write the ledger; non-zero and no write on any violation
argus validate  [<feature>]               # schema, evidence, style, caps; what write runs first
argus commit                              # git add ledgers, threads.json, docs; commit; promote the cursor

# the click verbs Pensieve runs; each validates and writes exactly one thing
argus place     <message-id> <feature>    # attribute an unplaced message; records the thread→feature
argus close     <feature> <ask-id> --reason "<why>"
argus confirm   <feature> <req-id> [--contradict --reason "<why>"]
argus file      <feature> <proposal-id>   # prints the ticket body; Pensieve files it via Linear and calls `ticket`
argus ticket    <feature> <proposal-id> <ALD-key>   # records the key on the ask and the ticket list
argus sent      <feature> <ALD-key> --repo <name> --job <id>   # Pensieve posted the job (it holds the Foundry token); this records it

# what is where in the code and docs
accio find "<words>"                      # feature, files, endpoints for a screen, field or route
accio stale                               # features whose arch.md is behind their core files

# quality
bun test                                          # scripts/**/*.test.ts
bun run typecheck                                 # tsc --noEmit
bun run evals                                     # replays state/batches over fixtures, prints attribution and closure scores

# the loop
bun run sweep                                     # claude '/loop 15m /sweep' --model claude-sonnet-5 --dangerously-skip-permissions

# Pensieve, from ~/git/pensieve
bun run dev  |  bun run typecheck  |  bun test  |  bun run check
```

## The run (`/sweep`)

Seven steps. Every step reads files and is safe to repeat. Steps 3 and 4 are the only
ones that call a model, and only for what has new input.

1. **Pull.** `argus pull`. Slack since the cursor, threads followed, huddle canvases
   fetched as text, user ids resolved. Landings on `origin/staging` (FE) and `origin/dev`
   (BE) since each ledger's newest landing, with changed files. One batch file.
2. **Place.** `argus place <batch>`. A landing goes to every feature whose manifest core
   files or routes match its changed files. A reply goes where its thread root went
   (`state/threads.json`). A ticket key or PR number in the text goes to the ledger that
   lists it. Everything else is unplaced.
3. **Attribute.** The sweep session reads each unplaced message with the feature list,
   each feature's `summary`, and its open asks, and runs `argus place <id> <feature>` when
   it would bet on one. Otherwise the message stays unplaced for Pensieve. No vocabulary,
   no aliases beyond the manifest.
   A landing on a base branch that is deployed and serves an ask nobody has picked up on
   the other side is itself a trigger: the reader proposes an `[FE]` ticket for it.
4. **Rewrite.** For each feature with input this run, one subagent (`model: "opus"`),
   prompt in `skills/sweep/reader.md`. It receives the ledger, the feature's batch, the
   arch doc, and the requirement rows; it returns the next ledger and calls
   `argus write`. Its rules: move ask statuses only on evidence; close an ask when the
   asker or the team acknowledges the result, whether or not a doc changed; flip a
   requirement only on a message from someone who can decide it; clear a ticket blocker
   only on a landing that is on the branch and deployed; add a proposal instead of a
   ticket; write the four story texts in `style.md`'s voice; never write `on_you`.
5. **Docs.** For each feature whose core files changed this run, `feature-docs` refreshes
   `arch.md` under the cap. Product prose is not generated; the ledger is the product doc.
6. **Validate.** `argus validate`. Failures print and block the commit for that feature
   only.
7. **Commit.** `argus commit`, then the cursor is promoted. A crashed run replays.

Idempotence: a batch is named by its pull time and processed against ledgers whose `as_of`
is older than it. Rerunning a batch is a no-op once every ledger is newer.

## Project Structure

```
argus/
  SPEC.md                              this file
  README.md                            rewritten: the three systems, the ledger, the run
  docs/intent/  docs/ideas/            what was agreed and why
  scripts/
    argus.ts                           the run and click verbs (bin: argus)
    accio.ts                           the code-and-docs index (bin: accio), trimmed
    argus/
      schema.ts                        the ledger type + JSON schema, one source
      validate.ts                      schema, evidence, style, caps
      pull.ts   slack-pull.ts  pr-facts.ts   (the two salvaged scripts, moved)
      place.ts                         deterministic joins
      write.ts  commit.ts  send.ts  linear.ts
      *.test.ts                        beside the file they test
    accio/                             find, manifest, stale (from scripts/commands + lib)
  skills/
    sweep/SKILL.md                     the run, ≤120 lines
    sweep/reader.md                    the rewrite subagent's prompt and rules
    sweep/style.md                     the voice, kept
    feature-docs/SKILL.md              arch tier only, ≤100 lines; DOC-PROTOCOL.md cut to the arch half
    ask/SKILL.md                       answers over the ledger, proposes through the verbs, ≤100 lines
    linear-ticket/                     FORMAT.md kept; SKILL.md ≤100 lines, files from a proposal
    api-lookup/  prototyping/  office-hours/   unchanged
  alden/alden-portal/
    .doc-workspace/feature-manifest.json
    features/<feature>/ledger.json     the record
    features/<feature>/docs/arch.md    the technical spec, ≤250 lines
  pensieve/features/  foundry/features/   arch docs only, no ledgers in the MVP
  state/                               cursor, threads.json, batches/
  evals/
    fixtures/                          recorded batches and hand-placed expectations
    replay.ts                          attribution and closure scoring

Retired, deleted in the last phase, not before:
  marauder/  queue/  decisions/  reports/  digests/  arcs/  improvements/  canvas/
  features/*/journal/  features/*/work.json  features/*/board.md  features/*/docs/product.md
  skills/log-change/  skills/sweep/scripts/  skills/sweep/ticket-pass.md  .claude/skills/ (synced copy)
```

Pensieve after the rebuild:

```
src/routes/
  index.tsx              Needs-me · Ready · Unplaced, across features
  features/$.tsx         the five questions, requirements, asks, tickets, landings, arch link
  ask/                   the chat, over the ledger
  docs/$.tsx             renders arch.md
src/server/
  ledger.ts              reads ledger.json files
  argus.ts               spawns `bun scripts/argus.ts <verb>` in WORKSPACE_DIR; the only writer
  ask.ts  ask-tools.ts   as today, tools retargeted to the verbs
Deleted: archive, arcs, digests, reports, journal, unsorted, blocks routes and their server code;
         marauder.ts, decisions.ts, apply.ts, sections.ts.
```

## Code Style

Bun-first TypeScript, ESM, no default exports, one verb per file, every writer validates
before it writes and returns what it wrote. Tests beside the file. Comments explain why,
in one paragraph at the top of a file.

```ts
// scripts/argus/close.ts
import { readLedger, writeLedger } from "./write";
import { validateLedger } from "./validate";
import type { Ask, Evidence } from "./schema";

/**
 * Close one ask by the user's verdict. A click is evidence of kind "user", so the trail
 * shows who closed it and why; the model never writes this kind.
 */
export async function closeAsk(feature: string, askId: string, reason: string, at = new Date()) {
  const ledger = await readLedger(feature);
  const ask = ledger.asks.find((a) => a.id === askId);
  if (!ask) throw new Error(`${feature}: no ask ${askId}`);
  if (ask.status === "closed") return ledger;

  const evidence: Evidence = { kind: "user", reason, at: at.toISOString() };
  const closed: Ask = {
    ...ask,
    status: "closed",
    history: [...ask.history, { at: at.toISOString().slice(0, 10), status: "closed", evidence: [evidence] }],
  };
  const next = { ...ledger, as_of: at.toISOString(), asks: ledger.asks.map((a) => (a.id === askId ? closed : a)) };

  validateLedger(next); // throws with the path of the first violation
  return writeLedger(feature, next);
}
```

Conventions: `kebab-case` files, `camelCase` functions, ledger ids `R-n`, `A-n`, `P-n`
allocated by `write` and never reused. Dates are ISO; days are `YYYY-MM-DD`. Prose the
reader sees follows `skills/sweep/style.md`: a person does something in every sentence,
answer first, ids only on the evidence line, twenty-five words a sentence.

Skill shape, borrowed from addyosmani/agent-skills: fixed headings in this order —
Overview, When to Use, Process (numbered steps, one command each), Rules (one heading per
rule, a two-line body, no justification), Red Flags, Verification (a checklist). Prose
only where the model has to judge; anything mechanical is a command or a checklist. A
rule the code enforces gets one line or none. State a rule once, in the section that owns
it, and point at it from elsewhere. No dated provenance, no ticket keys, no retired
steps; git and `docs/` hold the history.

## Testing Strategy

- **Unit, `bun test`.** Every verb under `scripts/argus/` and every command under
  `scripts/accio/`. Schema round-trips, validator refusals (each rule has a failing
  fixture), the deterministic joins in `place`, cursor promotion, the idempotence of
  `write` on an unchanged ledger, `send`'s request shape. Target: every branch of
  `validate.ts` and `place.ts` covered; no coverage number elsewhere.
- **Evals, `bun run evals`.** Recorded batches under `evals/fixtures/` with the user's
  hand-placed expectations. Two scores, printed and kept in `evals/scores.md`:
  attribution (fraction of messages placed on the expected feature by steps 2 and 3) and
  closure (named asks closed on the expected message by step 4). Run by hand before any
  change to `reader.md` or `place.ts` ships. Gate: attribution ≥ 0.8, and the three named
  closure cases pass.
- **Pensieve.** `bun test` for `ledger.ts` reading fixtures, `argus.ts` argument shaping,
  and Ask tool proposals. Typecheck and `ultracite check` clean.
- **Manual.** One full `/sweep` on a copy of the checkout before the retire phase, read
  by the user in Pensieve.

## Boundaries

**Always**

- Validate before every write; a ledger that fails validation is never written.
- Every requirement, ask status change, ticket blocker clearance and story sentence
  carries evidence. `assumption` is an evidence kind, and it is visible.
- Call the model only for a feature with new input; write no byte on a quiet run.
- Pin every code pointer to a sha; fetch `origin/*`, never switch a checkout.
- Keep the caps: sweep ≤120 lines, other skills ≤100, arch.md ≤250 curated lines.
- Run `bun test` and `bun run typecheck` before a commit; run the evals before changing
  `reader.md` or `place.ts`.
- Commit locally after each run, one commit, message = the first Needs-me line or "quiet
  run".
- Address the user as "you" and everyone else by first name in anything rendered.

**Ask first**

- Filing a Linear ticket or editing a ticket body: always a proposal, then a click.
- Sending a ticket to Foundry: the click on Ready, with a confirm.
- Closing, dropping, or reopening an ask by hand; confirming or contradicting a
  requirement by hand. These are the user's verbs; the model only proposes when unsure.
- Adding a dependency to either repo. Changing the feature manifest. Changing the ledger
  schema after phase 1.
- Deleting anything under the retired list before the retire phase.

**Never**

- Post to Slack, DM anyone, or write to any channel.
- Close, cancel, or change the state of a Linear ticket. Tick an acceptance box.
- Push git, switch a product checkout, or write into one.
- Invent evidence, or attach an unplaced message to a feature on a guess. Unplaced is a
  valid state.
- Edit `ledger.json`, `state/threads.json` or anything under `state/` by hand. The verbs
  write them.
- Let Pensieve write the checkout through its own code. Every write is the `argus` CLI.
- Write product prose. The requirement rows are the product doc.
- Restore `marauder`, the queue, decision files, the apply lock, events, keys, or vocab.

## Build Order

Each phase ends with something the user can look at and a gate. Phase 3's gate is the one
that decides whether the design holds.

0. **Freeze.** Tag `main` as `pre-rebuild`. All rebuild work on a branch. Nothing deleted
   until phase 7.
1. **Schema and verbs.** `schema.ts`, `validate.ts`, `write.ts`, the click verbs, tests.
   Gate: `argus validate` refuses each fixture violation; `write` is a no-op on an
   unchanged ledger.
2. **Pull, place, replay.** Move `slack-pull.ts` and `pr-facts.ts`; `pull.ts`,
   `place.ts`, `state/`; record the last 14 days as `evals/fixtures/`; the user places
   the expectations once. Gate: deterministic attribution score printed.
3. **The reader.** `reader.md`, step 3 attribution, step 4 rewrite, `evals/replay.ts`.
   Run over `admin/invoicing` and `admin/usage` only. Gate: attribution ≥ 0.8, the
   Due-on-invoice case closes on the acknowledgement, the ticket blocker case flips.
   If the gate fails, the design changes here, not later.
4. **Seed.** Convert every feature's BR table to requirement rows (text only, status
   `assumed`, code pointer from the Source column); cap `arch.md`; trim `feature-docs`.
   Gate: `argus validate` passes for every feature; the user bulk-confirms one feature.
5. **Pensieve.** Home, feature page, click verbs through `argus.ts`, Ask over the ledger.
   Gate: user stories 1, 2, 5, 6, 7 pass by hand.
6. **Tickets.** Proposals, `file`, `ticket`, blockers, Ready, `send`. Gate: stories 3, 8.
7. **Retire.** Delete the retired list, rewrite README and CLAUDE.md, rewrite `sweep`
   under its cap, run one full `/sweep` on a copy, then merge and run it for real.

Phases 1 and 2 can run in parallel. 5 can start once 1 is done, on fixtures.

## Success Criteria

- The seven acceptance criteria under Objective hold.
- Eight user stories pass by hand in Pensieve after phase 7.
- The retired list is gone, `git grep marauder` returns nothing outside `docs/`.
- `bun run sweep` runs for a working day with no intervention and no false Needs-me.

## Open Questions

- Resolved 2026-09-11: Send is a button on Ready with a repo picker and a confirm. Pensieve
  posts to Foundry, because it already holds the token and the client; `argus sent`
  records the job on the ticket.
- Initial requirement statuses: seed all as `assumed`, bulk-confirm per feature once.
- Which `product.md` sections, if any, the user still reaches for and wants kept.
- Whether `pensieve/features` and `foundry/features` get ledgers in a later phase.
- Resolved 2026-09-11: the dev swagger carries no build marker. `deployed` for a backend
  landing is Bitbucket's pipelines API saying the merge commit's pipeline on `dev`
  completed SUCCESSFUL (every merge to `dev` deploys to App Engine). Credentials are the
  ones `bb` keeps in `~/.bitbucket-rest-cli-config.json`, read by `scripts/argus/deploy.ts`
  and nowhere else. The frontend's equivalent is decided when a frontend blocker is first
  needed.
