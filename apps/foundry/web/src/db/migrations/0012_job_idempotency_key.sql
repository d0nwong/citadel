ALTER TABLE "foundry"."jobs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "foundry"."jobs" ADD COLUMN "idempotency_fingerprint" text;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_key_unique" ON "foundry"."jobs" USING btree ("idempotency_key");