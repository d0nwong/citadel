# scope-flow

The `/scope` flow as an interactive map: a ramble through the interview, intent, specs and plan to a filed revision, then each sub-issue through Foundry, and the sweep's fold into the feature's live `docs/spec.md`. Click a box for what it reads, what it writes and the rule it keeps.

```sh
bun run --filter scope-flow dev     # http://localhost:3779 (PORT overrides)
bun run --filter scope-flow build   # static site in dist/
bun run --filter scope-flow test    # the map's links and details are whole
```

Vite, React 19 and `@xyflow/react`; no server. The map is data: `src/flow.ts` holds every box, its position and its words, and every arrow. The skill it draws is `apps/argus/skills/scope/`; when that changes, change `flow.ts` with it.
