-- Seeds "Spec → QA" (CTD-65): five steps, each one line invoking a /forge-* skill
-- the forge image ships -- spec the ticket, plan it, write the tests red, implement
-- to green, verify and report. The skills hold the instructions, so the prompts
-- here stay short and the blueprint improves by rebuilding the image, not by a
-- migration. Fixed id (QA_BLUEPRINT_ID in features/blueprints/types.ts), so the
-- store test can find it by identity and a second run cannot mint a duplicate.
-- Not the ignite default: "Plan → Execute" keeps that.
--
-- ON CONFLICT with no target covers both unique constraints: the id on a rerun,
-- and the name where someone hand-made a "Spec → QA" first -- theirs stays.
INSERT INTO "foundry"."blueprints" ("id", "name", "description", "steps") VALUES
    ('5eeded00-0000-4000-8000-000000000003'::uuid, 'Spec → QA', 'Spec the ticket, test the spec, implement to green, verify and report — the QA default for a ticket with acceptance criteria.',
     $steps$[{"name":"spec","model":"fable","effort":"high","prompt":"/forge-spec {{task}}"},{"name":"plan","model":"fable","effort":"high","prompt":"/forge-plan for the spec at ~/spec.md"},{"name":"test","model":"sonnet","prompt":"/forge-test for the criteria in ~/spec.md"},{"name":"implement","model":"sonnet","prompt":"/forge-implement the plan at ~/plan.md"},{"name":"verify","model":"opus","effort":"medium","prompt":"/forge-verify the change against ~/spec.md"}]$steps$::jsonb)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Its v1 revision, marked `seed` so a later migration may still improve it in
-- place until the first user save (0008's rule). Selected from the row rather
-- than written twice, so the two can never disagree -- and so nothing is
-- inserted when the row above was skipped for a hand-made namesake, which
-- would otherwise fail the foreign key. The primary key makes a rerun a no-op.
INSERT INTO "foundry"."blueprint_revisions"
  ("blueprint_id", "version", "name", "description", "steps", "source", "note", "created_at")
SELECT b."id", b."version", b."name", b."description", b."steps", 'seed', 'Shipped with CTD-65.', b."created_at"
  FROM "foundry"."blueprints" b
 WHERE b."id" = '5eeded00-0000-4000-8000-000000000003'::uuid
ON CONFLICT DO NOTHING;
