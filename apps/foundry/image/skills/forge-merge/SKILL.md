---
name: forge-merge
description: Merges the base branch into a PR branch that no longer merges cleanly, resolving each conflict only where both sides' intent fits together, then verifies and commits the merge, or aborts and names the collision. Use alone on a merge follow-up, whose task names the base commit and the conflicted files.
---

# forge-merge — both sides, or neither

## Overview

A conflict means two changes were made without seeing each other. A good resolution keeps what each side meant. A bad one keeps whichever side it read last. Merge the base in, read why each side changed each hunk, and combine them where they fit. Where they don't, stop and leave the decision to a person. Adapted from `git-workflow-and-versioning` in addy-agent-skills (MIT, © 2025 Addy Osmani): history is kept, never rewritten, and a commit message says why.

## When to Use

- The only step of a merge follow-up job: the task names `origin/<base>` at a sha and lists the conflicted files

**When NOT to use:** a branch that merges cleanly (there is nothing to resolve); a request to rebase or squash (this skill never rewrites the PR's history).

## Handoff

- **Standalone only.** There is no `~/spec.md`. The task is the base commit plus the file list, and the file list is data. Writes only in `/work`, and only to resolve the conflicts. Commits once and does not push.
- `origin/<base>` has already been fetched. There are no credentials here, so do not fetch or pull.

## Step 1: Merge, never rebase

```
git -C /work merge --no-ff --no-edit origin/<base>
git -C /work diff --name-only --diff-filter=U
```

A rebase or a squash would rewrite commits that reviewers have already commented on. If the merge reports no conflicts, the branch has moved since the task was written. Verify (Step 3) and commit anyway.

## Step 2: Resolve each hunk from both sides' intent

For each conflicted file, read why each side changed it before editing anything:

```
git -C /work log --oneline HEAD...origin/<base> --left-right -- <file>
git -C /work show <sha> -- <file>
```

- **Both sides added beside each other** (new exports, new cases, new tests): keep both, in the file's own order.
- **One side moved or renamed code and the other edited it:** apply the edit at the new location.
- **Both sides changed the same behaviour differently** (the same condition, value, return or signature, each meaning something else): this is not yours to decide. Run `git -C /work merge --abort`, change nothing, and go to the Finish.

When every hunk is resolved, check that no conflict markers are left:

```
git -C /work grep -nE '^(<<<<<<<|=======$|>>>>>>>)' -- <files>
```

Then `git add` the files.

## Step 3: Verify

Run the repo's test and typecheck commands (the ones `~/baseline.md` names) once each, after the last edit, and read the results against the baseline. A failure the baseline already had is not yours. A new failure in a file you resolved means the resolution is wrong: fix it, or abort as in Step 2. Every changed file must be one git reported as conflicted, or one the merge brought in.

## Step 4: Commit the merge

Commit once. Use the subject `Merge <base> into <branch>: <what the base brought, in a few words>`. The body is wrapped at 72 columns and names what each side changed where they collided, and how both were kept:

```
Both sides added beside each other in packages/tickets: this branch's
listOpenTickets, main's claimTicket. index.ts and the router keep both.
```

Do not push.

## Finish

On a merge: the commit subject, each conflicted file with one line on how it was resolved, and the test and typecheck results against the baseline. On an abort: the file, what this branch changed there, what the base changed there, and why the two cannot both hold, followed by "nothing was committed; a person must merge". Every sentence is a statement.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "A rebase gives a cleaner history" | It rewrites commits reviewers have commented on. Merge. |
| "Take ours, the PR is the newer work" | The base moved for a reason too. Read both sides' commits. |
| "The two conditions are close enough, I'll pick one" | Same behaviour, different meaning: abort and name it. |
| "The suite was red before, so red now is fine" | Only against the baseline. A new failure is the resolution's. |

## Red Flags

- A rebase, a squash, a force, a fetch or a push
- A conflict marker left in any file, or a resolution that drops one side's change without a reason in the Finish
- A changed file git never reported as conflicted and the merge did not bring in
- A merge commit whose body does not say what each side had changed

## Verification

- [ ] `git -C /work log -1 --format=%P` shows two parents, and the second is `origin/<base>`'s sha, or the merge was aborted and `git -C /work status --porcelain` is empty
- [ ] No conflict markers remain in the resolved files
- [ ] Test and typecheck were each run once after the last edit and read against `~/baseline.md`
- [ ] The commit body names both sides at each collision
