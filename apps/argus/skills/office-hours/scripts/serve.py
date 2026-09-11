#!/usr/bin/env python3
"""Local server for office-hours: serves the reports/index AND posts comments.

Static file serving (like `python -m http.server`) PLUS one endpoint:

  POST /api/post   body = a selections object {repo, pr, head_sha, decisions:[...]}
                   posts every decision with "post": true to the PR via `gh`,
                   returns {repo, pr, posted, failed, results:[{id, where, ok, error}]}

This is what the report page's "Post selected" button calls. Binds to 127.0.0.1
only, and posting uses your local `gh` auth — it runs solely on your machine.

Usage: python3 serve.py [PORT] [ROOT]   (defaults 54321 /tmp/office-hours)
"""
import json
import os
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPTS_DIR)
import post_selections as ps  # reuse post_inline / post_pr_level


def drop_from_board(repo, pr):
    """Remove a PR from manifest.json and regenerate index.html.
    Called after a successful approval — an approved PR leaves the board.
    Returns True if it was present and removed."""
    root = os.getcwd()  # server chdir's to the output root
    mpath = os.path.join(root, "manifest.json")
    if not os.path.exists(mpath):
        return False
    m = json.loads(open(mpath).read())
    prs = m.get("prs", [])
    kept = [p for p in prs if not (p.get("repo") == repo and str(p.get("number")) == str(pr))]
    if len(kept) == len(prs):
        return False
    m["prs"] = kept
    with open(mpath, "w") as f:
        json.dump(m, f, indent=2)
    subprocess.run(
        [sys.executable, os.path.join(SCRIPTS_DIR, "generate_index.py"),
         "--manifest", mpath, "--output", os.path.join(root, "index.html")],
        capture_output=True,
    )
    return True


def submit_review(sel):
    """Submit a PR-level review verdict via `gh pr review`."""
    repo, pr = sel["repo"], sel["pr"]
    event = (sel.get("event") or "APPROVE").upper()
    body = sel.get("body") or ""
    flag = {"APPROVE": "--approve", "REQUEST_CHANGES": "--request-changes",
            "COMMENT": "--comment"}.get(event, "--approve")
    cmd = ["gh", "pr", "review", str(pr), "--repo", repo, flag]
    if body:
        cmd += ["--body", body]
    ok, out = ps.run(cmd)
    result = {"repo": repo, "pr": pr, "event": event, "ok": ok,
              "error": None if ok else (out.splitlines()[0] if out else "error")}
    if ok and event == "APPROVE":
        result["removed_from_board"] = drop_from_board(repo, pr)
    return result


def post_all(sel):
    repo, pr, head_sha = sel["repo"], sel["pr"], sel.get("head_sha", "")
    results, posted, failed = [], 0, 0
    for d in sel.get("decisions", []):
        if not d.get("post"):
            continue
        where = f"{d['path']}:{d['line']}" if d.get("path") else "PR-level"
        if d.get("path") and d.get("line"):
            ok, out = ps.post_inline(repo, pr, head_sha, d)
            if not ok and "422" in out:
                ok, out = ps.post_pr_level(pr, repo, f"**`{d['path']}:{d['line']}`** — {d['body']}")
                where += " (PR-level fallback: anchor not in diff)"
        else:
            ok, out = ps.post_pr_level(pr, repo, d["body"])
        results.append({"id": d.get("id"), "where": where, "ok": ok,
                        "error": None if ok else (out.splitlines()[0] if out else "error")})
        posted += ok
        failed += (not ok)
    return {"repo": repo, "pr": pr, "posted": posted, "failed": failed, "results": results}


class Handler(SimpleHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        route = {"/api/post": post_all, "/api/review": submit_review}.get(
            self.path.rstrip("/")
        )
        if not route:
            self._json(404, {"error": "unknown endpoint"})
            return
        try:
            n = int(self.headers.get("Content-Length", 0))
            sel = json.loads(self.rfile.read(n) or b"{}")
            assert sel.get("repo") and sel.get("pr") is not None
        except Exception as e:
            self._json(400, {"error": f"bad request: {e}"})
            return
        try:
            self._json(200, route(sel))
        except Exception as e:  # never crash the server on a failure
            self._json(500, {"error": str(e)})

    def log_message(self, *a):
        pass  # keep the loop transcript quiet


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 54321
    root = sys.argv[2] if len(sys.argv) > 2 else "/tmp/office-hours"
    os.makedirs(root, exist_ok=True)
    os.chdir(root)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"office-hours server on http://localhost:{port}/ (root {root})")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
