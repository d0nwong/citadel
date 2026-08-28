---
name: slack-digest
description: Incrementally digest #dev-team Slack activity into a daily markdown file (digests/YYYY-MM-DD.md) with permalinks, so a part-time teammate can catch up on decisions they missed. Designed to run hourly via /loop. Use when asked to digest the dev channel, catch up on Slack, or when invoked as /slack-digest.
---

# slack-digest — hourly catch-up digest for #dev-team

Purpose: the user is part-time and misses decisions made in Slack, which makes the
dual-tier feature docs (`alden/alden-portal/features/*/docs/`) go stale. Each run reads
only the messages that arrived since the last run and merges them into today's digest
file. At the end of the day the user reads the digest and picks items to push through
`/log-change` / `/feature-docs`.

Constants:
- Channel: **#dev-team**, id `C07KG06L601`, workspace `alden-studios.slack.com`
- The user is `U09R2MYP6A0` (Liam / yickkiu)
- Linear: team **Liamai** (key `LIA`), assignee `me`
- State file: `digests/.state.json`
- Digest file: `digests/YYYY-MM-DD.md` (local date, one per day)

If the Slack MCP tools (`mcp__plugin_slack_slack__*`) are deferred, load them with
ToolSearch first: `slack_read_channel`, `slack_read_thread`. Same for the Linear
tools when there are action items: `mcp__linear-server__list_issues`,
`mcp__linear-server__save_issue`.

## Procedure

**1. Load state.** Read `digests/.state.json`:
```json
{ "last_ts": "1724650000.000000",
  "watched_threads": { "<thread_ts>": "<last_seen_reply_ts>" },
  "action_items": { "<thread_ts>": "<LIA-xx>" } }
```
If missing, set `last_ts` to 24 hours ago (unix seconds is fine) and `watched_threads`
to `{}` — the first run backfills the last day.

**2. Fetch new messages.** `slack_read_channel` on `C07KG06L601` with
`oldest = last_ts`. Paginate if needed. Discard anything with `ts <= last_ts`
(oldest is inclusive — dedupe by ts, never re-report an item).

**3. Follow threads.** Two sources:
- new messages from step 2 that have replies → read their thread;
- every entry in `watched_threads` → `slack_read_thread`, keep only replies newer
  than its `last_seen_reply_ts`.
Threads with recent activity stay in `watched_threads`; drop a thread once it has had
no new replies for 48h. A thread that reaches a conclusion ("let's do X", "agreed",
"decided", ✅ reactions) is a **decision** even if the parent message is old.

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
- Otherwise `save_issue`: `team: "Liamai"`, `assignee: "me"`, a verb-first title
  (e.g. "Split invoice by project — UI"), description = what/why in 2-4 lines,
  the concrete endpoints or artifacts named in the thread, and the Slack
  permalink. Set `dueDate`/`priority` only when the thread states a deadline or
  urgency. Relate to overlapping issues via `relatedTo`.
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

**8. Save state.** Write `.state.json` with the newest `ts` seen (channel messages
and thread replies both count), the updated `watched_threads`, and `action_items`.

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
