# Rules doc — template and conventions

> Reference file for the `project-manager` skill. A **rules doc** is the business-logic
> record for a feature: what *should* happen, independent of how it is built.

## Where it lives

**Next to the code, not in the workspace.** Register the path in `project.yaml`:

```yaml
rules:
  - src/features/tasks/components/task-detail/FIELD-RULES.md   # relative to repos[0].path
```

This is deliberate. Developers change rules in the same commit they change the component;
a workspace copy becomes a third source of truth and drifts worse than the original. The
system brings it under management by **auditing** it, not by owning the file — see
tech-lead's "Auditing the rules docs".

The working example is `alden-portal-fe/src/features/tasks/components/task-detail/FIELD-RULES.md`.

## What belongs in it

Business logic only — a rule a product person could confirm or deny without reading code:

- the **modes** a surface can be in, and what each one changes
- what is **required, optional, or hidden** in each mode
- **gating**: what blocks submit, and in what precedence
- **cross-field effects**: changing X clears/refills Y
- **known rough edges**: rules that are wrong, unreachable, or unimplemented

## What does NOT belong in it

- Component names, hook names, file paths, endpoints — that is `base.md`, `api.md` and
  `data-flow.md`. A rules doc that names `useTaskDetailForm` has become a tech doc.
- How a rule is enforced. *"Priority is editable on drafts only"* is a rule;
  `readOnly={!isDraft || readOnly}` is the enforcement and belongs in `data-flow.md`.

The join between a rule and its enforcement lives in `data-flow.md`. That is what makes
drift findable — keep the two docs separate and let the join carry the mapping.

## Shape

```markdown
# <Surface> — <thing> rulebook

## 1. The mode axes
The independent states this surface can be in, and the derived states they produce.
Every rule below is a function of these — define them first.

## 2..N. <Surface area, in render order>
One section per region a user sees. Per field: what it is, when it shows, when it is
editable, what it defaults to.

## Cross-field effects
Changing X does Y. The cascades. This is where most real bugs live.

## Gating
What blocks the primary action, in precedence order.

## Known rough edges
Rules that are wrong, unreachable, or contradicted by the code. Number them so other
docs can cite them (`§7.2`). This section is why the audit is worth running.
```

Number the sections. `COMPONENTS.md`, `base.md` and `data-flow.md` all cite rules by
section (`FIELD-RULES §5`, `§199`), and unnumbered rules cannot be cited or audited.

## Maintaining it

- A rule change is a **product decision** — journal it (`type: decision`) with the why.
- The doc is append-friendly but not append-only: correct a wrong rule in place, and note
  the correction in "Fixed since this document was first written".
- When the audit reports a rule the code contradicts, decide which one is wrong. Either
  answer is legitimate — the code may be the bug — but say which, do not leave both.
