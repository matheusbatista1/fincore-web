CREATE TABLE "statement_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid,
	"card_id" uuid,
	"competence_month" text,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"bank_lines" integer NOT NULL,
	"bank_only" integer NOT NULL,
	"book_only" integer NOT NULL,
	"checked_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_statement_check_target" CHECK ((account_id IS NOT NULL AND card_id IS NULL AND competence_month IS NULL) OR (account_id IS NULL AND card_id IS NOT NULL AND competence_month IS NOT NULL)),
	CONSTRAINT "chk_statement_check_counts" CHECK (bank_lines > 0 AND bank_only >= 0 AND book_only >= 0),
	CONSTRAINT "chk_statement_check_period" CHECK (period_from <= period_to)
);
--> statement-breakpoint
ALTER TABLE "statement_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "statement_checks" ADD CONSTRAINT "statement_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_checks" ADD CONSTRAINT "statement_checks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_checks" ADD CONSTRAINT "statement_checks_card_id_credit_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."credit_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_statement_checks_account" ON "statement_checks" USING btree ("account_id","checked_on");--> statement-breakpoint
CREATE INDEX "idx_statement_checks_card" ON "statement_checks" USING btree ("card_id","checked_on");--> statement-breakpoint
CREATE POLICY "statement_checks_owner" ON "statement_checks" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));