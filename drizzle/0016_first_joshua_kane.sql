ALTER TABLE "transactions" ADD COLUMN "received_at" date;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "received_account_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "received_amount_cents" bigint;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_received_account_id_accounts_id_fk" FOREIGN KEY ("received_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "chk_received_pair" CHECK ((received_at IS NULL) = (received_account_id IS NULL));--> statement-breakpoint
-- Backfill: mark every existing NORMAL income (lands in an account; card-credit estornos excluded)
-- as already received on its own date for its full amount. Preserves current balances and the person
-- ledger — going forward, only future-dated incomes are booked as pending receivables (received_at NULL).
UPDATE "transactions"
SET "received_at" = "occurred_on",
    "received_account_id" = "account_id",
    "received_amount_cents" = "amount_cents"
WHERE "kind" = 'income' AND "account_id" IS NOT NULL AND "received_at" IS NULL;