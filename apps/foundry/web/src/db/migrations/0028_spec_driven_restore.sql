-- CTD-278 follow-up: "Spec Driven Development" back to what 0020 tuned it to.
--
-- CTD-283 routes every ticket-driven job here, so a row that had run 11 times
-- in 90 days now carries the ~76 that "Plan → Execute" and the bare `"none"`
-- job used to. It was worth reading before that traffic arrived.
--
-- The build step has never carried the clause 0020 added for CTD-186: that
-- migration was authored 2026-09-13 07:19 and this row already had a `user`
-- revision from 05:51 the same day, so its guard skipped it and has skipped it
-- ever since. The clause was never lost here; it never arrived.
--
-- That clause is the one with a measurement behind it: job 918fa9d9's build
-- step spent its first 3½ minutes re-reading the runner and the files the spec
-- step had already read in the same resumed session. The clause is what tells
-- it the session is warm. Restoring it is the cheapest thing available to the
-- jobs CTD-283 just redirected.
--
-- The spec step goes back to fable/high for a reason CTD-282 supplied: since
-- that ticket, `forge-spec` binds acceptance criteria a person approved and
-- never authors a requirement. Binding is reading — locate each criterion in
-- code, attach the commands — so it wants effort, not the most expensive model
-- with none set.
--
-- 0008's rule is that a migration improves only a seed nobody has saved, and
-- both changed versions here are `source = 'user'`. Liam asked for this one
-- explicitly, so it fires against his row — but only against the exact steps
-- read from the database while writing it. Any further edit and the WHERE
-- matches nothing and this is a no-op, which is also what makes a rerun safe.
-- v4 stays in `blueprint_revisions`: Restore v4 in the blueprint editor brings
-- it back as a new version.
WITH "updated" AS (
    UPDATE "foundry"."blueprints"
       SET "steps" = $steps$[{"name":"spec","model":"fable","effort":"high","prompt":"/forge-spec {{task}}"},{"name":"build","model":"sonnet","prompt":"/forge-test for the criteria in ~/spec.md; the runner, the files each criterion touches and the base state are already in this session from the spec step — start from them and read only what is new; once the tests are seen red, implement them to green in this same step per ~/.claude/skills/forge-implement/SKILL.md, and end with both Finishes, the tests' first"},{"name":"verify","model":"opus","effort":"medium","prompt":"/forge-verify the change against ~/spec.md"}]$steps$::jsonb,
           "version" = "version" + 1,
           "updated_at" = now()
     WHERE "id" = '5eeded00-0000-4000-8000-000000000003'::uuid
       AND "steps" = $old$[{"name":"spec","model":"opus","prompt":"/forge-spec {{task}}"},{"name":"build","model":"sonnet","prompt":"/forge-test for the criteria in ~/spec.md; once they are seen red, implement them to green in this same step per ~/.claude/skills/forge-implement/SKILL.md, and end with both Finishes, the tests' first"},{"name":"verify","model":"opus","effort":"medium","prompt":"/forge-verify the change against ~/spec.md"}]$old$::jsonb
    RETURNING "id", "version", "name", "description", "steps"
)
INSERT INTO "foundry"."blueprint_revisions"
  ("blueprint_id", "version", "name", "description", "steps", "source", "note", "created_at")
SELECT "id", "version", "name", "description", "steps", 'seed', 'CTD-278: restored 0020''s warm-session clause and fable/high spec step before CTD-283''s traffic arrived.', now()
  FROM "updated";
