CREATE TABLE "skeletons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"schema_version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "skeletons_name_idx" ON "skeletons" USING btree ("name");