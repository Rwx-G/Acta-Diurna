CREATE TABLE "access_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reader_identity_id" uuid NOT NULL,
	"share_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reader_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reader_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"share_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"reader_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"share_id" uuid NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_records" ADD CONSTRAINT "access_records_reader_identity_id_reader_identities_id_fk" FOREIGN KEY ("reader_identity_id") REFERENCES "public"."reader_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_records" ADD CONSTRAINT "access_records_share_id_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_records" ADD CONSTRAINT "access_records_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_sessions" ADD CONSTRAINT "reader_sessions_share_id_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_sessions" ADD CONSTRAINT "reader_sessions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_sessions" ADD CONSTRAINT "reader_sessions_reader_identity_id_reader_identities_id_fk" FOREIGN KEY ("reader_identity_id") REFERENCES "public"."reader_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_share_id_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_records_reader_identity_id_idx" ON "access_records" USING btree ("reader_identity_id");--> statement-breakpoint
CREATE INDEX "access_records_share_id_idx" ON "access_records" USING btree ("share_id");--> statement-breakpoint
CREATE INDEX "access_records_report_id_idx" ON "access_records" USING btree ("report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reader_identities_email_idx" ON "reader_identities" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "reader_sessions_token_hash_idx" ON "reader_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "reader_sessions_share_id_idx" ON "reader_sessions" USING btree ("share_id");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_tokens_token_hash_idx" ON "verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "verification_tokens_share_id_idx" ON "verification_tokens" USING btree ("share_id");