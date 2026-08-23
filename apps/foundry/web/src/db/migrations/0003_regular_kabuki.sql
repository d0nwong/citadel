-- Job ids move from 'job_000001'-style text to uuid. The old ids cannot be
-- cast, so the ledger is cleared first — dev-only history; anything that
-- mattered (the PRs) lives on the forge. Destructive, deliberately.
TRUNCATE "foundry"."job_logs", "foundry"."jobs";--> statement-breakpoint
ALTER TABLE "foundry"."job_logs" DROP CONSTRAINT "job_logs_job_id_jobs_id_fk";--> statement-breakpoint
ALTER TABLE "foundry"."jobs" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "foundry"."jobs" ALTER COLUMN "id" SET DATA TYPE uuid USING "id"::uuid;--> statement-breakpoint
ALTER TABLE "foundry"."job_logs" ALTER COLUMN "job_id" SET DATA TYPE uuid USING "job_id"::uuid;--> statement-breakpoint
ALTER TABLE "foundry"."jobs" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "foundry"."job_logs" ADD CONSTRAINT "job_logs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "foundry"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP SEQUENCE "foundry"."job_seq";
