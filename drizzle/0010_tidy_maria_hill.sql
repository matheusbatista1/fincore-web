DROP INDEX "idx_settlements_person";--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_settlements_person" ON "settlements" USING btree ("person_id") WHERE deleted_at IS NULL;