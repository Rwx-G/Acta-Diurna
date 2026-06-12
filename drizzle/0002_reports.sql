CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"schema_version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_status_check" CHECK ("reports"."status" in ('draft', 'published'))
);
