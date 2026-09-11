# Plan: citadel, step 1

Spec: `docs/spec/consolidation.md`. Intent: `docs/intent/monorepo.md`.

## Overview

Import the three histories, make one Bun workspace, split argus's code from its data, replace the
bash dispatchers with just, then build the compose stack one service at a time. The sweep comes
last and stays off until cutover, because only one sweep may ever write. The two riskiest
unknowns are checked first so a bad answer can still change the plan.

## Architecture decisions

- **Data stays in `d0nwong/argus`** for step 1. citadel holds code only. The sweep container
  clones the data repo into the `argus-data` volume, and Pensieve mounts the same volume.
- **`ARGUS_ROOT` is the data seam.** It already exists in `scripts/argus/paths.ts`, and step 1
  extends it to `accio`. Pensieve keeps `WORKSPACE_DIR` for the data and gains the argus code
  path, so it can spawn `bun <argus>/scripts/argus.ts` with `ARGUS_ROOT=$WORKSPACE_DIR`.
- **Ask's working directory becomes `apps/argus`**, where the skills, CLAUDE.md and `.mcp.json`
  live. It reaches the data through the verbs, with `ARGUS_ROOT` set.
- **One `.env` at the root.** Foundry's `ARGUS_ENV`, Pensieve's `argus-env.sh` and the
  `~/.config/liamai/env` fallback all go away.
- **The sweep service sits behind a compose profile** (`--profile sweep`), so `just up` never
  starts a second writer by accident.
- **Tags:** Foundry's are already `foundry-v*`, the component form release-please uses. Pensieve
  has none. argus's one tag, `pre-rebuild`, becomes `argus-pre-rebuild`.
- **foundry-web mounts the host's `~/git` at the same absolute path,** because Foundry stores
  tracked repos and `--mount` forges as host paths (found in T2).

## Dependency graph

```
T1 headersHelper spike ─┐            T2 foundry-web prod spike ─┐
                        │                                       │
T3 import foundry+pensieve ── T4 import argus ── T5 workspace ──┤
                                                   │            │
               ┌───────────────┬──────────────────┤            │
          T6 ARGUS_ROOT   T8 one .env        T16 release-please, T17 CI
               │               │
          T7 pensieve split    │
               └──────┬────────┘
                 T9 just: env recipes ── T10 just: stack recipes
                                              │
                 T11 mcp+postgres ── T12 foundry-web (T2) ── T13 pensieve (T7)
                                                                  │
                                                  T14 sweep image+service (T1)
                                                                  │
                                                  T15 docs and paths ── T18 cutover ── T19 archive
```

## Phases and checkpoints

1. **De-risk (T1, T2).** These two spikes decide the open questions and can run in parallel.
2. **One repo (T3–T5).** Checkpoint A: histories are in place and `bun run --filter '*'
   typecheck` and `test` pass. Review before pushing citadel.
3. **Seams (T6–T8).** The code works against a data directory it doesn't live in, and one
   `.env` feeds everything.
4. **Ops (T9, T10).** just replaces every bash dispatcher.
5. **Stack (T11–T14).** Checkpoint B, after T13: the stack runs without the sweep, and the
   smoke test passes. Review before building the sweep.
6. **Release, CI, docs (T15–T17).** Checkpoint C: success criteria 1–4 and 6 are met.
7. **Cutover (T18, T19).** Ask before each step. Success criterion 5 is met after 24 hours.

## Parallel work

- T1 and T2 at any time.
- T6, T8 and T16/T17 once T5 lands.
- T12 and T13 once T11 lands, if T2 and T7 are done.

T3 → T4 → T5 must run in order, because they rewrite the same history.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| headersHelper doesn't run under `claude -p` (untrusted folder) | High: the sweep and Ask lose Slack/Linear MCP | T1 checks first; the fallback is pre-trusting the folder in the image's `~/.claude.json` |
| Two sweeps write the data repo | High: conflicting commits, a rewound cursor | Compose profile, the `flock`, and cutover stops the host loop first |
| The mounted `docker.sock` is root-equivalent on the host | Medium: fine locally, not for a deploy | Accepted for step 1; noted in the spec for the deploy review |
| Pensieve's spawn and Ask paths break after the split | Medium | T7 has its own tests; `ask.test.ts` already exercises git over `WORKSPACE_DIR` |
| filter-repo drops a code file whose history ran through a data path | Low | T4 checks with a diff of `git ls-files` against the argus checkout's code paths |
| `setup-token` OAuth token expires | Low | `just check` reports its age; `just auth claude` renews it |
| Forges made with `--mount DIR` get a container path | Low | Document that `--mount` takes a host path; named-volume forges are unaffected |

## Open questions

None that block the plan. T1 and T2 answer the spec's two open questions, and the plan changes
only if T1 fails and pre-trusting the folder doesn't work either.
