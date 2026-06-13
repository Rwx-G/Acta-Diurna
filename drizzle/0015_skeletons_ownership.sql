DROP INDEX "skeletons_name_idx";--> statement-breakpoint
ALTER TABLE "skeletons" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "skeletons" ADD CONSTRAINT "skeletons_owner_id_authors_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."authors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skeletons_owner_id_name_idx" ON "skeletons" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "skeletons_owner_id_idx" ON "skeletons" USING btree ("owner_id");