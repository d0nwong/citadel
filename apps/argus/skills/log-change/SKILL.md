---
name: log-change
description: Record a change to alden-portal in the change journal — one entry per landing on staging (a merged PR, or a push straight to staging), carrying the ticket, the reasoning, and the command that retrieves the diff — and drive the doc update once the code has landed. Use when a decision is made, a PR merges, business logic changes, or the user says "log this change / journal this / this was decided".
---

# log-change — journal a landing, close the loop to the docs

The journal is the "why" layer (protocol Phase 5 — `skills/feature-docs/DOC-PROTOCOL.md`):
docs stay present-tense facts-from-code; entries own history, rationale, source, ticket.
**Never write a change's history into the docs, and never restate current behavior in an
entry** — they link, they don't merge.

**The unit is one landing on staging**, not one commit and not one day: a merged PR, or a
commit pushed straight to `staging`. That is the only object Linear, Bitbucket and staging
all agree on, so it is what a ticket, a PR review and a deploy can all be traced through.
A day-scoped entry cannot carry a ticket honestly — one day is several PRs and several
tickets, and the entry ends up labelled with whichever one was biggest.

Entries live with the feature they are about:
`alden/alden-portal/features/<dir>/journal/YYYY-MM/YYYY-MM-DD/YYYY-MM-DD-<key>-<slug>.md`
(entries group into month, then day directories — presentation only; the filename keeps the
full date so links and sorting never depend on the folder), where `<key>` is
`fe363` / `be735` for a PR and the short sha for a direct push. `<dir>` is the feature's
folder under `features/` — the same one holding its `docs/`.

## What an entry is for

A future session greps `pr:` / `ticket:` / `features:`, reads twenty lines, and either has
its answer or knows the exact command that will produce it. So an entry records **what git
cannot answer** — who asked, what was decided, the judgement calls taken silently at
implementation time, the gotcha that outlives the PR — and points at git for the rest.
Narrating what the code does is dead weight: `git diff` re-derives it perfectly, forever.

## Procedure

**1. Resolve the landing.** Never hand-assemble this from commits:

```sh
bun skills/log-change/scripts/pr-facts.ts 363          # a PR number (frontend)
bun skills/log-change/scripts/pr-facts.ts 735 --be     # backend PR (lands on origin/dev)
bun skills/log-change/scripts/pr-facts.ts 6a1562a16    # which landing carried this commit?
bun skills/log-change/scripts/pr-facts.ts --since 2026-08-27   # what landed, and what is unjournaled
```

It resolves against `origin/<ref>` (fetching first), and prints the merge sha, the merged
date, the ticket keys stated in the branch and commit messages, the features the changed
files map to, the commit list, and a ready-made frontmatter block. Attribution works in
both repos: FE files through the accio index; BE files through the manifest's curated
`be_files`, plus — for a landing that adds, removes or moves a route line in
`src/routers/v1/` — the endpoint itself and the features the index says call it (an
`endpoints touched` block; "not in the spec" there means a new route or a spec not yet
re-synced). `--since` is the end-of-day sweep: anything marked `NOT JOURNALED` is a
landing with no entry, and gets a `features:` line naming where it would route.

**2. Confirm the ticket.** The keys `pr-facts` reports are the ones someone *typed* — most
commits state none, and a branch name like `foundry/does-this-match-1cc8974d` states
nothing. Check Linear (team `Liamai`) for an issue matching the change and use its key;
`ticket:` takes a list when one landing closes or advances several. `null` is honest for
untracked work — an audit nag, not an error. **A ticket the landing implements but does not
close stays open; say so under `## Watch out` rather than assuming a merge means done.**

**2b. Close the loop to any earlier decision.** Before writing an `implemented` entry,
grep `features/*/journal/` for open `decided` entries carrying the same ticket or the same
features (`grep -rl 'status: decided' alden/alden-portal/features/*/journal/ alden/alden-portal/features/*/*/journal/`
— both globs: nested features keep their journal a level deeper). On a hit:
the new entry links the decision (`[[its-name]]`, plus its ticket in `ticket:`), and the
decided entry flips to `status: superseded` — the one field allowed to change. A landing
journaled without this check is how the journal ends up with two disconnected entries
about the same change; `accio audit` flags the dangle, but catching it here is cheaper.

**3. Collect what git can't tell you** (ask only for what's missing; don't interrogate):

- `source` — Slack thread, meeting, customer, or null. A permalink beats a paraphrase.
- the decision and who made it — quote the request where it disambiguates intent
- judgement calls the implementer took that nobody ratified — these exist nowhere else
- `features` — manifest ids (`alden/alden-portal/.doc-workspace/feature-manifest.json`);
  `pr-facts` proposes them from the diff, but it counts files, so it over-names features
  the change merely grazed. Name what the change is ABOUT. `bun run accio "<words>"` when
  unsure.
- `scope` — product | architecture | both

**4. Write the entry:**

```markdown
---
date: 2026-08-28 # the day it landed on staging
pr: fe#363 # fe#N | be#N | direct | null (decided, not yet in code)
url: https://bitbucket.org/aldenstudios/alden-portal-fe/pull-requests/363
merge: 597bfbdf3 # the staging commit; diff = 597bfbdf3^1..597bfbdf3
ticket: [LIA-48] # Linear keys / Trello links, or null
features: [admin-invoicings] # manifest ids, FLOW style — greppable routing
scope: both # product | architecture | both
status: implemented # decided | implemented | documented | superseded
hold: "the BE half never shipped" # optional — parks the entry open, with a reason
affects: [BR-21, BR-22h] # optional — documented rule / mismatch ids this change rewrites (read them off product.md / arch.md)
summary: Draft-invoice lines edit by credits or by amount, and the save sends the whole project array
---

## What landed

- Bullets, one per user-visible change, each naming the files it touched.
- No narration of how the code works — the `merge:` sha is right there.

## Why

Only what code cannot say: the decision, who asked, the constraint behind it, and the
judgement calls taken at implementation time that no one ratified.

## Watch out

Gotchas that outlive the PR: a half that did not ship, a contract the server does not
honour, drive-by commits riding the same branch, a ticket still open after the merge.
Omit the heading when there is nothing.

_Detail: `git -C ~/git/alden-portal-fe diff 597bfbdf3^1..597bfbdf3` · `bb pr-details show 363`_
```

**5. Determine status** (this decides everything downstream):

- change NOT in code yet (FE or BE) → `status: decided`, `pr: null`. Write the entry **now,
  at decision time** — a decision that changes a documented rule is journaled the day it
  is made, not the day code appears; fill `affects:` with the rule ids it will rewrite.
  STOP — the docs' rules are not touched (facts-only rule), but the next `accio sync`
  lists the entry in that product doc's "Decided, not yet landed" region, which is how the
  decision becomes visible beside the rules it will change. The entry is the record of
  intent until code lands; when it does, a NEW entry records the landing, links back to
  this one, and this one flips to `status: superseded` (step 2b) — and drops out of the
  region on its own. A decision parked deliberately gets a
  `hold:`; one left open with neither nags after two weeks — that is the audit telling you
  it may have shipped without you noticing.
- landed (FE or BE) → `status: implemented`, continue to step 6. A backend-only landing
  counts: the `stale` check diffs FE code only, so this entry is what flags the feature for
  a re-run with backend verification.
- landed but deliberately parked open — the FE half shipped and the BE half didn't, the
  behaviour is confirmed nowhere yet — → add `hold: "<what it is waiting for>"`. The entry
  stays `implemented` and stops nagging the refresh loop until the hold is removed. Without
  it an entry that can never close nags forever, and everyone learns to ignore the audit.

**6. Update docs when code has landed:** run the `/feature-docs` procedure for each
affected feature, passing this entry (and any other open entries for the feature) to the
doc subagent as diff context. When the agent confirms the change in code and the docs are
regenerated, flip the entry to `status: documented`.

> **Resolve the refs before briefing any subagent.** `git pull`
> `~/git/alden-connect-portal-be` every time and pin its sha; for the shared FE tree
> resolve `origin/<branch>` rather than pulling. Never hand a subagent a base ref you read
> off a local branch or a working tree — both go stale silently (BE by weeks), and a stale
> read invents missing endpoints rather than erroring. If the user pulls mid-run, re-resolve
> everything: it can flip "not in staging yet" work into staging and invalidate
> `last_verified` stamps already written. Details in `skills/feature-docs/SKILL.md` step 1.

**7. Verify:** `bun run accio audit` must be clean (it validates entry frontmatter, feature
ids, ticket and PR format, and flags implemented entries the refresh loop missed).

## Rules that keep the journal useful

- **One landing per entry.** A PR that touches three features is still ONE entry with three
  ids in `features:` — never three copies. Two PRs are two entries even when they finish
  the same ticket.
- **A PR carries work that is not its own.** `fe#363` shipped the invoice editor and also a
  project-tasks sort fix that happened to be on the branch. Name the drive-by under
  `## Watch out`; do not let it into `summary:` or `ticket:`.
- **The folder is where it lives; `features:` is what routes it.** File a multi-feature
  entry under the feature it is mostly about, and name every affected feature in
  `features:` — including the folder's own id, or audit flags it. The other features find
  it by that list, not by the path.
- `features:` and `ticket:` use FLOW style (`[a, b]`) — block style breaks grep routing.
- **`pr: direct` is a finding, not a formality.** Work reaching staging without a PR skipped
  CI; the entry is the record of that. Keep `merge:` so the diff is still one command away.
- After creation, only `status` may change. Corrections get a new entry that references the
  old one. Statuses move forward only: `decided → superseded` (a landing entry took over)
  or `implemented → documented`; `superseded` and `documented` are terminal.
- **Never guess to fill frontmatter.** A wrong ticket key silently misroutes every future
  grep; `ticket: null` / `source: null` is recoverable, a plausible-looking guess is not.
  This matters most when running unattended under `/sweep` with nobody to ask.
- Keep it short. If an entry needs a fourth section, it is probably narrating the diff.
