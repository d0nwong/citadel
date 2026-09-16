-- CTD-233: the PR watcher's memory of the one CI rerun it spends per head
-- commit before a check follow-up (S-48) -- which head, and when, so a later
-- failure counts only if it finished after the rerun.
ALTER TABLE "foundry"."pr_watches" ADD COLUMN "rerun_sha" text;--> statement-breakpoint
ALTER TABLE "foundry"."pr_watches" ADD COLUMN "rerun_at" timestamp with time zone;
