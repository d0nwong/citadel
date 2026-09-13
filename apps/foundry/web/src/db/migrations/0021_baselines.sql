-- The base state of a commit (CTD-187): install, suite and typecheck as the
-- runner's pre-step measured them on the untouched checkout, kept by repo and
-- sha for every later job on the same base. `jobs.base_sha` is the key half the
-- events handler needs when the container posts one.
CREATE TABLE "foundry"."baselines" (
	"repo" text NOT NULL,
	"base_sha" text NOT NULL,
	"body" text NOT NULL,
	"job_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "baselines_repo_base_sha_pk" PRIMARY KEY("repo","base_sha")
);
--> statement-breakpoint
ALTER TABLE "foundry"."jobs" ADD COLUMN "base_sha" text;