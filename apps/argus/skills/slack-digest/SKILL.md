---
name: slack-digest
description: Incrementally digest #dev-team Slack activity into a daily markdown file (digests/YYYY-MM-DD.md) with permalinks, so a part-time teammate can catch up on decisions they missed. Normally invoked as step 1 of /sweep; can also run standalone or hourly via /loop. Use when asked to digest the dev channel, catch up on Slack, or when invoked as /slack-digest.
---

# slack-digest — incremental catch-up digest for #dev-team

Purpose: the user is part-time and misses decisions made in Slack, which makes the
dual-tier feature docs (`alden/alden-portal/features/*/docs/`) go stale. Each run reads
only the messages that arrived since the last run and merges them into today's digest
file.

Normally this runs as step 1 of `/sweep` (`skills/sweep/SKILL.md`), which then triages
the digest *file*: it drives `/log-change` / `/feature-docs` from the 🔴 items and its
`ticket-pass` worker files Linear tickets from the ✋ items and folds thread outcomes
into the tickets they concern. **This skill never writes to Linear** — it captures; the
sweep acts. A standalone run or an hourly `/loop` is also fine — the digest is
incremental and catch-up-safe either way, and a sweep after a gap simply backfills.
Without a sweep, the end-of-day pass falls to the user reading the digest, pushing 🔴
items through `/log-change` and ✋ items through `/linear-ticket` by hand.

Constants:
- Channel: **#dev-team**, id `C07KG06L601`, workspace `alden-studios.slack.com`
- The user is `U09R2MYP6A0` (Liam / yickkiu)
- Linear: team **Liamai** (key `LIA`) — read-only here, to link items to the open
  ticket they concern
- State file: `digests/.state.json`
- Digest file: `digests/YYYY-MM-DD.md` (local date, one per day)

Slack is read by a script, not by MCP tools: `scripts/slack-pull.ts` does the cursor
bookkeeping, pagination, thread following, user-id resolution and noise filtering, and
prints one compact transcript. It needs `SLACK_TOKEN`, read from the environment and
nowhere else — Bun loads the argus checkout's `.env`, which `./scripts/bootstrap.sh env`
writes. Fall back to the MCP tools (`slack_read_channel`, `slack_read_thread`, ToolSearch
them first) only if the script cannot run — and say so in the report.
If the Linear tools are deferred, ToolSearch `mcp__linear-server__list_issues` — the
only Linear tool this skill uses.

## Run it in a subagent

The thread transcripts this skill reads are bulky and single-use — they belong in a
subagent's context, not in the session the user is working in.

**If you are the main session**, don't run the procedure yourself. Spawn ONE
general-purpose subagent via the Agent tool with **`model: "opus"`** — the triage in
step 4 is a judgement call and a weaker model writes a worse digest, which every later
stage then reads. The override is deliberate: the sweep loop runs on Sonnet (`bun run sweep`) so
the scheduler is cheap, and every worker that writes pins the judgement tier itself
rather than inheriting whatever the session happens to be on. Give it this task:

> Invoke the `slack-digest` skill and follow it to completion. You ARE the subagent for
> this run: execute the procedure directly, starting at step 1. The working directory is
> the `argus` repo. Report back the number of new items, every decision / action
> item / needs-you item with the Linear key it links (if any), and the commit sha — or
> "no-op, nothing new".

When it reports, relay the summary to the user yourself, in the shape step 10 describes.
A subagent's report is never shown to the user — an unrelayed run is an invisible one.

**If you are the subagent** — your task says so, or another agent spawned you — ignore
this section and start at step 1. Never spawn a subagent from here: it would recurse.

Run inline only when the user explicitly asks to watch it happen in the foreground.

## Procedure

**1–3. Pull.** One command replaces load-state / fetch / follow-threads:

```sh
bun skills/slack-digest/scripts/slack-pull.ts
```

It reads `digests/.state.json` (schema below; missing → last 24h), fetches every
channel message newer than `last_ts`, follows the threads of new messages and of every
`watched_threads` entry (keeping only replies newer than that thread's
`last_seen_reply_ts`), drops join/leave/system subtypes (counted, not shown), resolves
`<@U…>` to names, and prints:

- a header with counts (new top-level, new replies, noise dropped, watched threads expired);
- **New messages** — chronological, each with its thread's new replies inline;
- **New replies in older threads** — the parent for context, then only the new replies.

Every line carries its time (date too, when it differs from the parent's), author
(`you` = the user), `→you` when the user is mentioned, `[bot]` for bot posts, reactions,
files/canvases (a huddle-notes canvas is called out as `HUDDLE NOTES canvas F…` — see
step 4), and ends in `·ts <ts>`. Permalinks are not printed per line — build them
from the ts with the rule in the header (`p<ts without the dot>`, plus
`?thread_ts=<parent ts>&cid=…` for a reply). `--json` includes them ready-made. A thread that reaches a conclusion ("let's do
X", "agreed", ✅ reactions) is a **decision** even if the parent message is old. Items
belong to the day of their own timestamp, not today.

The script also writes `digests/.state.next.json` — the advanced cursor — and never
touches `.state.json` itself; step 8 promotes it. `--since <date|ts>` overrides the
cursor for a manual backfill (no `.state.next.json` is written then); `--json` gives the
structured form if the transcript is ambiguous.

```json
{ "last_ts": "1724650000.000000",
  "watched_threads": { "<thread_ts>": "<last_seen_reply_ts>" } }
```

If the header says nothing new and there are no threads, this is a no-op run: skip to
step 10.

**4. Triage.** Skip join/leave events, bot noise, CI chatter, pure banter (count them,
don't list them). **Exception — huddle notes.** Slackbot's "A huddle started" / "AI
huddle notes are ready" posts look like bot noise but carry the whole meeting as a
canvas; the transcript flags them as `HUDDLE NOTES canvas F…`. Read the canvas with the
MCP tool `slack_read_file` (ToolSearch it first) and triage its **Summary** and **Action
items** exactly like a thread: each settled point is a decision, each action item naming
`U09R2MYP6A0` is the user's, attendee IDs resolve via `slack_read_user_profile`. Anchor
every item to the huddle's start ts (the parent message) and label it `(AI huddle notes)`
— they are machine-generated from a transcript, so treat internal contradictions as
unverified and say so rather than picking a side. A huddle usually *closes* things the
digest lists as 🟡 In flight or a ticket lists under Pending; say what it closed, and
link the ticket (step 6) so `ticket-pass` folds it in. (Missed once: a 36-minute huddle
that settled the invoice edit lanes and the soft-delete question was dropped as noise.)
Classify the rest:
- **Decisions & conclusions** — anything settled: agreed behavior, chosen approach,
  scope changes, "we'll do X". These are the doc-staleness risk. A message announcing
  a **backend change** (new/changed endpoint, server-side rule change, BE deploy to
  `dev`) counts here too — the docs verify against BE code (`last_verified_be`), so a
  BE-side change is a doc-staleness signal even with no FE work attached.
- **Needs you** — mentions of `U09R2MYP6A0`, questions addressed to the user,
  anything blocking on them.
- **Action items (yours)** — work the user now owns: they explicitly accepted
  ("sure", "I'll do it", "on it") or were directly assigned with no pushback.
  A mention or open question alone is *Needs you*, not an action item.
- **In flight** — active discussions with no conclusion yet (note what's contested).
- **FYI** — releases, announcements, useful links.

**5. Tag doc impact.** For each decision, guess the affected feature(s) from the
folder names under `alden/alden-portal/features/` (e.g. `tasks`, `admin`, `meetings`).
For a backend change that names an endpoint, match the path against the features'
arch.md `## Interfaces & Contracts` sections (or manifest aliases) to find the owning
feature — folder names alone won't map a BE-only change. Tag inline as `[tasks]`. If
none fits, tag `[unmapped]`. This is a hint for the end-of-day pass, not a commitment.

**6. Link, don't file.** For each 🔴 / ✋ / 🟠 item, check whether its thread names or
clearly concerns an open Liamai ticket (`list_issues`, team `Liamai`, by key if the
thread typed one, else by keywords) and, if so, link it inline as `([LIA-xx](url))`.
That link is the signal the sweep's `ticket-pass` worker uses to **fold** the thread's
outcome into the ticket instead of filing a duplicate; an unlinked ✋ item is what it
files a new ticket from. Everything that touches Linear happens there, under the
sweep's Autonomy policy — never here: no filing, no `patch`, no comments, no labels.
The digest holds the narrative; the ticket body is edited by a worker that has read
the ticket and the docs, not the transcript.

Two writing rules that make the fold possible:

- **Say what changed for the ticket, in the item.** "Answers LIA-61's open payload
  question: the boolean survives, no `type` enum" gives ticket-pass a fact to rewrite a
  sentence with; "discussed the payload" gives it nothing.
- **A thread's technical claims are claims, not facts** — a confirmed-on-Slack backend
  change has shipped late or never before. Either write it as a claim ("Sam says it
  works") or verify it against a pinned ref (`origin/dev@<sha>`, the FE's generated
  client) and say which. Never let a thread alone promote an endpoint, field or file
  into a fact.

**7. Merge into today's digest.** File `digests/YYYY-MM-DD.md`. Create from this
skeleton if absent, else merge new activity into the existing headings, ordered by
each item's original timestamp.

**An item states its thread's current state, not its history.** When a thread moves
on, *rewrite the item in place* so it still reads as one current summary — never
append a `→ HH:MM, …` update underneath it. Stacked updates are what turned the
2026-09-01 digest into 8,809 words over 58 messages: an item that changed four times
carried all four states, and the reader had to reconstruct the present from a
transcript. The digest file is committed on every run, so `git log -p digests/`
already holds the evolution — inline history buys nothing and costs the whole page.
Same rule the tickets follow (`skills/linear-ticket`, "the ticket is the current task,
not its history").

Rewriting is not deleting. An item is never dropped once filed, and a resolved one
stays put — it just states its outcome in its own sentence ("merged 12:32 as fe#379")
instead of growing a tail. Two things survive every rewrite verbatim: an item's
original `HH:MM ·` stamp, and the ` → LIA-xx` ticket marker described below.

**An item is one headline and at most one detail line.** The headline is the
conclusion in ≤ 12 words, bold, first — the reader scans headlines and only drops into
a detail line when they need the fact behind it:

```markdown
- **<headline: what was decided / what they need / where it stands>** — HH:MM · <author> [feature] [thread](permalink)
  <detail, ≤ 30 words: the one fact that makes the headline actionable>
```

The stamp, tag, ticket link `([LIA-xx](url))` and ` → LIA-xx` marker all live on the
headline line, after the headline; the detail line carries none of them. A 🟠 headline
names the ask, not the topic ("Billing Entity Name should render `legalName`", not
"Entity Billing page"). A ✋ headline is the deliverable, with its deadline if stated.

**One ✋ bullet per deliverable.** A thread in which the user accepted several independent
asks at once (a numbered list of fixes) yields one bullet per ask, in the thread's order,
each anchored to the same permalink — `ticket-pass` files one ticket per bullet
(linear-ticket's granularity rule, both directions) and the ` → LIA-xx` marker is per
line, so a bundled headline would turn five deliverables into one ticket that the one
unclear ask keeps off the cockpit's Send button. An ask the thread or a journal entry
says already landed is not an action item: name the PR in a sibling's detail line
instead of giving it a bullet.

**A section with no items is omitted from the file**, not printed empty; add its
heading back, in skeleton order, when its first item arrives.

```markdown
# #dev-team digest — YYYY-MM-DD

_Last updated: HH:MM. N messages scanned today, M skipped as noise._

## 🔴 Decisions & conclusions
- **<what was decided>** — HH:MM · <author> [feature-tag] [thread](permalink)
  <why, or what it replaces>

## ✋ Your action items
- **<the deliverable, deadline if stated>** — HH:MM ([LIA-xx](linear-url) when it concerns an open ticket — step 6) [thread](permalink)

## 🟠 Needs you
- **<what they need from you>** — HH:MM · <author> [feature-tag] [message](permalink)
  <the one fact behind the ask>

## 🟡 In flight
- **<topic: where it stands>** — HH:MM [thread](permalink)
  <who disagrees about what>

## ⚪ FYI
- **<summary>** — HH:MM · <author> [message](permalink)

## End of day → docs
_🔴 items go through `/log-change`; ✋ items through the sweep's ticket-pass; a decision with no code yet is journaled as `status: decided` (sweep step 5b)._

**Outstanding**
- <one bullet per 🔴 / 🟠 item not yet journaled or verified, ≤ 25 words: what to do with it>
```

Empty sections are omitted (rule above); the skeleton shows every heading only to fix
their order. The End-of-day line is a pointer, not the rule — the rules live in
`/log-change` and sweep step 5b, one copy each.

Permalinks: `https://alden-studios.slack.com/archives/C07KG06L601/p<ts-with-dot-removed>`
(e.g. ts `1724650000.123456` → `p1724650000123456`). For a thread reply, link the
parent thread by appending `?thread_ts=<parent_ts>&cid=C07KG06L601` to the reply link.
Prefer results' provided permalinks when the API returns them.

The sweep's `ticket-pass` appends ` → LIA-xx` to a ✋ line when it files a ticket from
it; never remove or rewrite that marker — it is what keeps the item from being filed
twice.

Summaries are the product: write what was concluded, not "there was a discussion
about X". The user should be able to skip opening Slack entirely unless they want the
detail. Update the `_Last updated_` line and counters each run.

**Length is a hard constraint, not a preference.** A digest longer than the Slack it
summarizes has failed at its only job. Budget **≤ 40 words per item** and **≤ 1,500
words for a full day** — for calibration, 2026-08-26 came in at 550 words and
2026-08-28 at 1,280, while 2026-09-01 hit 8,809 and had to be rewritten. An item past
~80 words is nearly always carrying one of three things that belong elsewhere:
history (see the current-state rule above), code you verified (the journal entry or
the arch doc owns that), or ticket scope (the ticket owns that). Link to them; do not
restate them. If a day genuinely earns more words, it is because more happened — not
because each item got longer.

**8. Save state.** Promote the cursor the script prepared: read
`digests/.state.next.json`, write it to `digests/.state.json`, and delete
`.state.next.json`. Do this only after the
digest file is written — a run that dies before this point replays on the next tick
instead of losing messages. Never hand-edit `last_ts`.

**9. Commit.** Every run that changed a digest file must end with a commit, so the
history is a clear record of what each run added:
- Stage only digest markdown: `git add digests/*.md`. Never stage `.state.json`
  (it is gitignored local state) or unrelated working-tree changes.
- Commit message: `slack-digest: YYYY-MM-DD HH:MM — <n> new items (<x> decisions, <y> action items)`,
  dropping the parenthetical when both are zero. If the run touched more than one
  day's file (day rollover), say so in the message.
- If `git diff --cached` is empty (a true no-op run — no new messages), skip the
  commit; do not create empty commits.
- Commit only — never push unless the user asks.

**10. Report.** One or two lines to the user: how many new items, and lead with any
🔴/🟠 item. If nothing new: say so in one line — that is a no-op run.

## Notes
- Read-only with respect to Slack: never post, react, or mark anything.
- If the day rolled over since the last run (state's newest ts is from yesterday),
  finish writing items to their own day's file — items belong to the day of their ts.
- Digest files are committed by step 9 on every run that changes them; `.state.json`
  is disposable local state and stays out of git (it is in `.gitignore`).
