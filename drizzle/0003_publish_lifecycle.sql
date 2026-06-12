ALTER TABLE "reports" ADD COLUMN "published_document" jsonb;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "published_at" timestamp with time zone;