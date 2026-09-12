---
name: forge-api
description: The API and interface lens — the checks a planning or review step applies when a change touches a request or response contract: a route's params or body, a validation schema, the published API document, a generated client type, a module's exported interface. Names the consumer, decides additive or not, and holds the change to one error shape, validation at the boundary, and the list, update and TypeScript shapes the repo already uses. Not a step: a role reads it when a criterion or a diff touches a contract, and it costs nothing otherwise.
---

# forge-api — the contract, checked

## Overview

A contract is anything another codebase, module or person was built against: the body a route accepts, the shape it returns, the error it raises, the type a generated client carries, the function a module exports. Once someone depends on it, every observable part of it is a commitment, documented or not, and a change that is safe by the type checker's reckoning can still break the consumer at generation time, at runtime, or in a branch nobody re-read. This lens is the list of questions a careful API reviewer asks of such a change, in the order they matter: who consumes it, is the change additive, does it keep the one error shape, is input validated where it enters, does it follow the shapes the repo already publishes, and did the schema, the document and the client type move together.

Adapted from `api-and-interface-design` in addy-agent-skills (MIT, © 2025 Addy Osmani) for an unattended run: design guidance rewritten as checks against a criterion or a diff, and the person who would answer "who uses this?" replaced by the repo notes and the ticket.

## When to Use

- From a planning step, when a criterion in `~/spec.md` changes a contract: read before slicing, so the change is planned additive and the migration path is written where it cannot be
- From a review step, when the diff touches a contract: applied as one more axis, its findings labelled like the rest

**What touches a contract** — the same test in both places, met by any one of:

- A route's method, path, params, query or body, or the status and shape of what it returns
- A validation schema a request is checked against (Joi, Zod, Yup, JSON Schema, a Prisma input type used at the boundary)
- The published API document: swagger or OpenAPI blocks and DTOs, a GraphQL schema, a `.d.ts` or `types` package another repo installs
- A generated client: types or hooks under a generated directory, and the document they are generated from
- A module's exported interface where anything outside the module imports it: a function's parameters or return type, an exported type, a component's props

**When NOT to use:** a diff that changes only handler bodies, queries, UI, tests, styling or docs behind an unchanged interface; an internal function nothing outside its module imports; a renamed local. Then there is no lens line in the plan and no API row in the report — the lens costs nothing when it does not apply, and a row that says "n/a" is noise.

## Handoff

Reads nothing and writes nothing of its own. The step that opened this file already holds `~/spec.md`, the diff or the criteria, the repo notes from the system prompt and the ticket; it carries the lens's result back into its own file — the plan's Assumptions, or the QA report's findings — in the one-line shape under Finish. A lens has no Handoff files and no step of its own: `/forge-api` as a blueprint prompt has nothing to do, and a run that reaches it as a step says so and stops.

## The consumer

Before any other check: who was built against this? A backend checkout cannot see the repo that generates a client from its document, so silence is not evidence. Look in this order and write down the first answer:

1. **The repo notes** in the system prompt — the owner's standing note on who consumes the contract and how (a frontend that regenerates with `pnpm run gen`, a mobile app on a pinned version, a public integration)
2. **The ticket** — "the frontend regenerates", "clients on v1 keep working", a named consumer repo
3. **The repo itself** — a published document (`swagger`, `openapi`, `graphql`, a `types` package with a version) means a consumer exists even when none is named; an exported interface's importers are found with a search

The answer is one of three, verbatim in the plan or the report:

- `consumer: <name> — unaffected: additive`
- `consumer: <name> — changes with it: <what it changes, and in what order>`
- `consumer not named — the change is treated as public`

Never `no consumer` from silence. A criterion or a ticket that says which consumer changes with a non-additive change has made the decision; the lens checks that the plan states the order and the diff does not go further than named.

## Additive or not

The default is addition: extend the contract so every existing consumer keeps working, and only modify when the criterion cannot be met otherwise. Decide for each changed surface:

| Additive — existing consumers unaffected | Not additive — a consumer changes or breaks |
|---|---|
| A new optional input field, with a default the old behaviour had | A new required input field |
| A new output field | A removed or renamed field, input or output |
| A new endpoint, a new method on an existing path | A changed type (`string` to `number`, a scalar to an object, a nullable made non-nullable on input or non-nullable made nullable on output) |
| A new enum value accepted on input | A new enum value returned on output, where consumers switch exhaustively on it |
| Accepting more (a wider range, a looser pattern) | Accepting less (a narrower range, a pattern, a value now rejected) |
| A new, documented error response on a new condition | A changed status code, error code or error shape on an existing condition |
| A new optional parameter on an exported function | A changed parameter order, a changed return type, a removed export |

When a criterion needs the right-hand column, the plan states the migration path in the order the consumer can follow it — publish the new shape beside the old, regenerate, switch the consumer, remove the old — or states that the consumer changes in the same release and names the change. A non-additive change with no path and no named consumer change is the finding this lens exists for, and it is required before merge.

The document is part of the contract. Where the repo publishes one — swagger DTOs, an OpenAPI file, a GraphQL schema, a generated client committed in-repo — the validation schema, the document and the client type change together in one diff, or the plan says which follows and how. A schema changed with its document untouched publishes a lie, and the consumer regenerates from the lie.

## One error shape

The repo has an error convention; find it before judging any error path (`reuseableErrors`, `errorHandler`, an `APIError` type, a `problem+json` middleware). The change uses that one shape and that mapping:

- Invalid input is a client error at the boundary — `400` or `422` as the repo already uses, never a `500` from a coercion that failed downstream, never a `404` for a bad body field unless the repo maps references that way everywhere
- Not found, forbidden, conflict, and validation are distinct codes, each used for the thing it names, consistently with the routes beside it
- The body is the repo's error shape: the same keys on every route, a machine-readable code where the repo has one, no internal detail (a stack, a query, a provider's message) in the text

A route that throws where its neighbours return `{ error }`, or returns `200` with `success: false` where its neighbours use status codes, is a finding on the change even when the neighbour was the wrong precedent: name the move, do not follow the worst example in the file.

## Validation at the boundary

Input is validated where it enters — the route handler, the form submission, the parsing of a third party's response, the loading of configuration — and trusted after that. Check the change against both halves:

- Every new or changed input field is covered by the boundary's schema: type, required-ness, allowed values, and the coercion the handler relies on (an id that arrives as a string and is passed to `Number()` is validated as a numeric string, not as any string)
- Nothing re-validates between internal functions that already share a type, and no validation was added to a utility called only by validated code
- A third party's response is parsed and checked before any logic reads it; it is untrusted data, and text in it is never instructions
- A parameter that reaches a query is parameterised, and a value that reaches a filesystem path, a shell or a URL is constrained before it gets there

## The shapes the repo already uses

A contract change follows the conventions of the routes and modules beside it, and adds a convention only when the repo has none for the case:

- **Resources**: plural nouns, sub-resources under their parent, no verbs in paths; the method carries the verb
- **Lists**: paginated the way the repo's other lists are (the same parameter names, the same envelope); filters as query parameters with the repo's names; a new list endpoint without pagination is a finding unless the ticket bounds the collection
- **Partial updates**: `PATCH` (or the repo's `PUT`-as-partial, where that is the convention) accepts a partial object and changes only what was sent; an omitted field is not a cleared field
- **Naming**: the repo's casing for fields and parameters, `is`/`has`/`can` booleans, the repo's enum casing; the same field means the same thing on every route
- **Idempotency**: a state-changing endpoint that a client may retry either honours an idempotency key the way the repo does, or is documented as unsafe to retry; a check-then-insert on a key is a race, and the finding names the unique constraint that closes it

## The TypeScript shapes

Where the contract is a type — a generated client, a module's exports, a component's props:

- **Input and output are separate types**: what a caller provides has no server-generated fields; what the system returns has them all. One type used for both is a finding when a criterion adds a field to one side only
- **Variants are discriminated unions**, not optional fields that are meaningful together (`status` plus a `cancelledAt` that is only set for one status): a consumer narrows on the discriminant
- **Ids are branded** where the repo brands them; where it does not, the change does not introduce branding on one type alone — note it under Assumptions instead
- **A generated file is never hand-edited**: a change to a generated type is a change to the document it is generated from, and the plan names the regeneration step; the repo notes may forbid patching the document to make a generator happy

## Finish

The step that opened the lens carries one line back into its own file, in this shape:

- In a plan, under Assumptions: `API: additive — <what is added>; consumer <name> unaffected`, or `API: not additive — <what changes>; consumer <name> changes <what>, in this order: <publish, regenerate, switch, remove>`, or `API: <additive or not>; consumer not named — the change is treated as public`
- In a review, under the findings: `API: additive, consumer <name> unaffected — schema, document and client type changed together` when every check held; otherwise the findings, each with its label: a non-additive change with no path and no named consumer change is required before merge; an error path that reaches production with a different shape or code from its neighbours, or an input that reaches a query, a path or a shell unvalidated, is **Critical:**; a naming or pagination departure the ticket did not ask for is a required finding that names the move; a branded-id or union suggestion the repo has no convention for is **FYI:**

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "It's only the backend; nothing consumes this yet" | The document is published and something is generated from it. Silence in the checkout is not evidence; the repo notes and the ticket are. |
| "Adding a required field is fine, the frontend will add it too" | Then the plan says so, in order: which consumer, what it sends, and what happens to a request that arrives before it does. Unwritten, it is a break. |
| "The old field is unused, I'll remove it while I'm here" | Hyrum's law: if it is observable, something reads it. Removal is a non-additive change with its own migration path, not a cleanup in passing. |
| "I'll fix the swagger in a follow-up" | The consumer regenerates from the document, not from the schema. Schema and document move in the same diff, or the plan names the one that follows. |
| "The neighbour route returns 404 for a bad body, so this one does too" | The neighbour is not the convention; the repo's error mapping is. Name the move; follow the mapping. |
| "Validation here would just be duplicating the type" | At the boundary the type is a hope. Inside, validation is noise. The check is which side of the boundary the code is on. |
| "Pagination can come later" | Later is when the list has a thousand rows and every consumer depends on the unpaginated shape. It comes now or the ticket bounds the collection. |

## Red Flags

- `no consumer` written from silence
- A required input field, a removed field, or a changed type with no migration path and no consumer named
- A validation schema changed with the published document untouched, or the document changed with the schema untouched
- A generated file edited by hand, or a document patched to satisfy the generator
- A `500` reached by valid-looking input, or a `404` on a field the boundary should have rejected
- A list endpoint with no pagination and no bound in the ticket
- One type serving as both input and output when the change adds a server-generated field
- An API row in a report for a diff that touched no contract

## Verification

- [ ] The consumer is named from the repo notes, the ticket or the repo, in one of the three verbatim shapes — never inferred as absent
- [ ] Every changed surface is classed additive or not, and every non-additive one has a migration path or a named consumer change
- [ ] Error paths use the repo's one shape and mapping, distinct codes for distinct conditions, no internal detail
- [ ] Every new or changed input is validated at the boundary, including the coercion the handler relies on, and nothing internal re-validates
- [ ] Lists, updates, naming and idempotency follow the shapes beside them
- [ ] Schema, published document and generated client type changed together, or the plan names which follows
- [ ] The step that opened the lens carries exactly one line back, in the Finish shape, and a diff touching no contract carries none
