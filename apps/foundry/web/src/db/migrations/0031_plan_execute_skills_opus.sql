-- CTD-285 on this host: "Plan → Execute" runs the forge's own skills, keeping
-- opus on the plan step.
--
-- 0030 carried the change but could not apply it here: this row holds a `user`
-- revision, and 0008's rule is that a migration improves only a seed nobody has
-- saved. 0030's own comment says as much and leaves the row to Liam. This is
-- that application, written as a migration so the history carries it the way it
-- carries 0028 and 0029 rather than living only in the blueprint editor.
--
-- One deliberate difference from 0030: the plan step stays on **opus**, where
-- Liam's v2 put it, rather than moving to the fable/high 0030 names. 0030 was
-- drafted before that question was settled for the spec step in 0029, and the
-- reasoning is the same here. "Plan → Execute" is, since CTD-283, the default
-- only for a job with instructions and no ticket — the case with no approved
-- criteria at all — so the plan step is the only thing standing between a bare
-- task and an implement step that follows it slice by slice. Its mistakes are
-- inherited whole. The prompts change; the model does not.
--
-- Matches only the exact steps read from this database while writing it, so it
-- is a no-op on a row edited since and safe to rerun. v2 stays in
-- `blueprint_revisions`: Restore v2 in the blueprint editor brings it back.
WITH "updated" AS (
    UPDATE "foundry"."blueprints"
       SET "steps" = $steps$[{"name":"plan","model":"opus","effort":"high","prompt":"/forge-plan {{task}}"},{"name":"implement","model":"sonnet","prompt":"/forge-implement the plan at ~/plan.md"}]$steps$::jsonb,
           "version" = "version" + 1,
           "updated_at" = now()
     WHERE "id" = '5eeded00-0000-4000-8000-000000000001'::uuid
       AND "steps" = $old$[{"name":"plan","model":"opus","effort":"high","prompt":"Plan this task before any of it is written:\n\n{{task}}\n\nRead the code first — the files this touches, how the repo already solves the same shape of problem, the conventions it follows. Then write the plan as your final message: the change in one paragraph, the files to touch and what changes in each, the order to do it in, how to verify it, and every decision the task left open that you had to make yourself.\n\nKeep the plan to what this task needs — no speculative refactors, no adjacent cleanups. If the task cannot be done as asked, say what blocks it and plan the closest thing that can.\n\nDo not edit, create, or delete any file in this step. The next step implements this plan in the same session, so everything you read now carries over."},{"name":"execute","model":"sonnet","prompt":"Now implement the plan you just wrote, in full.\n\nFollow the repo conventions you found over any general habit — its naming, its comment density, its idioms. Verify the way the plan said to: run the build, the type check, the tests it named, and fix what you break.\n\nIf the plan turns out to be wrong once you are in the code, correct course and say so in your final message rather than forcing it through. If part of it is blocked, finish every other part and state plainly what you left out and why.\n\nFinish with completed edits in /work and a final message covering what changed, what you assumed, and how you verified it."}]$old$::jsonb
    RETURNING "id", "version", "name", "description", "steps"
)
INSERT INTO "foundry"."blueprint_revisions"
  ("blueprint_id", "version", "name", "description", "steps", "source", "note", "created_at")
SELECT "id", "version", "name", "description", "steps", 'seed', 'CTD-285: the steps invoke /forge-plan and /forge-implement; the plan step stays on opus.', now()
  FROM "updated";
