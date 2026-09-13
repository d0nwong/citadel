# Plan: the PR watcher (CTD-170, slice 6 of CTD-65)

Ticket: CTD-170. Branches from main after CTD-171 (PR #16).

## Overview

The follow-up job exists (LIA-40): a row with `source_job_id` checks out the PR branch and is
handed the PR's review comments as its task. This slice adds the trigger and the second task
body. A host-side watcher polls every open PR a settled job opened — `gh` for GitHub,
Bitbucket's REST API with `bb`'s stored credentials for Bitbucket — and launches the
follow-up itself: on a **submitted review** (never a pending one), with the comments as the
task as today; on a **failed check** once the checks have settled, with the failing steps'
logs as the task and `forge-debug` as the one blueprint step, so the log is triaged rather
than pattern-matched.

## Architecture decisions

- **One row per PR, not per job.** `pr_watches` (keyed by PR URL) remembers which review
  has already launched a job (`reviewed_at`), which head commit's failed checks have
  (`checked_sha`), how many launches are spent (`follow_ups`) and why watching ended
  (`stopped`). A job cannot hold this: the root and its follow-ups share the PR.
- **Dedup is the watermark, written in the same transaction as the follow-up row.** A
  crash between the two loses a trigger rather than doubling it.
- **Fresh at launch, like comments.** The watcher decides; the runner's preflight fetches
  the failing logs when the forge lights. A check that went green meanwhile fails preflight
  with "nothing to fix" instead of lighting a forge.
- **Bounded per PR.** `FOUNDRY_PR_RETRIES` (default 3) automatic follow-ups per PR, then
  the watch stops and the root job's log says so. A manual "Address PR comments" resets it.
- **Ledger visibility without new statuses.** The follow-up row carries `follow_up`
  (`review` | `check`), its task label names the trigger, and its first log line says
  which review or check fired; the root job logs each launch.
- **Bitbucket has no submitted review.** Every comment is posted on its own, so a new
  comment is the trigger there; pipelines report as commit statuses, and a failed
  Bitbucket Pipelines step's log is fetched through the same REST API.

## Task list

- T1: schema — `jobs.follow_up`, `pr_watches`; migration 0017; seed "Fix failing check"
  (`/forge-debug {{task}}`, one step) as migration 0018.
- T2: `forge-pr.ts` — PR state readers (`gh pr view --json`, Bitbucket REST), failed-log
  fetch (`gh run view --job --log-failed`, Pipelines step log), review bodies in comments.
- T3: `pr-watcher.ts` — the tick, the transaction, the loop; hooked from `ensureReconciled`.
- T4: runner — preflight composes the check task; launch passes it; store's `followUpJob`
  takes a kind and a reason; rerun copies the kind; purge drops orphaned watches.
- T5: UI — the detail sheet names the trigger; README knobs; tests for the tick, the
  parsers and the seed.
