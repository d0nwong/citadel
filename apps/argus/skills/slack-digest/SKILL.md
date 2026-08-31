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
the digest *file* and drives `/log-change` / `/feature-docs` itself. A standalone run or
an hourly `/loop` is also fine — the digest is incremental and catch-up-safe either way,
and a sweep after a gap simply backfills. Without a sweep, the end-of-day pass falls to
the user reading the digest and pushing 🔴 items through `/log-change` by hand.

Constants:
- Channel: **#dev-team**, id `C07KG06L601`, workspace `alden-studios.slack.com`
- The user is `U09R2MYP6A0` (Liam / yickkiu)
- Linear: team **Liamai** (key `LIA`), assignee `me`
- State file: `digests/.state.json`
- Digest file: `digests/YYYY-MM-DD.md` (local date, one per day)

Slack is read by a script, not by MCP tools: `scripts/slack-pull.ts` does the cursor
bookkeeping, pagination, thread following, user-id resolution and noise filtering, and
prints one compact transcript. It needs `SLACK_TOKEN` in `.env` (gitignored; Bun loads
it). Fall back to the MCP tools (`slack_read_channel`, `slack_read_thread`, ToolSearch
them first) only if the script cannot run — and say so in the report.
If the Linear tools are deferred when there are action items, ToolSearch
`mcp__linear-server__list_issues`, `mcp__linear-server__save_issue`.

## Run it in a subagent

The thread transcripts this skill reads are bulky and single-use — they belong in a
subagent's context, not in the session the user is working in.

**If you are the main session**, don't run the procedure yourself. Spawn ONE
general-purpose subagent via the Agent tool with **`model: "opus"`** — the triage in
step 4 and the Linear writes in step 6 are judgement calls and a weaker model files worse
tickets. The override is deliberate: the sweep loop runs on Sonnet (`bun run sweep`) so
the scheduler is cheap, and every worker that writes pins the judgement tier itself
rather than inheriting whatever the session happens to be on. Give it this task:

> Invoke the `slack-digest` skill and follow it to completion. You ARE the subagent for
> this run: execute the procedure directly, starting at step 1. The working directory is
> the `ai-workspace` repo. Report back the number of new items, every decision / action
> item / needs-you item with its Linear key, and the commit sha — or "no-op, nothing new".

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

Every line carries `YYYY-MM-DD HH:MM`, author (`you` = the user), `→you` when the user
is mentioned, `[bot]` for bot posts, reactions, files/canvases, and the permalink
(reply links already carry `thread_ts`). A thread that reaches a conclusion ("let's do
X", "agreed", ✅ reactions) is a **decision** even if the parent message is old. Items
belong to the day of their own timestamp, not today.

The script also writes `digests/.state.next.json` — the advanced cursor — and never
touches `.state.json` itself; step 8 promotes it. `--since <date|ts>` overrides the
cursor for a manual backfill (no `.state.next.json` is written then); `--json` gives the
structured form if the transcript is ambiguous.

```json
{ "last_ts": "1724650000.000000",
  "watched_threads": { "<thread_ts>": "<last_seen_reply_ts>" },
  "action_items": { "<thread_ts>": "<LIA-xx>" } }
```

If the header says nothing new and there are no threads, this is a no-op run: skip to
step 10.

**4. Triage.** Skip join/leave events, bot noise, CI chatter, pure banter (count them,
don't list them). Classify the rest:
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

**6. File action items in Linear.** For each **new** action item of the user's:
- Dedupe first: skip if its thread ts is already in state's `action_items`; then
  `list_issues` (team `Liamai`, query by keywords) — if an existing open issue
  covers it, **update** that issue (append the new Slack permalink / scope via
  `patch`) instead of creating a duplicate.
- Otherwise write the ticket **grounded, not transcribed** — a thread's technical
  claims are claims, not facts (a confirmed-on-Slack backend change has shipped late
  or never before). Follow `skills/linear-ticket/SKILL.md` steps 2–3 scaled to this
  run: read the affected feature's `product.md` + `arch.md` (the step-5 tag names the
  feature), and let every endpoint, field, file or function the ticket asserts come
  from those docs or a pinned code read — never from the thread alone. A thread claim
  you cannot verify goes under **Pending** as an open question ("thread says the PUT
  becomes full-replace — unverified against `origin/dev`"), never as a fact. Running
  unattended changes two things from that skill: never pause to ask (filing the
  user's action items is pre-authorized), and prefer an honest Pending bullet over
  any research detour longer than the docs + one code read.
- Then `save_issue`: `team: "Liamai"`, `assignee: "me"`, a verb-first title
  (e.g. "Split invoice by project — UI"), description in the house format
  (Summary / Background with the Slack permalink / Scope / Pending when needed /
  Technical Notes). Set `dueDate`/`priority` only when the thread states a deadline
  or urgency. Relate to overlapping issues via `relatedTo`.
- Record in state: `action_items: { "<thread_ts>": "<LIA-xx>" }`. Never create a
  ticket twice for the same thread; new scope in an old thread updates its ticket.

**7. Merge into today's digest.** File `digests/YYYY-MM-DD.md`. Create from this
skeleton if absent, else insert new items under the existing headings (append within
a section, keep chronological order; never rewrite or delete earlier items):

```markdown
# #dev-team digest — YYYY-MM-DD

_Last updated: HH:MM. N messages scanned today, M skipped as noise._

## 🔴 Decisions & conclusions
- **HH:MM · <author>** [feature-tag] One-two sentence summary of what was decided and why. [thread](permalink)

## ✋ Your action items
- **HH:MM** What you're on the hook for, and any stated deadline. ([LIA-xx](linear-url)) [thread](permalink)

## 🟠 Needs you
- **HH:MM · <author>** What they need from you. [message](permalink)

## 🟡 In flight
- **HH:MM · <topic>** Where the discussion stands, who disagrees about what. [thread](permalink)

## ⚪ FYI
- **HH:MM · <author>** Summary. [message](permalink)

## End of day → docs
_Filled by the evening pass: for each 🔴 item, run `/log-change` (journal + doc update) or note "no doc impact". BE-side changes go through `/log-change` like FE ones — the journal entry is what flags the feature for regeneration (the automatic `stale` check diffs FE code only); regeneration then re-verifies against fresh `origin/dev` and bumps `last_verified_be`._
```

Permalinks: `https://alden-studios.slack.com/archives/C07KG06L601/p<ts-with-dot-removed>`
(e.g. ts `1724650000.123456` → `p1724650000123456`). For a thread reply, link the
parent thread by appending `?thread_ts=<parent_ts>&cid=C07KG06L601` to the reply link.
Prefer results' provided permalinks when the API returns them.

Summaries are the product: write what was concluded, not "there was a discussion
about X". The user should be able to skip opening Slack entirely unless they want the
detail. Update the `_Last updated_` line and counters each run.

**8. Save state.** Promote the cursor the script prepared: read
`digests/.state.next.json`, merge in the `action_items` you added in step 6, write the
result to `digests/.state.json`, and delete `.state.next.json`. Do this only after the
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
