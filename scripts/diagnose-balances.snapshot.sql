-- Read-only snapshot of ONE user's workspace, for `scripts/diagnose-balances.ts --snapshot <file>`.
--
-- For when the database credentials are not at hand (the Vercel production variables are
-- "Sensitive" and cannot be pulled): run this single SELECT in the Supabase SQL Editor, then
-- Export -> Download CSV (or "Copy as JSON" into a file) and hand that file to the script.
--
-- It returns every row of the user, soft-deleted ones included, with the audit columns: the script
-- drops the deleted rows exactly as the app does, and uses them (and created_at / updated_at) to
-- tell which rows changed after a fatura was paid.
--
-- Replace YOUR_EMAIL with the e-mail the user signs in with.
with u as (
  select id from public.users
  where email = 'YOUR_EMAIL'
)
select jsonb_build_object(
  'version', 1,
  'exported_at', now(),
  'profile', (
    select jsonb_build_object(
      'auto_payments_enabled', p.auto_payments_enabled,
      'default_pay_account_id', p.default_pay_account_id,
      'auto_payments_since', p.auto_payments_since
    ) from public.users p where p.id = (select id from u)
  ),
  'accounts',           coalesce((select jsonb_agg(to_jsonb(t)) from public.accounts t           where t.user_id = (select id from u)), '[]'::jsonb),
  'credit_cards',       coalesce((select jsonb_agg(to_jsonb(t)) from public.credit_cards t       where t.user_id = (select id from u)), '[]'::jsonb),
  'card_bill_dates',    coalesce((select jsonb_agg(to_jsonb(t)) from public.card_bill_dates t    where t.user_id = (select id from u)), '[]'::jsonb),
  'people',             coalesce((select jsonb_agg(to_jsonb(t)) from public.people t             where t.user_id = (select id from u)), '[]'::jsonb),
  'transactions',       coalesce((select jsonb_agg(to_jsonb(t)) from public.transactions t       where t.user_id = (select id from u)), '[]'::jsonb),
  'transaction_splits', coalesce((select jsonb_agg(to_jsonb(t)) from public.transaction_splits t where t.user_id = (select id from u)), '[]'::jsonb),
  'settlements',        coalesce((select jsonb_agg(to_jsonb(t)) from public.settlements t        where t.user_id = (select id from u)), '[]'::jsonb),
  'card_bill_payments', coalesce((select jsonb_agg(to_jsonb(t)) from public.card_bill_payments t where t.user_id = (select id from u)), '[]'::jsonb)
) as snapshot;
