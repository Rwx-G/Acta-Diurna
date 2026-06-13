CREATE TABLE "authors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "data_sets" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "authors_email_idx" ON "authors" USING btree ("email");--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_owner_id_authors_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."authors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_sets" ADD CONSTRAINT "data_sets_owner_id_authors_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."authors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_owner_id_authors_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."authors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_tokens_owner_id_idx" ON "api_tokens" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "data_sets_owner_id_idx" ON "data_sets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "reports_owner_id_idx" ON "reports" USING btree ("owner_id");