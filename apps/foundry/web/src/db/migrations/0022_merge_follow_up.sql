ALTER TABLE "foundry"."pr_watches" ADD COLUMN "merged_base_sha" text;--> statement-breakpoint
-- Seeds "Merge base into branch" (CTD-214): the one step the PR watcher's merge
-- follow-up runs. The task names the base commit and the conflicted files;
-- forge-merge merges the base in, resolves each hunk only where both sides'
-- intent fits, verifies and commits -- or aborts and names the collision.
-- Fixed id (MERGE_BLUEPRINT_ID in features/blueprints/types.ts) so the watcher
-- finds it, and editable like any blueprint. A follow-up queued after the row
-- is deleted runs MERGE_BLUEPRINT_STEPS, the same list.
--
-- ON CONFLICT with no target covers both unique constraints, as in 0018.
INSERT INTO "foundry"."blueprints" ("id", "name", "description", "steps") VALUES
    ('5eeded00-0000-4000-8000-000000000007'::uuid, 'Merge base into branch', 'Merge the base branch into a conflicting PR branch and resolve each conflict keeping both sides'' intent — or stop and name the collision. What the PR watcher runs when a PR can no longer merge.',
     $steps$[{"name":"merge","model":"opus","effort":"high","prompt":"/forge-merge {{task}}"}]$steps$::jsonb)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Its v1 revision, marked `seed`, selected from the row (0018's shape).
INSERT INTO "foundry"."blueprint_revisions"
  ("blueprint_id", "version", "name", "description", "steps", "source", "note", "created_at")
SELECT b."id", b."version", b."name", b."description", b."steps", 'seed', 'Shipped with CTD-214.', b."created_at"
  FROM "foundry"."blueprints" b
 WHERE b."id" = '5eeded00-0000-4000-8000-000000000007'::uuid
ON CONFLICT DO NOTHING;
