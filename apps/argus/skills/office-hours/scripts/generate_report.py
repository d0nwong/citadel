#!/usr/bin/env python3
"""Generate an interactive PR review triage report.

Usage:
  python generate_report.py --comments comments.json --diff pr.diff \
                            --meta meta.json --output report.html [--context 4]

comments.json: list of findings (see SKILL.md for schema).
pr.diff:       output of `gh pr diff <N>` (unified diff).
meta.json:     {repo, number, title, author, head_ref, base_ref, head_sha, url}

The script locates each comment's anchor line inside the diff and embeds a
snippet of surrounding lines, so callers never paste code into comments.json.
"""
import argparse
import json
import sys
from pathlib import Path

VALID_SEVERITIES = {"critical", "warning", "suggestion", "nit"}


def parse_diff(text):
    """Parse a unified diff into {path: [line, ...]} where each line is
    {old_no, new_no, type} with type in {context, add, del}."""
    files = {}
    path = None
    old_no = new_no = 0
    for raw in text.splitlines():
        if raw.startswith("diff --git"):
            path = None
        elif raw.startswith("+++ "):
            p = raw[4:].strip()
            path = None if p == "/dev/null" else p[2:] if p.startswith("b/") else p
            if path is not None:
                files.setdefault(path, [])
        elif raw.startswith("@@"):
            # @@ -old_start,old_len +new_start,new_len @@
            try:
                parts = raw.split("@@")[1].strip().split()
                old_no = int(parts[0].lstrip("-").split(",")[0])
                new_no = int(parts[1].lstrip("+").split(",")[0])
            except (IndexError, ValueError):
                continue
        elif path is not None and raw[:1] in {" ", "+", "-"} and not raw.startswith(("---", "+++")):
            kind = {" ": "context", "+": "add", "-": "del"}[raw[0]]
            line = {"old_no": None, "new_no": None, "type": kind, "text": raw[1:]}
            if kind in ("context", "del"):
                line["old_no"] = old_no
                old_no += 1
            if kind in ("context", "add"):
                line["new_no"] = new_no
                new_no += 1
            files[path].append(line)
    return files


def build_snippet(diff_files, comment, context):
    path, line, side = comment.get("path"), comment.get("line"), comment.get("side") or "RIGHT"
    if not path or not line:
        return []
    lines = diff_files.get(path, [])
    key = "new_no" if side == "RIGHT" else "old_no"
    start = comment.get("start_line") or line
    targets = {i for i, l in enumerate(lines) if l[key] is not None and start <= l[key] <= line}
    if not targets:
        return []
    lo = max(0, min(targets) - context)
    hi = min(len(lines), max(targets) + context + 1)
    return [{**lines[i], "target": i in targets} for i in range(lo, hi)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--comments", required=True)
    ap.add_argument("--diff", required=True)
    ap.add_argument("--meta", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--context", type=int, default=4)
    args = ap.parse_args()

    comments = json.loads(Path(args.comments).read_text())
    meta = json.loads(Path(args.meta).read_text())
    diff_files = parse_diff(Path(args.diff).read_text(errors="replace"))

    warnings = []
    for i, c in enumerate(comments):
        c.setdefault("id", f"c{i + 1}")
        c.setdefault("side", "RIGHT" if c.get("path") else None)
        if c.get("severity") not in VALID_SEVERITIES:
            warnings.append(f"{c['id']}: severity {c.get('severity')!r} -> 'suggestion'")
            c["severity"] = "suggestion"
        c["snippet"] = build_snippet(diff_files, c, args.context)
        if c.get("path") and not c["snippet"]:
            warnings.append(
                f"{c['id']}: anchor {c['path']}:{c.get('line')} not found in diff "
                f"(GitHub will 422 on this inline comment — consider path: null)"
            )

    template = (Path(__file__).resolve().parent.parent / "assets" / "report_template.html").read_text()
    payload = json.dumps({"meta": meta, "comments": comments})
    html = template.replace("__TITLE__", f"Review triage · #{meta.get('number')}").replace(
        "__PAYLOAD__", payload
    )
    Path(args.output).write_text(html)

    print(f"Wrote {args.output}: {len(comments)} comment(s), "
          f"{sum(1 for c in comments if c['snippet'])} with diff context.")
    for w in warnings:
        print(f"WARNING: {w}", file=sys.stderr)


if __name__ == "__main__":
    main()
