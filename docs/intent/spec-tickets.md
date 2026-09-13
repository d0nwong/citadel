# Intent: a ramble becomes a spec, and the spec becomes the tickets (CTD-192)

Confirmed 2026-09-13, from an `interview-me` session over the notes in CTD-192. The spec says how.

## Outcome

A front door for Citadel that puts the one human at the highest-leverage point, the spec, and
leaves the rest of the factory as it is:

1. **interview** (`/scope`) — a ramble (two sentences, a ticket of notes, a voice-note transcript) is
   clarified one question at a time, each question carrying the model's guess, until the intent
   can be restated and confirmed. This is the `interview-me` → intent → spec sequence from the
   addy `agent-skills` plugin, kept as a conversation, not turned into a form.
2. **revision** — the confirmed intent, the revised feature spec and the plan are one *revision*, kept
   together in citadel-data under the parent ticket that will carry it:
   `revisions/<parent>/{intent,spec,plan}.md`. The two pairs in this repo's `docs/intent` and
   `docs/spec` move there too.
3. **tickets** — the plan is the ticket breakdown: one Linear parent issue for the revision, one
   sub-issue per spec section or criterion group, each with its own Acceptance Criteria copied
   from the spec and a link back to the revision's spec, with order and blocking relations.
   Linear stays the management tool; work stays ticket-based.
4. **baseline** — each feature keeps one live spec beside its arch doc. It changes only when the
   revision is live: when the parent settles Done, argus's reconcile folds the revision into every
   feature it names and moves the revision to `revisions/archive/`. A parent settled Cancelled is
   archived as-is and the baseline is untouched. Archived, never deleted: a dropped spec is
   evidence of what was considered.
5. **research** — a Foundry job on a ticket cut from a revision is handed the revision's spec and
   the feature's arch doc, through the CTD-190 hydration. The job's own spec step confirms a
   reviewed spec instead of deriving one from prose.

## User

The one tech lead running Citadel part-time: the only person writing specs and the only person
reading what the factory makes.

## Why now

Foundry's only human inputs today are a ticket's prose Acceptance Criteria and the PR read at
the end, the two lowest-leverage points. Everyone who has run a factory without a human at the
spec reports the same failure within months (HumanLayer's lights-off run, July–November 2025;
Osmani's "comprehension debt"), and the same answer: the human reviews the design and the plan,
not the code. The `agent-skills` interview produced, in one session, a better spec than a
hand-written one, and CTD-185's own sub-issue series is the shape the plan should produce
mechanically.

## Success

- A Foundry job started from a ticket cut from a revision has its spec step confirm the revision's
  spec rather than derive one, and its PR body cites it.
- For a routine change, the spec revision is what gets reviewed; the PR is merged on the verify
  report.
- The interview runs the same from Claude Code in a terminal and, later, from Pensieve's Ask.

## Constraints

- **The skill proposes; a click writes.** Same rule as every other Ask card: the interview ends
  in a proposal, the decision file is what creates the revision directory and files the tickets.
  Ask stays read-only and argus stays the one writer of citadel-data.
- **A Claude Code skill first, Ask second.** The interview that works today runs on the full
  plugin and a frontier model in a terminal. The argus skill is built to run there; Ask loads
  it once it exists and gains a model choice then.
- **One live spec per feature, updated only when the revision is live.** In flight, the
  revision sits under `revisions/` beside the baseline, and Linear carries its status.
- **Foundry stays unattended.** Nothing here adds a gate between ignition and the PR.
- **The spec never replaces a ticket.** It is where a ticket's criteria come from and where a
  job goes to understand them.

## Out of scope

- Human review gates inside a running job, on a research or plan file. Foundry stays
  lights-off from ignition to PR; the human's gate is before ignition.
- Pensieve, in this slice: running the interview from Ask, the revisions pages, a spec tier
  on the docs page. They follow once the skill exists and there is something to show.
- Changing Foundry's spec, plan, implement or verify skills beyond what they read at the start.
- Multi-user specs, sign-off, or any workflow for a second reviewer.

## Sources

- Dex Horthy, *Advanced Context Engineering for Coding Agents* (YC Root Access; the essay is
  `humanlayer/advanced-context-engineering-for-coding-agents/ace-fca.md`), and *Why Software
  Factories Fail* (`wsff.md` in the same repo).
- Addy Osmani, *Software Factories, Light and Dark*.
- Sean Grove, *The New Code* (AI Engineer World's Fair 2025): the spec is the source; code is
  the compiled output.
