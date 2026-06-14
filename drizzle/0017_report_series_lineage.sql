CREATE TABLE "report_series" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "predecessor_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "issue_label" text;--> statement-breakpoint
ALTER TABLE "report_series" ADD CONSTRAINT "report_series_owner_id_authors_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."authors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_series_owner_id_idx" ON "report_series" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_series_id_report_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."report_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_predecessor_id_reports_id_fk" FOREIGN KEY ("predecessor_id") REFERENCES "public"."reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_series_id_idx" ON "reports" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "reports_predecessor_id_idx" ON "reports" USING btree ("predecessor_id");