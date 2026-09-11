-- Seeds the two blueprints foundry ships with: "Plan → Execute" -- the one the
-- ignite dialog preselects (DEFAULT_BLUEPRINT_ID in features/blueprints/types.ts) --
-- and "Backfill Tests". Their ids are fixed, so the default is chosen by identity
-- rather than by a name the user stays free to change, and so re-running this
-- migration cannot mint duplicates.
--
-- The wrinkle is that "Plan → Execute" was documented before it was shipped, so an
-- existing database may already hold a hand-made row under that name -- and `name`
-- is unique, which would make a plain INSERT either fail or silently skip the row
-- the default resolves to. Adopt it instead: move it aside, insert the canonical
-- row, repoint the jobs that ran it, and drop the original. Those jobs keep their
-- own `blueprint` snapshot throughout; only the id link moves, and it moves to the
-- blueprint they were in fact run from, under a different id.
DO $migration$
DECLARE
  superseded uuid;
BEGIN
  SELECT "id" INTO superseded
    FROM "foundry"."blueprints"
   WHERE "name" = 'Plan → Execute' AND "id" <> '5eeded00-0000-4000-8000-000000000001'::uuid;

  IF superseded IS NOT NULL THEN
    UPDATE "foundry"."blueprints" SET "name" = "name" || ' (superseded)' WHERE "id" = superseded;
  END IF;

  -- ON CONFLICT with no target covers every unique constraint on the table: a
  -- second run of this migration, and a "Backfill Tests" someone got to first.
  -- Edits and deletions survive too -- nothing here overwrites an existing row.
  INSERT INTO "foundry"."blueprints" ("id", "name", "description", "steps") VALUES
      ('5eeded00-0000-4000-8000-000000000001'::uuid, 'Plan → Execute', 'Explore and plan on one model, implement on another — the default for a new job.',
       $steps$[{"name":"plan","model":"fable","effort":"high","prompt":"Plan this task before any of it is written:\n\n{{task}}\n\nRead the code first — the files this touches, how the repo already solves the same shape of problem, the conventions it follows. Then write the plan as your final message: the change in one paragraph, the files to touch and what changes in each, the order to do it in, how to verify it, and every decision the task left open that you had to make yourself.\n\nKeep the plan to what this task needs — no speculative refactors, no adjacent cleanups. If the task cannot be done as asked, say what blocks it and plan the closest thing that can.\n\nDo not edit, create, or delete any file in this step. The next step implements this plan in the same session, so everything you read now carries over."},{"name":"execute","model":"sonnet","prompt":"Now implement the plan you just wrote, in full.\n\nFollow the repo conventions you found over any general habit — its naming, its comment density, its idioms. Verify the way the plan said to: run the build, the type check, the tests it named, and fix what you break.\n\nIf the plan turns out to be wrong once you are in the code, correct course and say so in your final message rather than forcing it through. If part of it is blocked, finish every other part and state plainly what you left out and why.\n\nFinish with completed edits in /work and a final message covering what changed, what you assumed, and how you verified it."}]$steps$::jsonb),
      ('5eeded00-0000-4000-8000-000000000002'::uuid, 'Backfill Tests', 'Characterise existing behaviour, test it, and prove the tests bite — production code untouched.',
       $steps$[{"name":"survey","model":"fable","effort":"high","prompt":"Work out what to test, before writing a single test:\n\n{{task}}\n\nThis is about code that already exists. Read it and describe what it actually does — every branch, the error paths, the boundary values, what it does with empty, missing, and malformed input. Note behaviour that looks wrong, but do not change it: these tests pin down the code as it is, and a real bug belongs in your final message for a human to decide on.\n\nThen find the repo test setup already in place: the runner and the exact command that invokes it, where tests live, how they are named, the fixtures, factories, and helpers on hand, and how the nearest similar code is tested here. Match all of it — do not introduce a new framework, a new assertion style, or a new directory.\n\nFinish with a test plan as your final message: the cases you will write, grouped by the unit under test, and the command that runs them. Do not edit, create, or delete any file in this step."},{"name":"write-tests","model":"sonnet","prompt":"Write the tests from the plan you just made, using the runner, layout, and helpers you found.\n\nTest behaviour through the public surface rather than private internals, and name each test for the behaviour it pins down. Cover the branches and boundaries you listed, not only the happy path.\n\nRun the suite and get it green. If a test fails because the code under test is genuinely wrong, leave that code alone: mark the test skipped or pending with a one-line comment saying what it exposes, and keep it for your final message. Every other failure is a bug in your test — fix the test.\n\nTouch test files, fixtures, and test config only. The logic under test does not change in this blueprint."},{"name":"verify","model":"sonnet","effort":"medium","prompt":"Check your own work before it becomes a PR.\n\nRun the full suite once more and confirm it passes. Then read `git status` and `git diff` and confirm you changed nothing outside tests, fixtures, and test config — revert anything else you find.\n\nRe-read each test you added and ask whether it would actually fail if the behaviour it names regressed. A test that passes against any implementation is worse than none: tighten it, or delete it and say so.\n\nFinish with a final message listing the behaviour now covered, whatever you deliberately left uncovered and why, and any bug these tests exposed but did not fix."}]$steps$::jsonb)
  ON CONFLICT DO NOTHING;

  IF superseded IS NOT NULL THEN
    UPDATE "foundry"."jobs" SET "blueprint_id" = '5eeded00-0000-4000-8000-000000000001'::uuid WHERE "blueprint_id" = superseded;
    DELETE FROM "foundry"."blueprints" WHERE "id" = superseded;
  END IF;
END
$migration$;
