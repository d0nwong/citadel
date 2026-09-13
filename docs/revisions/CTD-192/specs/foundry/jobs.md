---
feature: foundry/jobs
revised_by: CTD-192
next_id: 39
---
# Spec: Jobs

## Objective

A job is one unattended Claude Code run against one tracked repo. The host clones the repo and
branches, a throwaway container runs the blueprint's steps and commits, and the host pushes,
opens the PR, links the ticket and settles the row. The container never holds a git, forge or
database credential, and the human who ignited the job reads a PR, not a session. This first
revision states what the code does today, compressed from the retiring `product.md`'s 58 rules
and the arch doc, and adds what CTD-192 changes: a job on a ticket cut from a revision starts
from the revision's spec and the feature's arch doc.

## Criteria

- S-1 — Igniting from the ledger or the API inserts a `queued` row before anything else happens,
  and the ledger's poll shows it within a second; `202` means queued, not started.
- S-2 — The ignite dialog refuses to submit until a repo is picked and the task is longer than
  three characters; base branch is prefilled from the repo's last job, else origin's default;
  the seeded default blueprint is preselected while its row exists.
- S-3 — A preflight failure — no Claude credential, docker down, image missing, not a git repo,
  no `origin`, missing base branch, missing PR CLI — settles the job `failed` with the reason
  in its log before any container starts.
- S-4 — Only local repo refs run; any other kind fails at preflight.
- S-5 — At most `FOUNDRY_MAX_JOBS` jobs (default 3) run at once; the rest stay `queued` with a
  log line, and every settle starts the oldest queued job.
- S-6 — The workspace is a fresh clone branched from origin's tip of the base branch, falling
  back to the local checkout with a log line when the fetch fails; uncommitted changes in the
  host's checkout never reach it; its `origin/HEAD` points at the source repo's real default.
- S-7 — The branch is `foundry/<first three words of the task>-<short id>`; a name already on
  origin is suffixed `-2` … `-20`, and past 20 the job fails.
- S-8 — The container receives the workspace, a Claude credential, its per-job callback token
  and, when configured, the MCP gateway token — and no git, GitHub, Bitbucket or database
  credential.
- S-9 — A blueprint's steps are snapshotted onto the job at insert; editing or deleting the
  blueprint later changes nothing about that job, and a blueprint deleted before the insert
  refuses it.
- S-10 — Every step runs in one Claude session; a step that exits non-zero stops the remaining
  steps with a log line; every step is told at the system level that nobody can answer it and
  it may not ask, plan interactively, push or open a PR.
- S-11 — `FOUNDRY_TIMEOUT` (default 1800 s) is one budget for the whole job including the
  pre-step; a step with no budget left is skipped and the run reports exit 124.
- S-12 — A job's output streams as `sys` / `out` / `tool` / `err` lines grouped per step, kept as
  one JSONL file per job under `~/.foundry/logs`; a log write that fails never fails the job.
- S-13 — Whatever the agent left uncommitted is swept into a commit before the container
  reports; the verdict is whether `HEAD` moved.
- S-14 — An agent that exits non-zero with commits gets them pushed and the job settles
  `failed`; an agent that changed nothing produces no push and no PR, and settles `succeeded`,
  or `failed` when it also errored.
- S-15 — The PR title is the agent's commit subject when it reads as Conventional Commits, else
  the task's first line, cut to 100 characters; the body is `.git/PR_BODY.md` verbatim plus a
  `Created by foundry <id>` footer, else the newest substantive commit body, else the task; a
  run with work but no body gets one extra resumed turn for it when more than 30 s remain,
  capped at 240 s, and failing there never changes the outcome.
- S-16 — PRs open with `gh` on github.com and `bb` on bitbucket.org, without Bitbucket's default
  reviewers unless `FOUNDRY_BB_REVIEWERS=1`; any other origin gets its branch pushed, an `err`
  line, and no PR.
- S-17 — On a Bitbucket origin the host files the PR onto the Linear tickets named in the PR
  body or the task, never fatally; a bare ticket id counts in the task and never in a body.
- S-18 — Repo notes and PR comments are read when the forge lights, not when the job was queued.
- S-19 — A follow-up can be queued only from a settled job with a PR; it reuses that job's
  branch and PR URL exactly, receives the PR's unresolved review threads and non-bot general
  comments as its task, and with nothing to address, or the branch gone from origin, settles
  `failed` at preflight without lighting a forge.
- S-20 — Rerun queues a brand-new row with the same task, repo, base branch, forge and
  blueprint snapshot.
- S-21 — Cancel, from `queued` or `running`, settles the row `cancelled` first and kills the
  container second; a settled job never changes outcome, whichever caller arrives later.
- S-22 — Purge deletes every settled job's row and log file and touches no queued or running job.
- S-23 — After a server restart a running job is re-adopted: an alive container gets its
  watcher back, a job at `push` or `pr` resumes the host-side finish, anything else with no
  container settles `failed`; a container that dies without reporting its commit settles the
  job `failed` naming the exit code.
- S-24 — The HTTP API answers `503` on every authenticated route until `FOUNDRY_API_TOKEN`
  exists; bearer tokens are compared in constant time; the events route answers `401`
  identically for an unknown job and a wrong token; the per-job token never leaves the server.
- S-25 — `POST /api/jobs` resolves `repo` by exact path, `~`-path or unique basename, else `400`
  naming every known repo; requires `instructions`, `ticketId` or both; requires an absolute
  `http(s)` `callbackUrl` when one is sent; fills defaults the way the dialog does.
- S-26 — An `Idempotency-Key` of 1 to 128 characters makes the call safe to retry: the same key
  and body answer `200` with the job already made and queue nothing; a different body answers
  `422`; only the request that inserted the row ignites it.
- S-27 — A `ticketId` with no instructions becomes the brief `<KEY>: <title>`, the issue URL,
  then the description; the issue is fetched before the insert (`400` unknown, `502`
  unreachable, `503` with no Linear key); the insert is the claim, so a second send answers
  `409` naming the holder; the claim is then mirrored to Linear as assignee and In Progress,
  a failure there being an `err` line; readiness is never judged.
- S-28 — `GET /api/jobs/{id}` returns the job, with its log lines under `?logs=1`, and `404` for
  a malformed or unknown id; `GET /api/repos` returns exactly the tracked rows `repo` accepts.
- S-29 — Every settle that makes the transition posts one `job.settled` to the job's
  `callbackUrl`, HMAC-signed under the install token, three attempts over about six seconds,
  logging the receiver's host and never its URL, and never affecting the job's status.
- S-30 — `/api/openapi.json` and `/api/reference` are unauthenticated and the document's field
  shapes are generated from the schemas the handlers parse with.
- S-31 — Credentials are read fresh from the repo root `.env` on every use, so `foundry auth`
  takes effect without a restart.
- S-32 — The pre-step measures install, test and typecheck once per repo and base sha, posts
  the result, and the host caches it; a later job on the same base is handed the cached
  `~/baseline.md` and installs only.
- S-33 — A root job's task is hydrated on the host with the Linear issues it links and the repo
  files it names in backticks, whole, under a 64 KB cap that shrinks for a long task; a path
  missing at the base is listed, and nothing here fails a job.
- S-34 — The pnpm store and the npm cache persist across jobs in named volumes.
- S-35 — A root job whose ticket has a parent with a filed revision under `ARGUS_DATA_DIR`
  is handed `### Spec: <feature>` with the revision's spec and `### Arch: <feature>` with the
  feature's arch doc, for every feature the revision names, after the linked issues and before
  the named files, under the same cap; with no parent, no directory or no data dir, nothing is
  added and one `sys` line says so; nothing here fails a job.
- S-36 — The issue the host fetches for a ticket carries its parent's identifier.
- S-37 — The spec step, handed a `### Spec:` block, takes each cited `S-n` criterion's wording
  for the `C<n>` that implements it and keeps the id beside it, and reads the `### Arch:` block
  before the code; a job with no such block specs the ticket as it does today.
- S-38 — The host reads a revision's spec and a feature's arch doc from citadel-data and
  nothing else there — no ledger — and the container never sees citadel-data at all.

## Out of scope

- Walking a parent ticket's sub-issues as one run, one job per step, merge-gated: CTD-125.
- Judging whether a ticket is ready: the sender decided.
- Repos other than local checkouts; the CLI's prune of `~/.foundry/jobs/`.
- Pensieve's view of a job: it reads the API.

## Assumptions

- The first 34 criteria compress the retiring `product.md`'s 58 business rules and the arch
  doc's contracts at their current sha into outcomes; the mechanisms stay in `docs/arch.md`.
  The rules were merged where they described one outcome from two angles and not re-verified
  line by line against the code for this revision.
- Criteria S-35 to S-38 are CTD-192's change to this feature. The hydration order — issues, spec, arch,
  files — puts the reviewed spec ahead of the files a ticket names because a cut at the cap
  lists files and never truncates them.
- The arch doc goes in whole. Its 250-line cap is what makes it affordable, and the host has
  no model call with which to pick sections.

## Retired

- none
