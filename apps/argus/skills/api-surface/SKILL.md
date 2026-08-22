---
name: api-surface
description: "Investigate which backend endpoints an alden-portal feature actually uses, and classify each of its backend-shaped todos as Exists / Partial / Missing. Designed to run in a subagent spawned by the project-manager skill: it returns a verdict as text for the parent agent to curate and apply. It never edits todos.md, project.yaml, or api.md. Not user-invoked — spawned by project-manager."
---

# API Surface — investigate and classify

You are investigating one alden-portal feature project against the backend API contract.
Your output is **a verdict returned to the parent agent** — do NOT edit `todos.md`,
`project.yaml`, `api.md`, or any other file. The parent proposes changes to the user and
applies them with their approval.

The backend is owned by another team. The question you exist to answer, for every vague
"backend changes" todo, is: **is this frontend work, or a backend ask?**

## Inputs

You are given a project name. Its folder is under
`alden/alden-portal/features/` (some are nested, e.g. `admin/signals`). Read:

- `alden/alden-portal/features/COMPONENTS.md` — the routing table; grep it first when the
  question names a UI element rather than a project
- `project.yaml` — the `api:` block (selectors) and `repos:` (whether code exists)
- `todos.md` — the todos you are classifying
- `api.md` — the generated endpoint surface
- `base.md` / the product spec — only the sections a todo actually touches

## Method

1. **Regenerate first** so you are not reading a stale surface:
   `accio sync --project <name>` (add `--offline` to skip the fetch).
2. **Read `api.md`'s `## Index` table** before the per-endpoint detail. Drop into the detail
   only for endpoints a todo actually turns on.
3. **For code-backed projects** (`repos:` non-empty, `api.sources` set), `api.md` lists the
   file that makes each call. Open two or three and confirm the attribution is real.
4. **Verify every unmatched URL literal** by opening its file — see the traps below.
5. **Classify each backend-shaped todo** — anything mentioning a backend, an endpoint, an
   owning team, storage, or persistence:

| Verdict | Evidence | What it means |
| --- | --- | --- |
| **Exists** | endpoint present in `api.md` | frontend work; wire it up |
| **Partial** | adjacent endpoints exist, the specific one does not | a seam — name the exact missing endpoint |
| **Missing** | nothing in the tag group, or `api.md` says *No endpoints* | backend ask; not the frontend's to unblock |

6. **Also report available-but-unused endpoints** — an operation in the project's tag group
   that no code calls. It is either a capability the UI has not adopted, or a wrong
   selector. Say which you think it is.

## Traps — all previously measured, do not re-derive

**The scanner does not strip comments.** Unmatched URL literals are *candidates*, never
findings. Both such hits in `tasks` were spurious: `/api/v1/dashboard/clientReviews` sits on
a commented-out line, and `/api/v1/dashboard` is a react-query `queryKey` prefix, not a
call. Open the file before reporting one.

**`api.md` is component-first in calls mode.** Each component carries its `does:` line,
its files, and the operations it calls, labelled `(direct)` or `(indirect — N hops)`.
Direct calls are the component's own contract; indirect ones are usually cache-invalidation
fan-out. Do not report an indirect call as a component's responsibility without checking.

**A component reporting "Calls nothing" is a finding, not an empty section.** For `lib/`
modules it verifies the purity `base.md` asserts. If a component you *expect* to call
something reports nothing, its `files:` globs are probably wrong.

**Attribution stops at 2 import hops** (`--attribution-depth`). Unbounded reachability
attributes the shared axios client's `POST /auth/refresh` and every dashboard invalidation
query to every component. Measured: depth 1 is too narrow, 2 and 3 are identical.

**Heavy fan-out means real coupling, not a tool artefact.** In `tasks`, everything routed
through `src/hooks/dashboard/use-dashboard-widgets.ts` inherits all its dashboard queries,
because that module bundles every dashboard query and the task mutations together. Report
it as coupling; don't try to filter it away.

**`does:` must name the USER-VISIBLE thing.** People search for "status select", not for
`status-controls`. A `does:` describing internals ("hydration, formReady,
reset-with-keepDirtyValues") is unsearchable; one reading "the status badge / status select
on task and subtask rows — the dropdown you change a task's status from" is found on the
first grep. This single rule is what makes `COMPONENTS.md` work as a routing table.

**Match the generated HOOK, not just the base function.** Components consume
`useGetApiV1ProjectsEntityEntityId`, not `getApiV1ProjectsEntityEntityId` — the hook
capitalises the method after `use`. A method alternation that only accepts lowercase makes
every hook call invisible. This was a real miss: fixing it took `tasks` from 43 to 60
operations and `dashboard` from 20 to 34.

**Search summaries, not just path names.** The credential *reveal* endpoint is
`GET /catalogueApps/{id}/credentials` — no path-name search for "reveal" finds it. This
already produced one wrong "missing" verdict.

**The generated orval client is 21 operations behind the spec** (448 of 469). A capability
with a spec entry but no generated function is *client drift*, not a missing endpoint.

**Two caveats to carry into every verdict:** this is the **dev** deployment, so it can lead
or lag prod; and request schemas are generated from Joi, so shapes are reliable but response
nullability is not, and only ~148 of 469 operations declare `security` at all. Say so when a
verdict rests on either.

**Never conclude "missing" from a zero-result grep alone.** Check the tag group in `api.md`,
then the full spec at `.state/openapi.json`, then say what you searched.

## What does not qualify

- Todos with no backend dimension — leave them alone entirely.
- Restating what `api.md` already says. The verdict is the judgment, not the endpoint dump.
- Generalising one todo's answer into a project-wide convention the user never made.

## Return format

Return in your final message, and nothing else:

### 1. Verdicts

For each backend-shaped todo:

```
- todo: <the todo line, quoted as it appears>
  verdict: Exists | Partial | Missing
  endpoint: <METHOD /path — or the exact endpoint that does NOT exist>
  evidence: <where you looked; the calling file for code-backed projects>
  proposed rewrite: <the todo as it should now read — or "close it">
```

### 2. Available but unused

One line per endpoint, each labelled `unadopted capability` or `wrong selector`. Say
`none` if there are none.

### 3. Selector problems

Anything in the `api:` block that looks wrong — a tag group that misses an obvious
resource, a `sources` glob matching nothing. Say `none` if clean.

### 4. Confidence

One line naming anything you could not settle and what would settle it.

Zero verdicts is a valid outcome — say so plainly rather than padding.
