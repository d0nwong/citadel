ALTER TABLE "foundry"."jobs" ADD COLUMN "step" text;--> statement-breakpoint
ALTER TABLE "foundry"."jobs" ADD COLUMN "token" text DEFAULT encode(gen_random_bytes(24), 'hex') NOT NULL;--> statement-breakpoint
ALTER TABLE "foundry"."jobs" ADD COLUMN "container" text;--> statement-breakpoint
ALTER TABLE "foundry"."jobs" ADD COLUMN "workspace" text;--> statement-breakpoint
ALTER TABLE "foundry"."jobs" ADD COLUMN "pr_url" text;