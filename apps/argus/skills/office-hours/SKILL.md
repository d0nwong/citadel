---
name: office-hours
description: Scan a list of GitHub repos for open PRs that are NOT authored by you (bots excluded) and have new commits, review each with /agent-skill:review, and produce one interactive HTML triage report per PR plus an index page listing every reviewed PR. The reviews run unattended in a batch; you go through the reports later and, per PR, approve or reject each comment before it is posted via gh. Use whenever the user invokes /office-hours, asks to batch-review open PRs across one or more repos, wants to "run the review loop", or wants to triage AI review comments before they land on GitHub.
---

# office-hours — PR review triage loop

Across a list of repos, review every open PR that was **not authored by you** and is **not a bot's** and has new commits. Reviews run as an unattended **batch**: each PR gets its own triage report, and a single **index page** links them all so you can work through them whenever you want. Nothing reaches GitHub until you triage a report and explicitly approve its comments.

## The flow

```
resolve repo list (args / config) ──► resolve your login (@me)
 build the queue: for each repo gh pr list --repo
   filter: not you, not a bot, new commits since last review (state file)
 write empty manifest ──► generate_index.py ──► serve.sh ──► open http://localhost:54321/
 PHASE A — review ONE PR AT A TIME (incremental):
   for each qualifying PR, in sequence:
     ensure checkout ──► gh pr view/diff ──► /agent-skill:review ──► normalize to comments.json
     scripts/generate_report.py ──► report.html
     append manifest entry ──► REGENERATE index.html ──► notify.sh "review ready"
     mark PR reviewed in state file
   (the served index grows 1…2…3…N; user refreshes and gets a desktop ping each time)
 PHASE B — triage, post & approve (later, per PR, user-driven from the report):
   read recommendation ──► check/edit comments ──► click Post selected / Approve PR
   (UI + server mechanics live in README.md; Claude only acts if asked to post/approve)
```

Reports and the index are **served over HTTP** (default `http://localhost:54321/`), not opened as `file://`. The server is started once, the index opened once, then the index is **regenerated after every PR** so its list grows one row at a time — and each finished review fires a **desktop notification** so you don't have to watch the page. Review PRs sequentially: each review appears (and pings) before the next one starts.

## Prerequisites

- `gh` CLI authenticated with access to every repo in the list (`gh auth status`).
- The `/agent-skill:review` skill available (it does the actual reviewing; this skill is the harness around it).
- A local checkout for each repo so the review skill can read code (see Step 0). If a repo has no checkout and can't be cloned, skip it and tell the user rather than reviewing blind.

If any of these are missing, say so and stop rather than improvising.

## Step 0 — Resolve the repo list and your identity

**Repo list.** The set of repos to scan comes from, in order of precedence:

1. Repos passed when the skill is invoked (e.g. `/office-hours screencloud/studio screencloud/api`) — accept space- or comma-separated `owner/repo` slugs.
2. The user's personal repo list at `~/.config/office-hours/repos.txt` (one `owner/repo` per line; blank lines and `#` comments ignored). **This is the default place to define the repos to scan**, and it works no matter which directory the skill is run from.
3. If that file is missing or empty, ask the user which repos to scan and offer to write them into `~/.config/office-hours/repos.txt` for next time.

Normalize each entry to a bare `owner/repo` slug. Echo the resolved list back to the user before scanning.

**Your identity.** Resolve the login to exclude once, up front:

```bash
gh api user --jq .login
```

Call this `ME`. Every PR whose `author.login == ME` is skipped — this loop reviews **other people's** PRs, never your own.

**Checkout per repo.** The review skill needs the code, not just the diff. For each repo, resolve a working copy:

```bash
# if already inside/near it, reuse; otherwise clone shallow into the work dir
gh repo clone <owner/repo> /tmp/office-hours/repos/<repo> -- --depth 50 2>/dev/null || true
```

Later, before reviewing a PR, check out its head there with `gh pr checkout <N> --repo <owner/repo>` (run from that checkout). If a repo can't be cloned, note it and move on.

## Step 1 — Find PRs that need review

Loop over the resolved repo list. For each repo:

```bash
gh pr list --repo <owner/repo> --state open \
  --json number,title,author,headRefName,baseRefName,headRefOid,url,updatedAt,isDraft
```

Drop two classes of PR before anything else:

- **Your own** — `author.login == ME`.
- **Bots** — `author.is_bot == true`, OR the login looks like a bot: ends with `-bot` or `[bot]`, or starts with `app/` (catches `dependabot[bot]`, `renovate[bot]`, `screencloud-bot`, `app/github-actions`, etc.). Bot PRs are auto-generated dependency/version bumps that don't benefit from an AI code review.

Of what remains, a PR needs review when its `headRefOid` differs from the `last_reviewed_sha` recorded for `<owner/repo>#<number>` (or it has no entry). Drafts are skipped by default (see Judgment calls).

Keep a running note of what you dropped in each bucket (`mine`, `bots`, `drafts`) — the index page (Step 5) surfaces these so the user can see nothing was silently ignored.

Load the state file at `.git/office-hours-state.json` (inside `.git/` so it never gets committed). Schema — keyed by repo, then PR number, so numbers can't collide across repos:

```json
{
  "repos": {
    "screencloud/studio": {
      "123": {
        "last_reviewed_sha": "abc123...",
        "reviewed_at": "2026-07-20T09:00:00Z"
      }
    }
  }
}
```

Tell the user the combined queue before reviewing — e.g. "2 repos: screencloud/studio #123, #130 and screencloud/api #8 need review (3 total). Excluded 4 of your own, 2 bots, 1 draft."

Then **bring up the board once, up front**: write an empty manifest (with the `skipped` buckets), generate the index, start the server, and open it. From here on the same URL stays open and just grows.

```bash
echo '{"me":"<ME>","prs":[],"skipped":{"mine":[...],"bots":[...],"drafts":[...]}}' \
  > /tmp/office-hours/manifest.json
python <skill-path>/scripts/generate_index.py --manifest /tmp/office-hours/manifest.json \
  --output /tmp/office-hours/index.html
bash <skill-path>/scripts/serve.sh 54321 /tmp/office-hours   # idempotent; default port 54321
open http://localhost:54321/
```

Now review the queue **one PR at a time** (Steps 2–4). Each finished review is appended to the manifest, the index is regenerated, and a desktop notification fires — so the served page grows 1…2…3…N and the user is pinged each time. Triage/posting happens later, per PR, off that page (Phase B).

## Step 2 — Review one PR

Work per PR in a repo-namespaced temp dir — `/tmp/office-hours/<owner>/<repo>/pr<N>/` — so PRs with the same number in different repos don't clobber each other. Check out the PR head in that repo's working copy first, then gather context and hand off to the review skill:

```bash
gh pr checkout <N> --repo <owner/repo>   # run from that repo's checkout
gh pr view <N> --repo <owner/repo> --json number,title,body,author,headRefName,baseRefName,headRefOid,url > /tmp/office-hours/<owner>/<repo>/pr<N>/meta-raw.json
gh pr diff <N> --repo <owner/repo> > /tmp/office-hours/<owner>/<repo>/pr.diff
```

Then invoke `/agent-skill:review` on this PR, following that skill's own instructions. Give it the diff, the PR description, and access to that repo's checkout. Capture two things from its output: the per-finding comments (Step 3) **and** its overall verdict — an `approve | request_changes | comment` recommendation plus a one-paragraph summary — which go into `meta.json` (Step 4) and surface as the report's recommendation banner.

## Step 3 — Normalize findings into comments.json

Whatever format the review skill produces, convert every finding into this schema (this is what the report generator consumes). Write it to `/tmp/office-hours/<owner>/<repo>/pr<N>/comments.json`:

```json
[
  {
    "id": "c1",
    "path": "src/auth/verify.ts",
    "line": 42,
    "side": "RIGHT",
    "start_line": null,
    "severity": "warning",
    "title": "Token expiry not checked",
    "body": "The decoded JWT is trusted without checking `exp`. Expired tokens will pass verification."
  }
]
```

Rules that matter:

- **Anchor to a line that appears in the diff.** GitHub's API rejects (422) inline comments on lines outside the diff. If a finding concerns untouched code, set `"path": null` and `"line": null` — the report shows it as a PR-level comment and it gets posted with `gh pr comment` instead, with a `file:line` reference in the body.
- `side` is `"RIGHT"` for added/context lines (new file version), `"LEFT"` for deleted lines. Almost everything is RIGHT.
- `start_line` (optional) makes it a multi-line comment ending at `line`.
- `severity` is one of `critical | warning | suggestion | nit`. Map the review skill's own scale onto these; when in doubt, round down — inflated severities erode trust in the report.
- `body` is what will literally be posted to GitHub (markdown). Keep it self-contained; the reviewer on GitHub won't see the report context.
- Give ids `c1, c2, ...` in file order.

If the review found nothing worth commenting, still generate the report (it will say "no findings") so the user gets a consistent record, then mark the PR reviewed.

## Step 4 — Generate the report, publish it to the board, notify, mark reviewed

Generate the per-PR report. Don't `open` the individual report file — it's reachable from the already-open index; your job is to refresh the board and ping the user.

```bash
python <skill-path>/scripts/generate_report.py \
  --comments /tmp/office-hours/<owner>/<repo>/pr<N>/comments.json \
  --diff /tmp/office-hours/<owner>/<repo>/pr.diff \
  --meta /tmp/office-hours/<owner>/<repo>/pr<N>/meta.json \
  --output /tmp/office-hours/<owner>/<repo>/pr<N>/report.html
```

`meta.json` is a trimmed version of the `gh pr view` output plus the repo slug and the review skill's overall verdict:

```json
{
  "repo": "screencloud/studio",
  "number": 123,
  "title": "...",
  "author": "liam",
  "head_ref": "feat/x",
  "base_ref": "main",
  "head_sha": "abc123...",
  "url": "https://github.com/...",
  "recommendation": "request_changes",
  "summary": "One-paragraph verdict from /agent-skills:review — what's solid and the single thing that must change."
}
```

`recommendation` is `approve | request_changes | comment` and `summary` is the review skill's overall verdict; both come straight from `/agent-skills:review` (Step 2). The report renders them as a banner at the top so the human sees the recommendation before triaging individual comments. `url` powers the report's title link and "Approve PR" button — always include it.

The script extracts the diff hunk around each comment's anchor line itself — don't paste code snippets into comments.json.

Then do these before moving to the next PR:

1. **Append a manifest entry** to `/tmp/office-hours/manifest.json` (`prs` array). The `report` field is the path *relative to* `/tmp/office-hours/` so it resolves under the served root:

   ```json
   {
     "repo": "screencloud/studio", "number": 123,
     "title": "...", "author": "view-screencloud",
     "url": "https://github.com/...",
     "report": "screencloud/studio/pr123/report.html",
     "counts": {"critical": 0, "warning": 2, "suggestion": 1, "nit": 0}
   }
   ```

2. **Regenerate the index** so the served board picks up this row (the server is already running; no need to restart it):

   ```bash
   python <skill-path>/scripts/generate_index.py \
     --manifest /tmp/office-hours/manifest.json --output /tmp/office-hours/index.html
   ```

3. **Notify** that the review is ready (keep the message quote-free):

   ```bash
   bash <skill-path>/scripts/notify.sh "office-hours" \
     "Review ready: <repo>#<N> — <C> critical, <W> warning, <S> suggestion"
   ```

4. **Mark the PR reviewed** in `.git/office-hours-state.json` under `repos["<owner/repo>"]["<number>"]` with its current `headRefOid` as `last_reviewed_sha`. The unit of work is "report generated", so state advances here — a PR with no new commits won't be re-reviewed next run, but its report still lives on the board. (Posting happens later in Phase B and does **not** affect state.) If the review or report generation crashes for a PR, leave its state untouched so it's retried next run.

When the queue is finished, give a one-line run summary (N reviewed, findings by severity, the served URL). The board is already up and the user has been pinged per PR — don't re-open anything.

## Step 5 — Triage, post, and approve (Phase B, per PR, later)

This phase is **human-driven from the report page** — the user reads the recommendation, checks/edits comments, and clicks **Post selected** or **Approve PR** (which post via the local server; see `README.md` for the UI/server details). **Nothing is required of Claude** unless the user explicitly asks.

When the user *does* ask you to post or approve for a PR:

- **Post its selected comments** — they'll have clicked **Export** on the report, which saves `pr-review-selections-pr<N>.json` (usually `~/Downloads`; take the newest matching file). Post it with the poster script:

  ```bash
  python3 <skill-path>/scripts/post_selections.py <selections.json> --dry-run   # preview
  python3 <skill-path>/scripts/post_selections.py <selections.json>            # post
  ```

- **Approve it** — `gh pr review <N> --repo <owner/repo> --approve`.

Then relay the script's summary (posted / failed / skipped). Posting and approving do **not** touch `.git/office-hours-state.json` — state was already advanced in Step 4, so a PR won't be re-reviewed unless it gets new commits.

## Judgment calls

- **Bots**: excluded automatically (Step 1). If the user explicitly wants a bot PR reviewed, they can pass it as an inline arg to override.
- **Huge PRs**: if the diff is thousands of lines, note it in the run summary; since the batch is unattended, don't block on a prompt — review it but flag it as large so the user knows before opening the report.
- **Draft PRs**: skip by default; list them in the index's skipped bucket so the user can opt in.
- **Re-reviews**: when a PR was reviewed before, tell the review skill what changed (`git diff <last_reviewed_sha>..<head_sha>`) so it focuses on new commits rather than repeating old findings.
- **Your own PRs**: always excluded — the whole point of this loop is reviewing other people's work.
- **Never post or approve without an explicit human action.** The report's "Post selected"/"Approve PR" buttons and a clear in-chat instruction ("post the selections for #123", "approve it") all count. Silence does not — never post or approve a PR on your own initiative during the unattended batch.
