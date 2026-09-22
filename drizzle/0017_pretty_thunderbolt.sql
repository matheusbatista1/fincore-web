ALTER TABLE "users" ADD COLUMN "recurring_materialized_through" date;--> statement-breakpoint
-- Existing users start materialising from day 1 of the CURRENT month: the watermark is exclusive
-- ("materialised through this date"), so it is seeded with the last day of the PREVIOUS month.
-- The fixos of this month that already came due are booked on the first pass, and no earlier month
-- is back-filled (months already reconciled by hand must not sprout duplicates).
UPDATE "users"
SET "recurring_materialized_through" = (date_trunc('month', CURRENT_DATE) - INTERVAL '1 day')::date
WHERE "recurring_materialized_through" IS NULL;
