# office-hours — architecture & UI reference

Human-facing documentation for the office-hours PR-review skill. The agent
procedure lives in `SKILL.md`; this file documents the pieces a person interacts
with (the served board, the report UI, the local server) and how they fit
together. Claude does **not** need to read this to run the skill.

## File map

```
SKILL.md                     the agent procedure (what Claude executes)
scripts/
  generate_report.py         PR findings + diff → report.html
  generate_index.py          manifest.json → index.html (the board)
  serve.py                   static server + POST /api/post, /api/review
  serve.sh                   idempotent launcher for serve.py
  post_selections.py         post an exported selections file via gh (offline path)
  notify.sh                  desktop notification (terminal-notifier / osascript / notify-send)
assets/
  report_template.html       the interactive per-PR triage report
README.md                    this file
```

Config and state (not in the skill dir):

- **Repo list:** `~/.config/office-hours/repos.txt` — one `owner/repo` per line.
- **Review state:** `.git/office-hours-state.json` — last-reviewed SHA per PR.
- **Working dir:** `/tmp/office-hours/` — checkouts, worktrees, per-PR reports,
  `manifest.json`, and `index.html`. This is the server's document root.

## The server (`serve.py`)

Started by Phase A (`serve.sh 54321 /tmp/office-hours`), binds `127.0.0.1` only.
Serves the working dir statically **and** exposes two POST endpoints. All posting
uses your local `gh` auth and runs solely on your machine.

| Endpoint | Body | Action |
| --- | --- | --- |
| `POST /api/post` | selections object (below) | posts each `post:true` comment via `gh` — inline where anchored, PR-level otherwise; a 422 (anchor not in diff) degrades to a PR-level comment |
| `POST /api/review` | `{repo, pr, event, body?}` | `gh pr review <pr> --<event>`. On a successful `APPROVE`, removes the PR from `manifest.json` and regenerates `index.html` so it drops off the board (the report file stays, just unlinked). `event` ∈ `APPROVE`/`REQUEST_CHANGES`/`COMMENT` |

Selections object (shared by the Export button, `/api/post`, and `post_selections.py`):

```json
{
  "repo": "screencloud/studio", "pr": 123, "head_sha": "abc123...",
  "decisions": [
    { "id": "c1", "post": true, "path": "src/auth/verify.ts", "line": 42,
      "side": "RIGHT", "start_line": null, "body": "possibly edited text" }
  ]
}
```

## The board (`index.html`)

Generated from `manifest.json`. One row per reviewed PR (grouped by repo, with
severity-count badges), plus a collapsible "Skipped" section listing what was
dropped (your own PRs, bots, drafts). Rows link to each PR's report. The board is
opened once up front and regenerated after every review, so it grows 1…2…3…N.

## The report (`report_template.html`)

Per-PR triage UI, served over HTTP. Anatomy:

- **Recommendation banner** — the `/agent-skills:review` verdict
  (`approve`/`request_changes`/`comment`) + one-paragraph summary, from `meta.json`.
- **Title** links to the PR; **‹ All reviews** returns to the board.
- **Per-finding cards** — severity pill, location, the exact markdown body
  (editable), a diff snippet around the anchor, and a **Post** checkbox.
- **Footer actions:**
  - **Post selected → GitHub** → `/api/post` (posts the checked comments).
  - **Approve PR** → `/api/review` with `APPROVE` (also clears it from the board).
  - **Export** → downloads `pr-review-selections-pr<N>.json` for the offline path.

Design: theme-aware (light/dark), translucent chrome, instant press feedback,
critically-damped transitions, and `prefers-reduced-motion` / `-transparency` /
`-contrast` fallbacks. All CSS/JS is inline; no external assets.

Because the buttons call the local server, **they only work while `serve.py` is
running.** A stale `file://` report or a stopped server makes them show a
"couldn't reach the server" message; use Export → `post_selections.py` instead.

## Offline / scripted posting (`post_selections.py`)

The path Claude uses when you ask it to post, and the fallback when the server is
down:

```bash
python3 scripts/post_selections.py <selections.json> --dry-run   # preview
python3 scripts/post_selections.py <selections.json>             # post
```

Same posting logic as `/api/post` (the server imports it).
