CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_push_subscriptions_endpoint" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "idx_push_subscriptions_user" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "push_subscriptions_owner" ON "push_subscriptions" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));