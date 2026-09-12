DROP INDEX "foundry"."jobs_ticket_id_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_ticket_id_unique" ON "foundry"."jobs" USING btree ("ticket_id") WHERE status <> 'cancelled';