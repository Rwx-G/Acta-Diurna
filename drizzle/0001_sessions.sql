CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"realm" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "sessions_realm_check" CHECK ("sessions"."realm" in ('author', 'reader'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_idx" ON "sessions" USING btree ("token_hash");