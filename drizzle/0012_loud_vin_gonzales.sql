ALTER TABLE "transactions" ADD COLUMN "paid_at" date;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "paid_account_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "paid_amount_cents" bigint;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_paid_account_id_accounts_id_fk" FOREIGN KEY ("paid_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "chk_paid_pair" CHECK ((paid_at IS NULL) = (paid_account_id IS NULL));