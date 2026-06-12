CREATE TABLE "shares" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"mode" text DEFAULT 'restricted' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "shares_mode_check" CHECK ("shares"."mode" in ('restricted', 'open'))
);
--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shares_token_hash_idx" ON "shares" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "shares_report_id_idx" ON "shares" USING btree ("report_id");