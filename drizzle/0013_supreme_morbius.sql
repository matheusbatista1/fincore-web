CREATE TABLE "card_bill_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"competence_month" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"account_id" uuid,
	"paid_on" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "chk_card_bill_payment_amount" CHECK (amount_cents > 0)
);
--> statement-breakpoint
ALTER TABLE "card_bill_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "card_bill_payments" ADD CONSTRAINT "card_bill_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_bill_payments" ADD CONSTRAINT "card_bill_payments_card_id_credit_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."credit_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_bill_payments" ADD CONSTRAINT "card_bill_payments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_card_bill_payments_card" ON "card_bill_payments" USING btree ("card_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_card_bill_payment_card_competence" ON "card_bill_payments" USING btree ("card_id","competence_month") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE POLICY "card_bill_payments_owner" ON "card_bill_payments" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));