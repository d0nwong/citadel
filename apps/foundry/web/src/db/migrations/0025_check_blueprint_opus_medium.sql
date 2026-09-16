-- CTD-233: "Fix failing check" moves to opus/medium (S-49) -- a check
-- follow-up now only fires on a second failure of a head commit, after a
-- plain CI rerun has already had its chance, so less rides on the first
-- red check's judgement. Only touches the row while it still holds exactly
-- what 0018 seeded; if Liam edited its steps since, his steps stand, and
-- the CTE's UPDATE matches no row, so nothing here fires.
WITH "updated" AS (
    UPDATE "foundry"."blueprints"
       SET "steps" = $steps$[{"name":"debug","model":"opus","effort":"medium","prompt":"/forge-debug {{task}}"}]$steps$::jsonb,
           "version" = "version" + 1,
           "updated_at" = now()
     WHERE "id" = '5eeded00-0000-4000-8000-000000000006'::uuid
       AND "steps" = $old$[{"name":"debug","model":"fable","effort":"high","prompt":"/forge-debug {{task}}"}]$old$::jsonb
    RETURNING "id", "version", "name", "description", "steps"
)
INSERT INTO "foundry"."blueprint_revisions"
  ("blueprint_id", "version", "name", "description", "steps", "source", "note", "created_at")
SELECT "id", "version", "name", "description", "steps", 'seed', 'Moved to opus/medium with CTD-233.', now()
  FROM "updated";
