#!/usr/bin/env bash
# forge-run — what an ephemeral job container actually does. Bind-mounted from
# image/forge-run.sh (not baked in), so iterating on it needs no image rebuild.
#
# Contract: run the agent against /work, commit whatever changed, and report
# every step to the web server. Push, PR and the database are the HOST's job —
# this container holds no forge credentials and no DATABASE_URL, on purpose.
#
# Env (set by web/src/features/jobs/server/job-runner.ts):
#   FOUNDRY_JOB_ID FOUNDRY_CALLBACK FOUNDRY_TOKEN FOUNDRY_TASK FOUNDRY_TIMEOUT
set -uo pipefail   # deliberately no -e: every failure path must still report

: "${FOUNDRY_JOB_ID:?}" "${FOUNDRY_CALLBACK:?}" "${FOUNDRY_TOKEN:?}" "${FOUNDRY_TASK:?}"
TIMEOUT="${FOUNDRY_TIMEOUT:-1800}"
EVENTS="$FOUNDRY_CALLBACK/api/jobs/$FOUNDRY_JOB_ID/events"

# POST one JSON payload; a lost callback must not kill the run.
post() {
  curl -fsS -m 10 -X POST "$EVENTS" \
    -H "Authorization: Bearer $FOUNDRY_TOKEN" \
    -H 'Content-Type: application/json' \
    --data-binary @- >/dev/null 2>&1 || true
}

post_line() { # post_line <field> <text>  — jq handles the JSON escaping
  jq -cn --arg s "$2" "{\"$1\": [\$s]}" | post
}

cd /work || { post_line sys "workspace /work is missing"; exit 1; }
start_rev=$(git rev-parse HEAD 2>/dev/null || echo none)

# ---------------------------------------------------------------- agent
post_line sys "agent starting (timeout ${TIMEOUT}s)"

# stdout is stream-json NDJSON, shipped raw one line per POST — the server owns
# the parsing. stderr is buffered and shipped after; it is rarely interesting
# unless the run failed.
# Nobody is on the other end of this run: a turn that ends on "shall I
# proceed?" ends the job with no changes. Say so at the system level, so it
# holds regardless of what a skill or the task text suggests.
UNATTENDED='This is an unattended, headless run inside a sandbox: no human can read or answer you until it is over. Never ask a question, request approval, or enter plan mode — nothing will reply and the run simply ends. Decide for yourself, write any assumptions into your final message, and carry the task through to completed edits in /work. Committing is optional and pushing is impossible here: the host pushes your commits and opens the PR after you finish, so do not try to push, open a PR, or work around missing git credentials.'

errfile=$(mktemp)
timeout "$TIMEOUT" claude --dangerously-skip-permissions -p "$FOUNDRY_TASK" \
    --append-system-prompt "$UNATTENDED" \
    --output-format stream-json --verbose 2>"$errfile" \
  | while IFS= read -r line; do
      [ -n "$line" ] && post_line ndjson "$line"
    done
agent_exit=${PIPESTATUS[0]}

[ "$agent_exit" = 124 ] && post_line sys "agent timed out after ${TIMEOUT}s"
while IFS= read -r line; do
  [ -n "$line" ] && post_line stderr "$line"
done < <(tail -40 "$errfile")

# ---------------------------------------------------------------- commit
# The agent may commit on its own or just leave edits behind; sweep up
# whatever is uncommitted so work survives a run that forgot, died, or timed
# out, then judge the outcome by whether HEAD moved — not by the sweep alone,
# or an agent that committed cleanly would read as "no changes".
git add -A
if ! git diff --cached --quiet; then
  subject=$(printf '%s' "$FOUNDRY_TASK" | head -1 | cut -c1-72)
  git commit -q -m "$subject" -m "foundry $FOUNDRY_JOB_ID" || true
fi
if [ "$(git rev-parse HEAD 2>/dev/null || echo none)" != "$start_rev" ]; then
  outcome=committed
else
  outcome=no-changes
fi

jq -cn --arg o "$outcome" --argjson x "$agent_exit" \
  '{step: "commit", outcome: $o, exitCode: $x}' | post

# The container's own exit code is not the job's verdict — the commit event
# above carries that. Exit 0 so `docker wait` only flags truly silent deaths.
exit 0
