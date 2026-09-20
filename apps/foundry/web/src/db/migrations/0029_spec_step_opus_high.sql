-- CTD-278 follow-up to 0028: the spec step keeps opus, and gains the effort
-- 0028 should not have taken from it.
--
-- 0028 put the step back to the `fable`/`high` of the 0020 seed on the reading
-- that v4 was drift. It was not: v4 was set deliberately on 2026-09-20, and
-- opus is the better model for what that step now does. Since CTD-282 it binds
-- acceptance criteria a person approved — locate each in code, name the file
-- and symbol, attach the commands, block where nothing binds — and everything
-- downstream inherits its mistakes: forge-test asserts what it wrote and
-- forge-verify signs off against it. "Bug → Fix" already runs its spec step on
-- opus/high for the same reason.
--
-- What v4 was actually missing is `effort`. forge-run.sh omits `--effort`
-- entirely when the step does not set it (`:150`, `:179`), so the step ran at
-- the CLI's own default while every other think-first step in every blueprint
-- — "Bug → Fix", "Simplify", "Backfill Tests" — sets `high`.
--
-- 0028's warm-session clause on the build step stands and is not touched here.
-- Matches only the exact steps 0028 left behind, so it is a no-op on a row
-- edited since, and a rerun is safe.
WITH "updated" AS (
    UPDATE "foundry"."blueprints"
       SET "steps" = $steps$[{"name":"spec","model":"opus","effort":"high","prompt":"/forge-spec {{task}}"},{"name":"build","model":"sonnet","prompt":"/forge-test for the criteria in ~/spec.md; the runner, the files each criterion touches and the base state are already in this session from the spec step — start from them and read only what is new; once the tests are seen red, implement them to green in this same step per ~/.claude/skills/forge-implement/SKILL.md, and end with both Finishes, the tests' first"},{"name":"verify","model":"opus","effort":"medium","prompt":"/forge-verify the change against ~/spec.md"}]$steps$::jsonb,
           "version" = "version" + 1,
           "updated_at" = now()
     WHERE "id" = '5eeded00-0000-4000-8000-000000000003'::uuid
       AND "steps" = $old$[{"name":"spec","model":"fable","effort":"high","prompt":"/forge-spec {{task}}"},{"name":"build","model":"sonnet","prompt":"/forge-test for the criteria in ~/spec.md; the runner, the files each criterion touches and the base state are already in this session from the spec step — start from them and read only what is new; once the tests are seen red, implement them to green in this same step per ~/.claude/skills/forge-implement/SKILL.md, and end with both Finishes, the tests' first"},{"name":"verify","model":"opus","effort":"medium","prompt":"/forge-verify the change against ~/spec.md"}]$old$::jsonb
    RETURNING "id", "version", "name", "description", "steps"
)
INSERT INTO "foundry"."blueprint_revisions"
  ("blueprint_id", "version", "name", "description", "steps", "source", "note", "created_at")
SELECT "id", "version", "name", "description", "steps", 'seed', 'CTD-278: the spec step stays on opus and gains effort high.', now()
  FROM "updated";
