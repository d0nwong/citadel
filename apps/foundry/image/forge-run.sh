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
#   FOUNDRY_STEPS  — JSON array [{name, model, effort?, prompt}] from a
#                    blueprint (LIA-25); empty/absent means one bare step.
#   FOUNDRY_REPO_NOTES — the target repo's standing instructions, if any.
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

# post_line <field> <text> — jq handles the JSON escaping. While a blueprint
# step runs, STEP_LABEL carries `{index,name}` so the server can prefix lines.
STEP_LABEL=null
post_line() {
  jq -cn --arg s "$2" --argjson step "$STEP_LABEL" \
    "{\"$1\": [\$s]} + (if \$step == null then {} else {step: \$step} end)" | post
}

cd /work || { post_line sys "workspace /work is missing"; exit 1; }
start_rev=$(git rev-parse HEAD 2>/dev/null || echo none)

# ---------------------------------------------------------------- steps
# A plain job is a blueprint of one step on the default model — same loop,
# so there is exactly one way an agent gets launched here.
steps="${FOUNDRY_STEPS:-[]}"
if [ "$(printf '%s' "$steps" | jq 'length')" = 0 ]; then
  steps=$(jq -cn --arg p "$FOUNDRY_TASK" '[{name: "agent", model: "", prompt: $p}]')
fi
n=$(printf '%s' "$steps" | jq 'length')
# One session across every step: the executor resumes the planner's context.
SID=$(cat /proc/sys/kernel/random/uuid)

post_line sys "agent starting — $n step(s), timeout ${TIMEOUT}s"

# stdout is stream-json NDJSON, shipped raw one line per POST — the server owns
# the parsing. stderr is buffered and shipped after; it is rarely interesting
# unless the run failed.
# Nobody is on the other end of this run: a turn that ends on "shall I
# proceed?" ends the job with no changes. Say so at the system level, so it
# holds regardless of what a skill or the task text suggests — including a
# repo-shipped .claude/skills workflow that shadows the baked /work skill
# with interactive steps (approval gates, branching, pushing its own PR).
UNATTENDED='This is an unattended, headless run inside a sandbox: no human can read or answer you until it is over. Never ask a question, request approval, or enter plan mode — nothing will reply and the run simply ends. Decide for yourself, write any assumptions into your final message, and carry the task through to completed edits in /work. Committing is optional and pushing is impossible here: the host pushes your commits and opens the PR after you finish, so do not try to push, open a PR, or work around missing git credentials. The repo may ship its own workflow skill written for an interactive session; its repo-specific content rules still bind you — required changelog or changeset files, commit style, PR templates, checklists — but skip every step of it that creates a branch, pushes, opens a PR, or waits for approval: the host already branched from the base and handles push and PR itself. If you commit, give it a clear one-line subject in the style the repo uses — it becomes the PR title. Before finishing, write the PR description the host should use to .git/PR_BODY.md (under .git/ on purpose, so it can never enter a commit): follow the repo PR template if one exists, otherwise the foundry template at /usr/local/share/foundry/pr-template.md; fill its sections for real, and always include a summary, your stated assumptions, and how you verified the change. Write that PR description as rendered markdown, which soft-wraps: one unbroken line per paragraph and per bullet, never hard-wrapped at a fixed column — hard wrapping there splits inline code runs mid-token and renders the break as an inserted space. The commit body is the exception, since git log is read in a terminal that does not soft-wrap: keep the usual ~72-column wrap there.'

# The repo's standing preferences, set on foundry's Repos page. They ride in
# the system prompt rather than the task text so they hold for every step of a
# blueprint — including the planning step, which is what they are mostly for —
# and cannot be mistaken for part of what was asked.
SYSTEM_PROMPT="$UNATTENDED"
if [ -n "${FOUNDRY_REPO_NOTES:-}" ]; then
  SYSTEM_PROMPT="$UNATTENDED

Repo notes — standing instructions from the owner of this repository, which apply to every job run against it. Follow them while planning and while editing, exactly as if the task text had said them. They do not replace the task, and the repo's own CLAUDE.md still applies; where a note and the code genuinely conflict, follow the code and say so in your final message.

$FOUNDRY_REPO_NOTES"
fi

agent_exit=0
started=$(date +%s)
i=0
while [ "$i" -lt "$n" ]; do
  step=$(printf '%s' "$steps" | jq -c ".[$i]")
  i=$((i + 1))
  name=$(printf '%s' "$step" | jq -r '.name')
  model=$(printf '%s' "$step" | jq -r '.model // ""')
  effort=$(printf '%s' "$step" | jq -r '.effort // ""')
  # {{task}} in a step prompt is the job's task text; jq's replace keeps the
  # substitution out of bash quoting.
  prompt=$(printf '%s' "$step" | jq -r --arg t "$FOUNDRY_TASK" '.prompt | gsub("\\{\\{task\\}\\}"; $t)')
  STEP_LABEL=$(jq -cn --argjson i "$i" --arg name "$name" '{index: $i, name: $name}')
  [ "$n" = 1 ] && [ "$name" = agent ] && STEP_LABEL=null

  # The timeout is the whole job's budget, shrunk by what earlier steps used.
  remaining=$((TIMEOUT - ($(date +%s) - started)))
  if [ "$remaining" -le 0 ]; then
    post_line sys "step $i/$n \"$name\" skipped — job timeout already spent"
    agent_exit=124
    break
  fi

  [ "$STEP_LABEL" != null ] && post_line sys "step $i/$n starting (${model:-default model}${effort:+, effort $effort})"

  session_flag=--resume
  [ "$i" = 1 ] && session_flag=--session-id

  errfile=$(mktemp)
  timeout "$remaining" claude --dangerously-skip-permissions -p "$prompt" \
      ${model:+--model "$model"} ${effort:+--effort "$effort"} \
      "$session_flag" "$SID" \
      --append-system-prompt "$SYSTEM_PROMPT" \
      --output-format stream-json --verbose 2>"$errfile" \
    | while IFS= read -r line; do
        [ -n "$line" ] && post_line ndjson "$line"
      done
  agent_exit=${PIPESTATUS[0]}

  [ "$agent_exit" = 124 ] && post_line sys "step $i/$n timed out — ${TIMEOUT}s job budget exhausted"
  while IFS= read -r line; do
    [ -n "$line" ] && post_line stderr "$line"
  done < <(tail -40 "$errfile")

  if [ "$agent_exit" != 0 ]; then
    # Later steps build on this one; running them on a failed base would
    # only produce confident nonsense. Stop, and say what was skipped.
    STEP_LABEL=null
    [ "$i" -lt "$n" ] && post_line sys "step $i/$n exited $agent_exit — skipping $((n - i)) remaining step(s)"
    break
  fi
done
STEP_LABEL=null

# ---------------------------------------------------------------- pr body
# The PR description must not hinge on one sentence of system prompt (LIA-39):
# when the run produced work but never wrote .git/PR_BODY.md, spend one short
# resumed turn on nothing but that file. Failing here is fine — the host still
# composes a fallback body — so this never touches agent_exit.
if [ ! -s /work/.git/PR_BODY.md ] \
    && { [ -n "$(git status --porcelain 2>/dev/null)" ] \
         || [ "$(git rev-parse HEAD 2>/dev/null || echo none)" != "$start_rev" ]; }; then
  remaining=$((TIMEOUT - ($(date +%s) - started)))
  [ "$remaining" -gt 240 ] && remaining=240
  # Under ~30s a turn cannot finish; and remaining<=0 also means no step ever
  # ran, so there would be no session to resume anyway.
  if [ "$remaining" -gt 30 ]; then
    STEP_LABEL=$(jq -cn --argjson i "$((n + 1))" '{index: $i, name: "pr-body"}')
    post_line sys "run left no .git/PR_BODY.md — asking the agent for the PR description"
    errfile=$(mktemp)
    timeout "$remaining" claude --dangerously-skip-permissions \
        -p 'Write the PR description for the work you just completed to /work/.git/PR_BODY.md — create that one file and change nothing else. Follow the repo PR template if one exists, otherwise the foundry template at /usr/local/share/foundry/pr-template.md. Fill its sections for real: what changed and why, your assumptions, and how you verified it. One unbroken line per paragraph and per bullet — do not hard-wrap it at a fixed column.' \
        --resume "$SID" \
        --append-system-prompt "$SYSTEM_PROMPT" \
        --output-format stream-json --verbose 2>"$errfile" \
      | while IFS= read -r line; do
          [ -n "$line" ] && post_line ndjson "$line"
        done
    while IFS= read -r line; do
      [ -n "$line" ] && post_line stderr "$line"
    done < <(tail -20 "$errfile")
    STEP_LABEL=null
    [ -s /work/.git/PR_BODY.md ] || post_line sys "still no PR body — the host will compose one from the commit"
  fi
fi

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
