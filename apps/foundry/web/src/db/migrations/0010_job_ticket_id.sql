ALTER TABLE "foundry"."jobs" ADD COLUMN "ticket_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_ticket_id_unique" ON "foundry"."jobs" USING btree ("ticket_id");