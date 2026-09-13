# The feature spec

Adapted from `spec-driven-development` (the Specify phase) and `doubt-driven-development` in addy-agent-skills (MIT, © 2025 Addy Osmani): the spec is a feature's, not a project's, and it lives on after the work.

A feature's spec says what must be true of it, as checks. The revision is the whole spec as it will read once this work is live — not a delta — so folding it later is a copy. Its shape is in `SHAPES.md`.

## 1. Start from the baseline

`$D/<app>/features/<dir>/docs/spec.md` is the baseline. Copy it to `revisions/<slug>/specs/<app>/<dir>.md` and edit the copy. A feature with no baseline gets its first spec from the arch doc, `product.md` where one is left, the ledger's requirement rows, and the interview: what the code visibly does today plus what the interview settled, nothing speculative. Say in Assumptions that it was compressed from those sources and not re-verified line by line.

## 2. Write each criterion as its own check

- **An outcome, never a mechanism.** "Rerun queues a new row with the same task and base" — not "rerunJob copies the columns".
- **The state to set up, then what is observed.** Two checks are two criteria.
- **Cite the business rule** it implements where one exists: `(R-3)`.
- **A vague ask becomes a number** the code or the user supports; ask for it now — the user is here.

## 3. Keep the ids honest

Front matter carries `next_id`, and ids are never reused, because tickets, tests and PR bodies cite them.

- **Reword in place** when a test named after the id would still prove the same thing: a tightened number, a clearer sentence.
- **Retire** when it would not: the behaviour is dropped, replaced by its opposite, split in two, or its rule was contradicted. The line moves to `## Retired` as `- S-4 — <text> — retired by <slug>`, and its replacement takes a new id.
- **New criteria** take `next_id`, `next_id + 1`, …; the front matter's `next_id` ends one past the highest used.
- `revised_by` names the revision (its slug until step 5 files it).

## 4. The rest of the file

Out of scope names what this feature is not and who owns that. Assumptions lists each decision made in place of evidence, and what decided it — and before you show the spec, list the new ones to the user: *correct any of these now, or they stand*. No Commands, Project Structure or Code Style: those are the repo's, and the job's own spec step finds them. Stay under 250 curated lines.

## 5. The doubt pass

Run it on each spec before showing it, and on the plan before showing that.

1. **Claim.** Two lines: what the artifact asserts, and why a mistake in it is expensive.
2. **Extract.** The artifact and its contract — the spec and the confirmed intent; the plan and the specs — without your reasoning.
3. **Doubt.** A fresh-context subagent gets only the artifact and the contract, and this prompt: *Adversarial review. Find what is wrong: unstated assumptions, criteria that cannot fail, a criterion naming a mechanism, scope the intent never agreed, an id reused, a retirement that should be a rewording. Do not validate or summarise. Find issues, or say you found none after a thorough read.* Never hand it the claim.
4. **Reconcile.** Re-read the artifact against each finding: a contract you wrote unclearly (fix the contract), a real issue (fix the artifact and go again), a real trade-off (keep it and tell the user), or noise (note it).
5. **Stop** when a round finds only trivia, or after three rounds — then tell the user what is still open rather than grinding a fourth.

Offer the user a second opinion from another model if they want one, and run nothing external without their yes. Tell the user what the pass changed when you show the artifact.
