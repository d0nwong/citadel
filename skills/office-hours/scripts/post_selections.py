#!/usr/bin/env python3
"""Post an exported PR-review selections file to GitHub via `gh`.

This is the other side of the report's "Export selections" button: it reads the
downloaded pr-review-selections-pr<N>.json and posts every decision with
"post": true as a review comment on the PR.

Usage:
  python3 post_selections.py <selections.json> [--dry-run]

  --dry-run   print what would be posted, call nothing.

Requires `gh` authenticated with write access to the repo. Inline comments use
  gh api repos/<repo>/pulls/<pr>/comments
and PR-level comments (path == null) use
  gh pr comment <pr>.
If an inline anchor is rejected (HTTP 422 — line not in the diff), the comment is
retried as a PR-level comment with a `file:line` prefix, so a bad anchor never
loses the note. One comment at a time; a failure never aborts the rest.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def run(cmd):
    """Run a command, return (ok, stdout+stderr)."""
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.returncode == 0, (p.stdout + p.stderr).strip()


def post_inline(repo, pr, head_sha, d):
    cmd = ["gh", "api", f"repos/{repo}/pulls/{pr}/comments",
           "-f", f"body={d['body']}", "-f", f"commit_id={head_sha}",
           "-f", f"path={d['path']}", "-F", f"line={d['line']}",
           "-f", f"side={d.get('side') or 'RIGHT'}"]
    if d.get("start_line"):
        cmd += ["-F", f"start_line={d['start_line']}",
                "-f", f"start_side={d.get('side') or 'RIGHT'}"]
    return run(cmd)


def post_pr_level(pr, repo, body):
    return run(["gh", "pr", "comment", str(pr), "--repo", repo, "--body", body])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("selections")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    sel = json.loads(Path(args.selections).read_text())
    repo, pr, head_sha = sel["repo"], sel["pr"], sel.get("head_sha", "")
    to_post = [d for d in sel["decisions"] if d.get("post")]

    print(f"{repo}#{pr}: {len(to_post)} of {len(sel['decisions'])} selected to post"
          + (" (dry run)" if args.dry_run else ""))

    posted = failed = 0
    for d in to_post:
        where = f"{d['path']}:{d['line']}" if d.get("path") else "PR-level"
        if args.dry_run:
            print(f"  would post → {where}: {d['body'][:60].splitlines()[0] if d['body'] else ''}…")
            continue

        if d.get("path") and d.get("line"):
            ok, out = post_inline(repo, pr, head_sha, d)
            if not ok and "422" in out:
                # anchor outside the diff — degrade to a PR-level comment
                body = f"**`{d['path']}:{d['line']}`** — {d['body']}"
                ok, out = post_pr_level(pr, repo, body)
                where += " (fell back to PR-level: anchor not in diff)"
        else:
            ok, out = post_pr_level(pr, repo, d["body"])

        if ok:
            posted += 1
            print(f"  ✓ {where}")
        else:
            failed += 1
            print(f"  ✗ {where}\n      {out.splitlines()[0] if out else 'unknown error'}",
                  file=sys.stderr)

    if not args.dry_run:
        print(f"done: posted {posted}, failed {failed}, skipped {len(sel['decisions']) - len(to_post)}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
