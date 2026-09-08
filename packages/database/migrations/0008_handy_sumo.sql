ALTER TABLE "reports" ADD COLUMN "ciphertext_hash" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "researcher_object_key" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "researcher_ciphertext_hash" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "researcher_key_id" text;