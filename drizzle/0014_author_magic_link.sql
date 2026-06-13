CREATE TABLE "author_verification_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "author_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "author_verification_tokens_token_hash_idx" ON "author_verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "author_verification_tokens_email_idx" ON "author_verification_tokens" USING btree ("email");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;