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

# ---------------------------------------------------------------- agent
post_line sys "agent starting (timeout ${TIMEOUT}s)"

# stdout is stream-json NDJSON, shipped raw one line per POST — the server owns
# the parsing. stderr is buffered and shipped after; it is rarely interesting
# unless the run failed.
errfile=$(mktemp)
timeout "$TIMEOUT" claude --dangerously-skip-permissions -p "$FOUNDRY_TASK" \
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
# The agent only edits files; the commit is made here so it happens even when
# the agent forgot, died, or timed out with work half done.
git add -A
if git diff --cached --quiet; then
  outcome=no-changes
else
  subject=$(printf '%s' "$FOUNDRY_TASK" | head -1 | cut -c1-72)
  git commit -q -m "$subject" -m "foundry $FOUNDRY_JOB_ID" || outcome=no-changes
  outcome=${outcome:-committed}
fi

jq -cn --arg o "$outcome" --argjson x "$agent_exit" \
  '{step: "commit", outcome: $o, exitCode: $x}' | post

# The container's own exit code is not the job's verdict — the commit event
# above carries that. Exit 0 so `docker wait` only flags truly silent deaths.
exit 0
