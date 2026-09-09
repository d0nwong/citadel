# style — how the loop writes for a reader

The rules for every file the loop writes for a human to read: `digests/<day>.md`
(`slack-digest`) and `reports/<day>.md` (`sweep` step 8). Those skills keep their
skeletons and their machine contracts; the prose and layout rules live here, once. The
rules are Notion's documentation practice (summary first, descriptive headings, callouts
for what must not be missed, tables for repeated rows, short paragraphs, link instead of
restate) trimmed to what Pensieve's renderer can show — the files are read rendered, not
in a terminal.

What renders (`@tanstack/markdown`, in Pensieve): headings, bullets, tables, blockquotes
(a muted, left-bordered block — the callout), bold, links, inline code, checkboxes. What
does not: `<details>` toggles (printed as text), and a line break inside a bullet — an
indented line straight under a bullet is joined onto it as one paragraph. Every rule
below follows from those two facts.

## Summary first

The first line after the title is one plain sentence in italics saying what the day
amounted to. Pensieve shows the file's first non-heading line as its lede, so this is
what the index card reads. After a blank line comes the stamp (`_Last updated …_` in a
digest, `_Tick …_` in a report) — its own paragraph, or the renderer joins it onto the
summary. Then a TL;DR callout:

```markdown
> **TL;DR**
> - <what was decided, ≤ 15 words>
> - <what needs the reader, ≤ 15 words>
> - <what is blocked, ≤ 15 words>
```

At most three bullets. Rewritten in full every run, never appended to, never read by a
script.

## Headings

Sentence case, descriptive, the section emoji kept as its icon (`## 🔴 Decisions`, not
`## 🔴 Decisions & Conclusions`). H2 for sections; H3 only for the report's per-tick
blocks. No H3 inside a digest section — a card is the unit there, not a sub-heading. An
italic one-line note under a heading only where the section's purpose is not obvious
from its name; the digest's End-of-day pointer is the model, Needs you needs none.

## The card

The one item shape for digest items and for the report's Decide / Verify / Confirm
bullets:

```markdown
1. **<headline, ≤ 12 words: the conclusion, or the ask>**

    <detail, one paragraph ≤ 30 words: the one fact needed to act>

    _<source: HH:MM · author · feature · [thread](permalink) · [LIA-xx](url) → LIA-xx>_
```

- **The blank lines are the shape.** Without them the renderer joins the three parts
  into one paragraph, which is exactly the run-on the card replaces.
- **Digest cards are numbered, per section.** `1.` restarts under every heading, so
  "decision 4" and "the third action item" are things a reader can say; the number is
  for pointing while reading, never an id — a backfilled item renumbers what follows,
  and the source line's stamp and permalink stay the identity. Continuation lines sit
  four spaces in — three is enough under `1.` but not under `10.`, and the item
  silently falls out of the list — so four, always. The
  report's Needs-you cards stay `- ` bullets: `points.ts` parses that prefix.
- **The headline carries nothing but the headline.** No stamp, no tag, no link. In the
  report's Needs you it also carries the `points.ts` contract: `— <ask> · <age>`.
- **Everything machine-read lives on the source line** — stamp, feature, thread link,
  ticket link, ` → LIA-xx` marker — and the source line survives every rewrite verbatim.
  A ticket-pass writeback appends to it; a rewritten item keeps it.
- **The detail is optional; the source line is not** (digest). Report cards have no
  source line — nothing on Slack backs them — so a ticket, PR or journal link goes in the
  detail.
- A digest card's ` → LIA-xx` marker sits at the end of the source line; the digest's
  `([LIA-xx](url))` link, when the thread concerns an open ticket, sits before it.

One digest item, before and after:

```markdown
- **Rollover credits apply at the invoice total, not per project** — 09:30 · Sam O [admin/invoicing] (AI huddle notes) [huddle](…)
  Sam raised both options; total-level was agreed as the clearer read for the client.
```

```markdown
3. **Rollover credits apply at the invoice total, not per project**

    Sam raised both options; total-level was agreed as the clearer read for the client.

    _09:30 · Sam O · admin/invoicing · [huddle notes](…)_
```

## One-liners

On hold, Housekeeping and Audit bullets stay single lines, no card: `subject → waits on
X`, a count, a file and a kind. `points.ts` inserts its Housekeeping count after the
group's last `- ` line, so a card there would be split in two.

## Tables

For repeated structured rows — Done-today landings, Linear today — not for decisions
(long cells, and every link crammed into one narrow column). Column headers in sentence
case. A cell is a phrase, never a sentence with a full stop. Links in cells say what they
are (`journal`, `LIA-133`, `fe#408`), never "here" or "link".

## Callouts

A blockquote is a callout, and there are two allowed: the TL;DR, and at most one
`> **Watch out:**` per file for a live break or an irreversible thing. Nothing else is a
blockquote — a callout on every section is no callout at all.

## Sentences

Short, present tense, active, one thought each. At most one dash per sentence; a full
stop is usually better. "You" for the reader; people by first name after their first
full mention. Write the conclusion ("rollover applies at the invoice total"), never the
activity ("there was a discussion about rollover").

## Literals

Backticks only for an identifier that must be exact: a field, a route, a sha, a file, a
frontmatter value. Feature names, ticket keys, PR numbers and people are plain text —
`admin/invoicing` is a folder in a path and plain "invoicing" in a sentence. Most of the
visual noise in a dense digest is backticks on things that did not need them.

## Lists

Bullets for unordered items; numbers for a sequence, and for digest cards (above, so a
reader can point at one). Items in parallel form (all
fragments, or all sentences). A lead-in sentence when the heading does not already say
what the list is.

## Link, don't restate

The journal entry holds the why, the docs hold the rules, the ticket holds the scope,
the diff holds the code. The digest and the report hold conclusions and link to the
rest. A card that retells any of them has stopped being a card.

## Budgets

Hard constraints, not preferences: a digest ≤ 1,500 words for a full day and ≤ 40 per
item; a report ≤ 1,200. A card whose detail passes ~40 words is carrying one of three
things that live elsewhere — history (the file is committed every run, so `git log -p`
has it), code you verified (the journal entry or arch doc), or ticket scope (the
ticket). For calibration: 2026-08-26 was 550 words, 2026-08-28 1,280, and 2026-09-01
hit 8,809 and had to be rewritten.

## Considered and rejected

- `<details>` toggles for long sections — the renderer prints them as text.
- Checkboxes on ✋ action items — a disabled box nobody can tick; the ` → LIA-xx` marker
  is the item's state.
- A table per digest section — long cells wrap badly and links end up in a narrow
  column; the card keeps the headline scannable and the fact readable.

## Calibration

`digests/2026-09-07.md` and `reports/2026-09-07.md` are the reference: the same day's
content, reformatted to these rules.
