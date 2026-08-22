---
name: tech-lead
description: "Own the technical record for an alden-portal feature — how the business logic is implemented: architecture and shape in base.md, the generated endpoint surface in api.md, the curated field flows in data-flow.md, and the api: selectors in project.yaml. Also audits the product-owned rules doc against the code and reports contradictions. Use when writing or reviewing a technical spec, deciding how a feature should be structured, wiring up a new project's API surface, maintaining these docs at wrap-up, or answering whether a todo is frontend work or a backend ask. For a fast one-command 'which API backs this component' lookup, use api-lookup instead."
---

# Tech Lead — the technical record

You own four artefacts per feature. The project-manager skill owns the session lifecycle
and the product record (`context.md`, `todos.md`, `journal.md`, the product spec) and calls
into this skill at defined points; it does not own anything below.

| Artefact | Nature | Rule |
| --- | --- | --- |
| `base.md` | curated | how the business logic is implemented — shape, gaps, reading order. Template: [base-template.md](./base-template.md) |
| `api.md` | **generated** | never hand-edited; wrong contents mean wrong selectors |
| `data-flow.md` | **hand-written** | never generated; how each field is populated and why |
| `project.yaml` `api:` | curated | the selectors that decide what lands in `api.md` |

The **rules doc** (`project.yaml` `rules:`) is *not* yours — project-manager owns the
business logic. You **audit** it against the code and report; you never edit it. That
boundary is the point: the doc that says what should happen and the doc that says what does
happen must be written by different hands, or drift is invisible.

Run in the **main thread**. Two jobs are delegated to subagents — todo verdicts (§Verdicts)
and the rules audit (§Auditing the rules docs) — because each reads a long doc in full plus
the code behind it.

---

## Which skill answers which question

Three skills touch the API and they are not interchangeable:

| Question | Skill | Where it runs |
| --- | --- | --- |
| "where does the status select get its data?" | **`api-lookup`** | main thread, one command |
| "how should this feature be structured?" | **this skill** | main thread |
| "is this backend todo still open?" | **this skill → §Verdicts** | fresh subagent |

Never spawn a subagent for a lookup — `accio "<subject>"` returns in about a second, and a
subagent's cold context makes it slower, not faster.

---

## The contract

Several alden-portal features are frontend-only: the backend is built and owned by another
team, and its OpenAPI spec at
<https://dev-alden-portal.uc.r.appspot.com/api-docs/> is the only contract.

`<project>/api.md` is generated from that spec by `accio sync`, driven by the `api:` block
in the project's `project.yaml` (tag and/or path-glob selectors).

```
accio sync               # fetch, diff, regenerate every api.md
accio sync --offline     # use the cached spec (no network)
accio sync --check       # report only; exits 1 if the spec moved
accio sync --project tasks
```

**Generated docs are branch-dependent.** Calls-mode analysis reads the frontend checkout,
so a different branch gives different answers — the generated header stamps the revision it
was built from. Regenerate after switching branches rather than trusting a stale file.

---

## Wiring up a new project's API surface

Invoked from project-manager's project-creation flow. Ask whether the feature has shipped
code or is spec-only:

- **Code exists** → add an `api:` block to `project.yaml` with `sources:` (repo-relative
  globs for the feature's own files) and `tags:`. Give each component `does:` and `files:`.
  `does:` must name the **user-visible** thing — "the status select", not
  "status-controls" — because that is what people grep for.
- **Spec-only** → `api:` with `tags:` alone. An empty tag group is a legitimate answer and
  documents that the backend is unbuilt.

Then run `accio sync` and check the op count is plausible. `API-DOCS-PLAN.md` has the
procedure and the measured traps.

---

## Maintaining the docs at wrap-up

Invoked from project-manager's wrap-up, for projects with an `api:` block.

### 1. Regenerate and read the drift report

Run **`accio sync`** (add `--offline` to skip the network). It rewrites every `api.md`,
refreshes `COMPONENTS.md` and the symbol index, and audits `data-flow.md` against what the
code actually calls.

Use the full run at wrap-up, not `--project <name>`: a scoped run deliberately skips
`COMPONENTS.md` and the symbol index so it cannot clobber them with a one-feature view,
which would leave lookup stale for every other feature.

A `⚠ data-flow drift` line means the prose names an endpoint nothing calls any more — the
curated doc is now wrong. **Fix the prose, never the check.** Surface it to the user with
the correction you propose.

### 2. Capture what the session learned into `data-flow.md`

This is how the curated layer grows — from real questions, not a doc-writing project. Ask:

- Did answering an API question this session require *reading code* because `accio` only
  routed you to files? Then that answer belongs in `<project>/data-flow.md`.
- Did the verdicts subagent return a proposed entry? Same.

Draft the entry keyed by the symbol `accio` indexes (`## taskPriority`), with `aka:` for the
words the user actually used — that is what closes the UI-word / API-word gap. Give `reads:`
and `writes:` separately so sync can audit them. **Write only what cannot be generated**:
where the value comes from, what it was normalised to, the conditions, the why. Never
restate the endpoint list `api.md` already carries.

Propose the entry and add it with the user's agreement. Zero entries is a fine outcome —
most sessions do not learn anything durable about a field.

### 3. Audit the rules docs

Only when the session changed a component that a rules doc covers, or when the rules doc
itself changed. See §Auditing the rules docs. Skip it on projects with no `rules:` key —
and say so, because the absence is itself a finding worth surfacing once.

### 4. Reconcile backend-shaped todos

Only when the session touched backend-shaped todos or `.state/last-api-sync.md` shows the
spec moved. See §Verdicts.

**Un-mapped features are the common case.** Six of eight have no component attribution yet.
If the session worked in one, offer to map it — `api.sources` plus `does:`/`files:` per
component — rather than silently accepting a routing-only answer.

---

## Verdicts — delegated to a subagent

Spawn it **fresh, not a fork.** This work needs the project's files, not the conversation;
a fork would drag the session in for nothing.

Use the `Agent` tool with a prompt of this shape:

> Read `skills/tech-lead/verdicts.md` and follow it: return verdicts for `<project>`.
> Session decisions bearing on this: `<any decision made this session that changes whether
> a todo is still live — e.g. "we are dropping the reassignment flow">`, or "none".

**That second line is load-bearing.** The subagent starts cold and cannot see the session.
Without it, a flow you decided to delete this session comes back classified "Exists — close
it", because the code is still there. Carry the decisions; do not rely on catching it during
curation.

**Curate the returned verdicts as an editor.** Reject any that restate what `api.md` already
says, or that generalise one todo's answer into a convention the user never made. Check that
no "Missing" verdict rests on a path-name search alone.

**Propose the surviving rewrites to the user and apply them with their agreement.** Never
silently retitle a todo the user hasn't seen. Fold selector problems the subagent reports
into the same proposal — those are `project.yaml` edits.

---

## Auditing the rules docs

The rules doc states what *should* happen; the code decides what does. Nothing keeps them
aligned on its own — `tasks`' rulebook was cited as authority by `COMPONENTS.md` while
three of its rules were wrong. This is that check, made routine.

Spawn **fresh, not a fork** — it needs the rules doc and the code, not the conversation:

> Read `skills/tech-lead/rules-audit.md` and follow it: audit the rules doc(s) for
> `<project>`.

**Curate the findings as an editor.** Reject any that judge design rather than behaviour, or
that rest on a contradiction with no `file:line`. For each survivor the question is *which
side is wrong* — the doc may be describing intent the code failed to implement, in which
case the fix is a todo, not a doc edit.

**Propose, never apply silently.** Rules-doc edits change the product record and belong to
project-manager; hand the corrections over rather than writing them yourself. A rule the
code contradicts is a decision the user has to make, not a typo you can fix.

---

## File conventions

- **`base.md`** — the curated design narrative: the shape of the system, the constraints
  that must survive, the known gaps, and where to start reading. Update only deliberately,
  never automatically; sync flags contradictions as proposed diffs for approval
- **`api.md`** — GENERATED from the backend team's OpenAPI spec; never hand-edited. Wrong
  contents mean wrong selectors — fix `project.yaml`'s `api:` block and regenerate
- **`data-flow.md`** — HAND-WRITTEN and never generated: how each field is populated, what
  it was normalised to, and why. Keyed by symbols `accio` indexes. Its `reads:`/`writes:`
  lines are audited against the code by `accio sync`, which reports drift every run
- **the rules doc** (`project.yaml` `rules:`) — product's, not yours. Audit it, cite it by
  section number, never edit it. See §Auditing the rules docs
- **`project.yaml`** — the `api:` selectors (`tags:` / `paths:` / `exclude:`) that decide
  what lands in `api.md`, plus the component vocabulary journal entries tag from
