CREATE SCHEMA "foundry";
--> statement-breakpoint
CREATE TYPE "foundry"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "foundry"."log_stream" AS ENUM('sys', 'out', 'tool', 'err');--> statement-breakpoint
CREATE SEQUENCE "foundry"."job_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "foundry"."job_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"t" timestamp with time zone DEFAULT now() NOT NULL,
	"stream" "foundry"."log_stream" NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foundry"."jobs" (
	"id" text PRIMARY KEY DEFAULT 'job_' || to_char(nextval('foundry.job_seq'), 'FM000000') NOT NULL,
	"task" text NOT NULL,
	"repo_id" uuid,
	"repo" jsonb NOT NULL,
	"base_branch" text NOT NULL,
	"branch" text NOT NULL,
	"forge" text NOT NULL,
	"status" "foundry"."job_status" DEFAULT 'queued' NOT NULL,
	"worktree" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"exit_code" integer,
	"diff_files" integer,
	"diff_additions" integer,
	"diff_deletions" integer
);
--> statement-breakpoint
CREATE TABLE "foundry"."repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path" text NOT NULL,
	"name" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repos_path_unique" UNIQUE("path")
);
--> statement-breakpoint
ALTER TABLE "foundry"."job_logs" ADD CONSTRAINT "job_logs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "foundry"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foundry"."jobs" ADD CONSTRAINT "jobs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "foundry"."repos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_logs_job_id_idx" ON "foundry"."job_logs" USING btree ("job_id","id");--> statement-breakpoint
CREATE INDEX "jobs_created_at_idx" ON "foundry"."jobs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "foundry"."jobs" USING btree ("status");