CREATE TABLE "foundry"."blueprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"steps" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blueprints_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "foundry"."jobs" ADD COLUMN "blueprint_id" uuid;--> statement-breakpoint
ALTER TABLE "foundry"."jobs" ADD COLUMN "blueprint" jsonb;--> statement-breakpoint
ALTER TABLE "foundry"."jobs" ADD CONSTRAINT "jobs_blueprint_id_blueprints_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "foundry"."blueprints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Seed the one blueprint the ticket describes (LIA-25): plan on the strongest
-- model, execute on the cheaper one, in one shared session. Idempotent on name.
INSERT INTO "foundry"."blueprints" ("name", "description", "steps") VALUES (
  'Plan → Execute',
  'Plan with Fable, then implement the plan with Sonnet in the same session.',
  '[
    {"name": "plan", "model": "fable", "prompt": "{{task}}\n\nExplore the relevant code and write a concrete implementation plan to ~/plan.md (outside /work — nothing there should change yet). List the files to touch, the existing functions to reuse, and every assumption you are making. Do not edit /work in this step."},
    {"name": "execute", "model": "sonnet", "prompt": "Implement the plan you just wrote in ~/plan.md, step by step. Verify with whatever the repo offers (typecheck, tests, build), then commit with a Conventional Commit subject and your assumptions in the body."}
  ]'::jsonb
) ON CONFLICT ("name") DO NOTHING;
