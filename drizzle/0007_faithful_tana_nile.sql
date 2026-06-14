CREATE TABLE "card_bill_dates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"month" text NOT NULL,
	"closing_day" smallint NOT NULL,
	"due_day" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "chk_cbd_closing_day" CHECK (closing_day BETWEEN 1 AND 31),
	CONSTRAINT "chk_cbd_due_day" CHECK (due_day BETWEEN 1 AND 31)
);
--> statement-breakpoint
ALTER TABLE "card_bill_dates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "card_bill_dates" ADD CONSTRAINT "card_bill_dates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_bill_dates" ADD CONSTRAINT "card_bill_dates_card_id_credit_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."credit_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_card_bill_dates_card_month" ON "card_bill_dates" USING btree ("card_id","month");--> statement-breakpoint
CREATE POLICY "card_bill_dates_owner" ON "card_bill_dates" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));