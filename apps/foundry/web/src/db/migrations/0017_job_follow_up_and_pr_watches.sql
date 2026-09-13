CREATE TABLE "foundry"."pr_watches" (
	"pr_url" text PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"checked_sha" text,
	"follow_ups" integer DEFAULT 0 NOT NULL,
	"stopped" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "foundry"."jobs" ADD COLUMN "follow_up" text;--> statement-breakpoint
-- Every follow-up so far answered review comments (LIA-40): say so, so the
-- runner never has to guess a null on an old row.
UPDATE "foundry"."jobs" SET "follow_up" = 'review' WHERE "source_job_id" IS NOT NULL AND "follow_up" IS NULL;
