# flows

Citadel's core flows as interactive maps, one tab each: who does each step, what it reads and writes, and the rule it keeps. Click a box for its detail.

```sh
bun run --filter flows dev     # http://localhost:3779 (PORT overrides)
bun run --filter flows build   # static site in dist/
bun run --filter flows test    # every flow's arrows and details are whole
```

Vite, React 19 and `@xyflow/react`; no server. A flow opens at `#/<id>`.

## Adding a flow

A flow is data. Write `src/flows/<id>.ts` exporting a `Flow` (`src/model.ts`): its boxes, each with a position, an actor and the words for its panel, and the arrows between them. Then list it in `src/flows/index.ts`. `source` names what the flow draws, e.g. `apps/argus/skills/scope/`; when that changes, change the flow with it.

- **Kinds.** `step` (someone acts), `gate` (your explicit yes), `file` and `source` (a file written or read), and the layout-only `phase` (a heading) and `rule` (a dashed divider).
- **Actors** carry the colours; the legend shows only the ones a flow's steps use. `labels` renames one for a flow, as `/scope` calls Claude the "/scope skill".
- **Arrows** leave from the bottom and arrive at the top unless `out` and `in` name a side. `dashed` is for a loop, a read or a side exit.
- **Layout.** Positions are in pixels; steps are 260 wide, gates 200 and files 280. `scope.ts` uses three columns per phase, 360 apart.
