# Replay scores

One line per run of `bun run evals`. The gate is attribution ≥ 80% with every closure case passing.
- 2026-09-10 15:28 deterministic: 26% (61/235), 0 chat wrongly placed, 477 unanswered
- 2026-09-10 15:28 deterministic: 45% (105/235), 0 chat wrongly placed, 477 unanswered
- 2026-09-10 16:06 deterministic: 19% (105/564), 0 chat wrongly placed, 0 unanswered
- 2026-09-10 16:06 deterministic: 19% (105/564), 0 chat wrongly placed, 0 unanswered
- 2026-09-10 16:10 deterministic: 19% (105/564), 0 chat wrongly placed, 0 unanswered
- 2026-09-10 16:24 model (2 days): 7% (40/564), 12 chat wrongly placed, 0 unanswered, closures 0/4, $5.69 over 6 calls, largest input 86276
- 2026-09-10 16:31 model (2 days): 65% (39/60), 11 chat wrongly placed, 0 unanswered, closures 0/4, $1.42 over 8 calls, largest input 23967
- 2026-09-10 16:33 deterministic: 19% (105/564), 0 chat wrongly placed, 0 unanswered
- 2026-09-10 16:35 model (2 days): 65% (39/60), 5 chat wrongly placed, 0 unanswered, closures 0/4, $1.08 over 7 calls, largest input 26389
- 2026-09-10 17:15 model: 85% (482/564), 16 chat wrongly placed, 0 unanswered, closures 2/4, $21.45 over 54 calls, largest input 72022
- 2026-09-11 model (14 days, rescored): attribution 85% (482/564), 16 chat wrongly placed, closures 4/4, $21.45 over 54 calls, 12 first-try refusals all but one recovered on retry
- 2026-09-25 11:18 model, suggest: 86% (487/564), 17 chat wrongly placed, 0 unanswered; suggestions: on-feature 0% (0/11), nothing 100% (85/85), 96 declined, high(on-feature 0% (0/9), nothing 100% (42/42)), low(on-feature 0% (0/2), nothing 100% (43/43)), jev jev-1.13.0 (thread alone)
- 2026-09-26 02:40 model, suggest: 84% (474/564), 16 chat wrongly placed, 0 unanswered; suggestions: on-feature 19% (3/16), nothing 92% (79/86), 102 declined, high(on-feature 0% (0/5), nothing 100% (63/63)), low(on-feature 27% (3/11), nothing 70% (16/23)), jev jev-1.13.0 (with up to 8 earlier channel messages)
