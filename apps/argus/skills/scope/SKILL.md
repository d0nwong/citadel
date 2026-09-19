---
name: scope
description: Turns a ramble — a few sentences, a ticket of notes, a voice-note transcript — into a filed revision: an interview until the intent is confirmed, the revised spec of every feature it touches, a plan cut into tickets, and a parent with sub-tickets on Linear or Trello, kept under revisions/ in citadel-data. Use when the user says "/scope", "scope this", "spec this out", "turn this into tickets", or hands over a brain dump or a ticket of notes that needs more than one ticket. Interactive: every step waits for the user's yes.
---

# scope — a ramble, made into a revision

## Overview

The human's effort goes where one bad line costs the most: the spec, not the PR. This skill interviews until it can predict the user's answers, writes down what was agreed, revises each feature's spec from its baseline, cuts the difference into tickets, and files them. Each step ends on the user's explicit yes before its file is written.

## When to Use

- `/scope <ramble>`, `/scope <KEY>` for a ticket of notes, `/scope <path>` for a notes file; add `--parent <KEY>` to file under an existing ticket
- A change or a new feature whose shape is not settled, or that needs more than one ticket

**When NOT to use:** one ticket with clear acceptance criteria (`linear-ticket`); a question about the record (`ask`); any unattended run — this needs a person answering.

## Handoff

Reads citadel-data through `argus` and `accio`, the arch docs and specs as files, and tickets through `argus tracker`. Writes only under `revisions/<slug>/`: `revision.json` through `argus revision new`/`file`, each committing itself; the markdown a step writes, that step commits itself, after the user's yes and before the next step begins, with `argus save <files> -m "scope <slug|KEY>: <step>"` — `intent`, `specs`, `plan` or `filed`, the filing step's commit carrying its rewrite of the key too (in a Pensieve conversation, as `pensieve/ask` S-59 says). Writes a tracker only in step 5. Never runs `argus reconcile` or `argus commit`; those are the sweep's.

A terminal does not set the data root, so every `argus` and `accio` call carries it; `$D` below is that directory:

```sh
ARGUS_ROOT=${ARGUS_ROOT:-$HOME/git/citadel-data} argus revision show <slug>
```

## Step 1: Ground, then interview

Before the first hypothesis, find the features and read what exists. `accio find "<words>"` names the alden-portal feature behind a screen, field or route; for Foundry, Pensieve and Argus, whose code it does not index, the `aliases` and `core_files` in `$D/<app>/.doc-workspace/feature-manifest.json` do. Then, for each feature: `$D/<app>/features/<dir>/docs/spec.md` and `docs/arch.md`; an Alden feature's ledger with `argus show <dir>` (the other apps have none); `argus tracker show <KEY>` when the argument is a ticket key, from whichever provider it names. Then interview per `interview.md` until the restate gets an explicit yes.

```
"regenerating an invoice should warn when the period is still open"
  accio find "Regenerate invoice"   →  admin-usage, history-tab-content.tsx
  argus show admin/usage; read its docs/spec.md (if any) and docs/arch.md
```

The features come out of this step as `<app>/<dir>` keys: `foundry/jobs`, `alden/alden-portal/admin/usage`.

## Step 2: Write the intent

`argus revision new <slug> --title "<title>" --feature <app>/<dir>[,…]`, then the confirmed restate as `$D/revisions/<slug>/intent.md` in the shape in `SHAPES.md`. The slug names the work in two or three words: `reignite`, `spec-tickets`.

## Step 3: Revise the specs

One file per feature, `specs/<app>/<dir>.md`, per `spec.md`: edited from the baseline, or written first from the arch doc, `product.md`, the ledger's requirement rows and the interview. Run the doubt pass, then show each spec with its new, reworded and retired ids called out, and wait for yes.

## Step 4: Plan the tickets

The difference between baseline and revision, cut into tickets per `plan.md` and written as `$D/revisions/<slug>/plan.md`. Doubt pass, then show the ticket list and every body, and wait for yes.

## Step 5: File

Only after the plan's yes, and only what the plan says, through `argus tracker`, never a provider's own tools. A Foundry, Pensieve or Argus feature files on Linear, team Citadel; an alden-portal feature files on Trello, the Alden board.

**On Linear** (Citadel apps):

1. **The parent.** With `--parent <KEY>`, that issue: rewrite its description whole with one line added pointing at `revisions/<KEY>/` — never a `patch`, which corrupts images. Otherwise `argus tracker create --title "<t>" --team CTD --project "<app>" --assignee me`.
2. **The sub-issues**, in plan order: `argus tracker create --title "<t>" --body <file> --team CTD --project "<app>" --assignee me --parent <parent key> --blocked-by K1,K2`, title and body verbatim from `plan.md`, blockers the keys the ticket's line names.

**On Trello** (alden-portal): every card lands in Pipeline with the feature's label.

1. **The parent.** With `--parent <KEY>`, that card: rewrite its description whole, one line added pointing at `revisions/<KEY>/`. Otherwise `argus tracker create --title "<t>" --team AP --project "<feature label>" [--assignee <member id>]` — assignee only when the plan names one, else omitted for unassigned.
2. **The sub-cards**, in plan order: `argus tracker create --title "<t>" --body <file> --team AP --project "<feature label>" [--assignee <member id>] --parent <parent key> --blocked-by K1,K2` — `--parent` both writes the `Blocked by` line and appends the parent's one checklist item; nothing to build by hand.

**The record**, either provider: `argus revision file <slug> <KEY> --tickets K1,K2,… --url <parent url>`; the directory takes the key's name. Then replace the slug with the key in each spec's `revised_by` and `retired by` lines and in `plan.md`'s heading.

A create that fails stops the step: record nothing, say which tickets exist, and leave the draft for a retry.

## Finish

The parent's key and URL, each sub-issue's key and title in order with what blocks it, and the revision's directory. Every sentence a statement.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "They said sounds good, that's a yes" | It is an exit, not a decision. Name what changes on a no and ask again. |
| "I know this feature; the baseline can wait" | The revision edits the baseline. A criterion you did not read gets a new id, and the old one never retires. |
| "The plan is obvious; file after the spec" | The plan is what the user reads before tickets exist. Show it. |
| "I'll fix the body in Linear after filing" | `plan.md` is the record of what was filed. Edit it, show it, then file. |

## Red Flags

- A question without a guess, or more than one question in a message
- A restate, or an `intent.md`, below 95% confidence
- A file written, or a ticket filed, before that step's yes
- A reused id, or a new criterion that did not take `next_id`
- A ticket whose acceptance criteria cite no `S-n`
- An `argus` or `accio` call without `ARGUS_ROOT`

## Verification

- [ ] `argus validate` is clean, the revision included
- [ ] Every new criterion took an id from `next_id`; every removed one sits under `## Retired`
- [ ] Each sub-issue's body is its plan section verbatim, and its blockers match the list
- [ ] `argus revision show <KEY>` lists the tickets in plan order
- [ ] Each step's write is committed through `argus save`, first line `scope <slug|KEY>: <step>`, before the next step begins
