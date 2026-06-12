CREATE TABLE "data_sets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid,
	"filename" text NOT NULL,
	"source_format" text NOT NULL,
	"fields" jsonb NOT NULL,
	"injected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data_as_of" timestamp with time zone,
	"storage_path" text NOT NULL,
	CONSTRAINT "data_sets_format_check" CHECK ("data_sets"."source_format" in ('csv', 'json', 'xlsx'))
);
--> statement-breakpoint
ALTER TABLE "data_sets" ADD CONSTRAINT "data_sets_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;