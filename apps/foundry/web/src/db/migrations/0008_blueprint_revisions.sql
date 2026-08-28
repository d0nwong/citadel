CREATE TYPE "foundry"."revision_source" AS ENUM('seed', 'user');--> statement-breakpoint
CREATE TABLE "foundry"."blueprint_revisions" (
	"blueprint_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"steps" jsonb NOT NULL,
	"source" "foundry"."revision_source" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blueprint_revisions_blueprint_id_version_pk" PRIMARY KEY("blueprint_id","version")
);
--> statement-breakpoint
ALTER TABLE "foundry"."blueprints" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "foundry"."blueprint_revisions" ADD CONSTRAINT "blueprint_revisions_blueprint_id_blueprints_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "foundry"."blueprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Backfill: every blueprint that already exists becomes its own v1, so the
-- history is never missing the version its row claims to be at.
--
-- `source` decides who owns the row from here on. A seeded blueprint nobody has
-- touched stays 'seed' and a later migration may still improve it in place;
-- everything else is 'user' and is off limits to migrations for good. Untouched
-- is `updated_at = created_at` exactly -- both default to now() in one INSERT,
-- and updateBlueprint always writes updated_at -- which is a sharper test than
-- comparing content, and needs no copy of the seed text here.
INSERT INTO "foundry"."blueprint_revisions"
  ("blueprint_id", "version", "name", "description", "steps", "source", "note", "created_at")
SELECT
  b."id", b."version", b."name", b."description", b."steps",
  CASE
    WHEN b."id" IN (
      '5eeded00-0000-4000-8000-000000000001'::uuid,
      '5eeded00-0000-4000-8000-000000000002'::uuid
    ) AND b."updated_at" = b."created_at" THEN 'seed'
    ELSE 'user'
  END::"foundry"."revision_source",
  'Recorded when blueprints became versioned.',
  b."created_at"
FROM "foundry"."blueprints" b
ON CONFLICT DO NOTHING;
