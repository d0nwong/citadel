---
name: forge-api
description: The API and interface lens, the checks a planning or review step applies when a change touches a contract (a route's params or body, a validation schema, the published API document, a generated client type, a module's exported interface): who consumes it, additive or not, one error shape, validation at the boundary. Use when a criterion or a diff touches a contract; not a step of its own.
---

# forge-api — the contract, checked

## Overview

Once someone depends on a contract, every observable part of it is a commitment, and a change the type checker accepts can still break the consumer at generation time. These are the questions a careful API reviewer asks, in the order they matter. Adapted from `api-and-interface-design` in addy-agent-skills (MIT, © 2025 Addy Osmani): design guidance rewritten as checks against a criterion or a diff.

## When to Use

- From a planning step, when a criterion changes a contract: before slicing
- From a review step, when the diff touches one: as one more axis

**What touches a contract**: a route's method, path, params, query, body, status or response shape; a validation schema at a boundary; the published document (swagger or OpenAPI blocks and DTOs, a GraphQL schema, a `types` package); a generated client and the document it comes from; an exported function, type or component prop something outside the module imports.

**When NOT to use:** a diff that changes only handler bodies, queries, UI, tests or docs behind an unchanged interface. Then no line in the plan and no row in the report.

## Handoff

Reads and writes nothing of its own. The step that opened it holds the spec, the diff, the repo notes and the ticket, and carries one line back into its own file in the shape under Finish. Never a blueprint step; `/forge-api` as a prompt has nothing to do.

## The consumer

Who was built against this? A backend checkout cannot see the repo that generates a client from its document, so silence is not evidence. In order: the repo notes in the system prompt; the ticket; the repo itself (a published document means a consumer exists; an export's importers are found with a search). Write one of:

- `consumer: <name> — unaffected: additive`
- `consumer: <name> — changes with it: <what, in what order>`
- `consumer not named — the change is treated as public`

Never `no consumer` from silence.

## Additive or not

Extend so every existing consumer keeps working; modify only when the criterion cannot be met otherwise.

| Additive | Not additive |
|---|---|
| A new optional input field with the old behaviour as default; a new output field; a new endpoint | A new required input field; a removed or renamed field |
| A new enum value accepted on input; accepting more | A changed type or nullability; a new enum value on output that consumers switch on; accepting less |
| A new, documented error on a new condition | A changed status code, error code or error shape on an existing condition |
| A new optional parameter on an export | A changed parameter order or return type; a removed export |

A non-additive change needs the migration path in the order the consumer can follow (publish beside the old, regenerate, switch, remove), or the ticket naming the consumer change in the same release. Without either it is the finding this lens exists for, required before merge.

The document is part of the contract: the validation schema, the published document and the generated client type change in one diff, or the plan names which follows. A generated file is never hand-edited, and the document is never patched to satisfy the generator.

## One error shape

Find the repo's error convention before judging an error path. Invalid input is a client error at the boundary, never a 500 from a downstream coercion; not found, forbidden, conflict and validation use distinct codes consistently with the routes beside them; the body is the repo's shape, no internal detail. A neighbour that does it wrong is not the convention: name the move.

## Validation at the boundary

Every new or changed input is covered by the boundary's schema, including the coercion the handler relies on (an id passed to `Number()` is validated as a numeric string). Nothing re-validates between internal functions sharing a type. A third party's response is checked before any logic reads it. A value reaching a query, a path, a shell or a URL is constrained first.

## The shapes the repo already uses

Plural nouns, sub-resources under their parent, the method as the verb. Lists paginated and filtered the way the repo's other lists are; a new unpaginated list is a finding unless the ticket bounds it. Partial updates change only what was sent. The repo's casing and boolean prefixes; the same field means the same thing on every route. A retryable state change honours an idempotency key the repo's way or is documented unsafe to retry; a check-then-insert on a key is a race.

Where the contract is a type: input and output are separate types; variants are discriminated unions, not co-dependent optional fields; ids are branded only where the repo brands them.

## Finish

One line, carried back by the step that opened the lens:

- In a plan, under Assumptions: `API: additive — <what>; consumer <name> unaffected`, or `API: not additive — <what>; consumer <name> changes <what>, in this order: <…>`
- In a review, under the findings: `API: additive, consumer <name> unaffected — schema, document and client changed together`, or the findings with labels: a non-additive change with no path is required before merge; an unvalidated input reaching a query, path or shell, or an error path shipping a different shape from its neighbours, is **Critical:**

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "It's only the backend; nothing consumes this yet" | The document is published and something generates from it. The notes and the ticket are the evidence, not the checkout's silence. |
| "The old field is unused, I'll remove it while I'm here" | If it is observable, something reads it. Removal has its own migration path. |
| "I'll fix the swagger in a follow-up" | The consumer regenerates from the document, not the schema. Same diff. |

## Red Flags

- `no consumer` written from silence
- A required field, a removal or a type change with no migration path and no consumer named
- A schema changed with the document untouched, or a generated file edited by hand
- An API row for a diff that touched no contract

## Verification

- [ ] The consumer is named in one of the three shapes, never inferred as absent
- [ ] Every changed surface is classed additive or not; every non-additive one has a path or a named consumer change
- [ ] Error paths, boundary validation and the repo's shapes checked; schema, document and client changed together
- [ ] Exactly one line carried back, and none for a diff touching no contract
