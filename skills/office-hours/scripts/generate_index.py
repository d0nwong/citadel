#!/usr/bin/env python3
"""Generate the index / landing page listing every reviewed PR.

Usage:
  python generate_index.py --manifest manifest.json --output index.html

manifest.json schema:
  {
    "me": "liam-screencloud",                # login whose PRs were excluded
    "generated_at": "2026-07-20T09:00:00Z",  # optional display string
    "prs": [                                 # one entry per reviewed PR
      {
        "repo": "screencloud/pulse-frontend",
        "number": 1510,
        "title": "PUL-2126: Access-denied page",
        "author": "view-screencloud",
        "url": "https://github.com/screencloud/pulse-frontend/pull/1510",
        "report": "screencloud/pulse-frontend/pr1510/report.html",  # path relative to index.html
        "counts": {"critical": 1, "warning": 2, "suggestion": 3, "nit": 0}
      }
    ],
    "skipped": {                             # optional, for transparency
      "mine":   ["screencloud/pulse-backend#2375"],
      "drafts": ["screencloud/pulse-frontend#1506"],
      "bots":   ["screencloud/pulse-frontend#1514"]
    }
  }

Each PR row links to its own report.html. The page is self-contained (no external
assets), so it can be opened straight from the temp dir.
"""
import argparse
import html
import json
from pathlib import Path

SEV_ORDER = ["critical", "warning", "suggestion", "nit"]
SEV_COLOR = {
    "critical": "#e5484d",
    "warning": "#f5a623",
    "suggestion": "#3e63dd",
    "nit": "#8b8d98",
}

PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
  /* Theme tokens — adapt to light/dark, matching the report UI */
  :root {{
    color-scheme: light dark;
    --bg: #f5f6f8; --panel: #ffffff; --border: #e4e7ec;
    --text: #1c1f23; --muted: #616873;
    --shadow: 0 1px 2px rgba(0,0,0,.04), 0 1px 3px rgba(0,0,0,.06);
    --ease: cubic-bezier(0.32, 0.72, 0, 1);
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --bg: #131417; --panel: #1d1f24; --border: #2c2f36;
      --text: #e6e8eb; --muted: #9aa1ab;
      --shadow: 0 1px 2px rgba(0,0,0,.4);
    }}
  }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         font-optical-sizing: auto; background: var(--bg); color: var(--text);
         -webkit-font-smoothing: antialiased; }}
  .wrap {{ max-width: 960px; margin: 0 auto; padding: 32px 20px 64px; }}
  h1 {{ font-size: 24px; margin: 0 0 4px; letter-spacing: -0.018em; }}
  .muted {{ color: var(--muted); font-size: 13px; }}
  .card {{ background: var(--panel); border: 1px solid var(--border); border-radius: 14px;
          margin-top: 20px; overflow: hidden; box-shadow: var(--shadow); }}
  .repo-head {{ padding: 12px 16px; font-weight: 600; font-size: 13px; letter-spacing: -0.006em;
               border-bottom: 1px solid var(--border);
               background: color-mix(in srgb, var(--text) 3%, var(--panel)); }}
  .row {{ display: flex; align-items: center; gap: 12px; padding: 14px 16px;
         border-bottom: 1px solid var(--border); text-decoration: none; color: inherit;
         transition: background 120ms var(--ease), transform 120ms var(--ease); }}
  .row:last-child {{ border-bottom: 0; }}
  .row:hover {{ background: color-mix(in srgb, var(--text) 5%, transparent); }}
  .row:active {{ transform: scale(0.995); }}
  .num {{ font-variant-numeric: tabular-nums; color: var(--muted); min-width: 56px; }}
  .main {{ flex: 1; min-width: 0; }}
  a.title {{ font-weight: 500; color: var(--text); text-decoration: none; display: block;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
  .sub {{ font-size: 12px; color: var(--muted); margin-top: 2px; }}
  .badges {{ display: flex; gap: 6px; flex-shrink: 0; }}
  .badge {{ font-size: 12px; font-weight: 600; color: #fff; border-radius: 999px;
           padding: 2px 9px; min-width: 20px; text-align: center; letter-spacing: .005em; }}
  .none {{ color: var(--muted); font-size: 12px; }}
  .skips {{ margin-top: 24px; font-size: 13px; }}
  .skips summary {{ cursor: pointer; color: var(--muted); }}
  .skips ul {{ margin: 8px 0 0; padding-left: 20px; color: var(--muted); }}
  .open-hint {{ color: var(--muted); font-size: 12px; flex-shrink: 0; }}
  @media (prefers-reduced-motion: reduce) {{
    * {{ transition-duration: 0.01ms !important; }}
    .row:active {{ transform: none !important; }}
  }}
  @media (prefers-contrast: more) {{
    :root {{ --border: color-mix(in srgb, var(--text) 45%, transparent); --muted: var(--text); }}
  }}
</style>
</head>
<body>
<div class="wrap">
  <h1>PR review queue</h1>
  <div class="muted">{summary}</div>
  {cards}
  {skips}
</div>
</body>
</html>
"""


def esc(s):
    return html.escape(str(s if s is not None else ""))


def badges(counts):
    counts = counts or {}
    out = []
    for sev in SEV_ORDER:
        n = counts.get(sev, 0)
        if n:
            out.append(f'<span class="badge" style="background:{SEV_COLOR[sev]}" '
                       f'title="{sev}">{n}</span>')
    if not out:
        return '<span class="none">no findings</span>'
    return '<div class="badges">' + "".join(out) + "</div>"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    m = json.loads(Path(args.manifest).read_text())
    prs = m.get("prs", [])

    # group by repo, preserving first-seen order
    by_repo = {}
    for p in prs:
        by_repo.setdefault(p["repo"], []).append(p)

    cards = []
    for repo, items in by_repo.items():
        rows = []
        for p in items:
            rows.append(
                f'<a class="row" href="{esc(p["report"])}">'
                f'<span class="num">#{esc(p["number"])}</span>'
                f'<span class="main">'
                f'<span class="title">{esc(p["title"])}</span>'
                f'<span class="sub">@{esc(p.get("author"))}</span>'
                f'</span>'
                f'{badges(p.get("counts"))}'
                f'<span class="open-hint">open report &rsaquo;</span>'
                f'</a>'
            )
        cards.append(
            f'<div class="card"><div class="repo-head">{esc(repo)} '
            f'&middot; {len(items)} reviewed</div>{"".join(rows)}</div>'
        )

    skips_html = ""
    sk = m.get("skipped") or {}
    labels = {"mine": "your own PRs", "drafts": "drafts", "bots": "bot-authored"}
    lines = []
    for key, label in labels.items():
        vals = sk.get(key) or []
        if vals:
            lines.append(f"<li>{esc(label)}: {esc(', '.join(vals))}</li>")
    if lines:
        skips_html = ('<details class="skips"><summary>Skipped '
                      f'({sum(len(sk.get(k) or []) for k in labels)})</summary>'
                      f'<ul>{"".join(lines)}</ul></details>')

    total_findings = sum(sum((p.get("counts") or {}).values()) for p in prs)
    gen = m.get("generated_at")
    summary = (f'{len(prs)} PR(s) reviewed · {total_findings} finding(s) · '
               f'excluding {esc(m.get("me", "you"))}'
               + (f' · {esc(gen)}' if gen else ''))

    page = PAGE.format(
        title="PR review queue",
        summary=summary,
        cards="".join(cards) or '<div class="card"><div class="repo-head">'
                                 'No PRs needed review.</div></div>',
        skips=skips_html,
    )
    Path(args.output).write_text(page)
    print(f"Wrote {args.output}: {len(prs)} PR(s) across {len(by_repo)} repo(s), "
          f"{total_findings} finding(s).")


if __name__ == "__main__":
    main()
