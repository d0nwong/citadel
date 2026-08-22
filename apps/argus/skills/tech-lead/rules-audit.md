# Rules audit — check the business logic against the code

> Reference file for the `tech-lead` skill. **Not a routable skill and not user-invoked** —
> handed to a freshly spawned subagent by tech-lead's "Auditing the rules docs" step.

You are checking one feature's **rules doc** (business logic — what *should* happen) against
what the code actually does. Your output is **a report returned to the parent agent** — do
NOT edit the rules doc, `base.md`, or any other file. The parent proposes changes to the
user and applies them with their approval.

This audit has already proven itself: run by hand against `tasks`, it found three real
errors in a 218-line rulebook that had been cited as authority for months.

## Inputs

You are given a project name. From `<project>/project.yaml` read:

- `rules:` — the rules doc path(s), relative to `repos[0].path`
- `repos[0].path` — the checkout to read
- `components:` — the `does:`/`files:` mapping, so you know which files enforce what

Then read, in this order:

1. The **rules doc** in full. It is short; the whole point is per-rule verification.
2. `<project>/data-flow.md`, if present — it already carries the rule→enforcement join for
   the fields it covers, and is **authoritative**. A rule it confirms needs no re-derivation.
3. Only the component files a rule actually turns on.

## Method

For each **numbered** rule, classify it:

| Verdict | Meaning |
| --- | --- |
| **Holds** | the code does what the rule says — report only the count, not each one |
| **Contradicted** | the code does something else. Quote both, cite `file:line` |
| **Unreachable** | the rule describes a state the UI cannot reach |
| **Unimplemented** | the rule describes behaviour no code provides |
| **Undocumented** | the code enforces a rule the doc does not mention at all |

**Report the last four. Never enumerate the ones that hold** — a report that lists 40
holding rules buries the four that matter.

## Rules of evidence

**Cite `file:line` for every contradiction.** A contradiction without a line reference is a
guess, and the parent cannot act on it.

**A rules doc is not wrong just because it is old.** Check whether the rule was *superseded*
by an intentional change or *drifted* by an unintentional one — the fix differs. If a "Fixed
since this document was first written" section exists, read it before reporting.

**Do not judge the code by the rules doc.** Either side can be the bug. Report the
contradiction and say which you think is wrong and why; the user decides.

**Numbering is the citation key.** Other docs cite rules as `§5`, `§7.2`. If a rule has no
number, say so — an uncitable rule cannot be audited by anyone else either.

**Stay out of implementation.** "The rule is enforced in the wrong hook" is not your finding
unless it makes the rule behave differently than written. You audit behaviour, not design.

## Return format

Return in your final message, and nothing else:

### 1. Summary
`N rules checked · N hold · N contradicted · N unreachable · N unimplemented · N undocumented`

### 2. Findings
```
- rule: §<n> — <the rule, quoted>
  verdict: Contradicted | Unreachable | Unimplemented | Undocumented
  code: <what the code actually does> (<file:line>)
  wrong side: rules doc | code
  proposed fix: <the rule as it should read — or "the code should change, not the doc">
```

### 3. Confidence
One line naming anything you could not settle and what would settle it.

Zero findings is a valid outcome — say so plainly rather than padding.
