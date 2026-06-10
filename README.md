# FinCore

> Personal finance, with clarity. Track accounts, credit cards, installments,
> shared expenses and monthly cash flow — built as a production-grade web app.

[![CI](https://github.com/matheusbatista1/fincore-web/actions/workflows/ci.yml/badge.svg)](https://github.com/matheusbatista1/fincore-web/actions/workflows/ci.yml)

FinCore is a Brazilian personal-finance app: a transaction tracker, shared-expense
splitter and bank-statement viewer for people with complex finances — multiple
accounts and credit cards, installments (parcelamento), recurring bills, transfers,
and expenses split with other people.

> Code, comments and commits are in English. The user-facing UI is pt-BR.

## ✨ Features

- **Dashboard** — total balance, monthly KPIs, 6-month evolution, insights.
- **Accounts & cards** — balances, credit-card bills, limits, due dates.
- **Transactions** — income / expense / transfer, with categories and notes.
- **Installments** — split a purchase into parcelas; only the current one hits the bill.
- **Shared expenses** — equal/custom splits and a people ledger (who owes whom).
- **Recurring** — fixed monthly items projected into future months.
- **Monthly statement** — grouped by card, account and fixed commitments.
- **Personal vs General view** — see your true spend net of others' shares.
- **Budgets, goals, installable PWA, CSV/OFX import** — v1 enhancements.

## 🧱 Tech stack

Next.js 16 (App Router, RSC + Server Actions) · React 19 · TypeScript (strict) ·
Tailwind CSS v4 · Drizzle ORM + Supabase Postgres · Supabase Auth (RLS) ·
React Hook Form + Zod · TanStack Query + Zustand · next-intl · Vitest + fast-check +
Testing Library · Playwright · Biome · lefthook · GitHub Actions · Vercel.

## 🏛️ Architecture

Clean architecture; dependencies point **inward**:

```
app/presentation → application → domain
infrastructure ──implements──▶ application/ports
```

- `src/domain` — pure financial logic (Money in integer cents, calculators). No I/O.
- `src/application` — use cases + repository interfaces (`ports/`).
- `src/infrastructure` — Drizzle/Supabase/auth/env adapters.
- `src/app` + `src/presentation` — routes, Server Actions and UI.
- `src/shared` — Zod schemas, formatting, theme, `Result`.

See [`CLAUDE.md`](./CLAUDE.md) and each `src/*/README.md` for the full contract.

## 🚀 Getting started

Prerequisites: **Node 22+**, **pnpm 11+**, and (for the DB) the **Supabase CLI** +
Docker.

```bash
pnpm install
cp .env.example .env.local   # fill in Supabase + DB values
pnpm dev                     # http://localhost:3000
```

Local database:

```bash
supabase start               # Postgres + Auth + Studio in Docker
pnpm db:migrate              # apply migrations (includes RLS policies)
pnpm db:seed                 # demo data
```

## 📜 Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` / `build` / `start` | Next.js dev / build / serve |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` / `lint:fix` | Biome check / autofix |
| `pnpm test` / `test:watch` | Unit + component tests |
| `pnpm test:domain` | Domain tests with the 95% coverage gate |
| `pnpm test:integration` | Repository / Server Action tests (needs DB) |
| `pnpm test:e2e` | Playwright end-to-end |
| `pnpm db:generate` / `migrate` / `studio` / `seed` | Drizzle workflow |

## 🧪 Testing

Test pyramid: heavy unit + **fast-check property tests** on the domain (money,
split, installments, projections), integration tests for repositories/Server
Actions, component tests (Testing Library), and Playwright for critical flows.

## ☁️ Deployment

Hosted on **Vercel**: every PR gets a preview deployment; merging to `main` deploys
production. Database is **Supabase** (free tier). Migrations are applied via a
dedicated step against the direct connection.

## 🤝 Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). GitHub Flow, Conventional Commits,
squash-merge.

## 🔒 Security

See [`SECURITY.md`](./SECURITY.md).

## 📄 License

Proprietary / `UNLICENSED`. All rights reserved © Matheus dos Santos Batista.
