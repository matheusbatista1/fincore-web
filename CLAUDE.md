# FinCore — Claude Working Agreement

FinCore is a personal-finance web app (Brazilian context) rebuilt from an approved
prototype into a production-grade product.

## 🟣 Golden rules (read first)

1. **Authorship.** The user (Matheus) is the **sole author** of every commit and PR.
   NEVER add Claude/Anthropic as author or co-author. No `Co-Authored-By: Claude`
   trailer, no "Generated with Claude Code" line. A PreToolUse hook enforces this.
2. **Money is integer cents.** All monetary values are integer minor units via the
   `Money` value object. NEVER use floats or raw currency arithmetic.
3. **Respect the layers.** Dependencies point inward:
   `app/presentation → application → domain`; `infrastructure` implements
   `application/ports`. `domain` imports nothing outside itself.
4. **English only** in code, comments, identifiers, commit messages and docs.
   (User-facing UI copy is pt-BR via i18n.)
5. **Never** use `--no-verify`, never commit secrets, never read `.env*` files.
6. **Security first** (finance data): per-user isolation via Postgres RLS; validate
   every Server Action input with Zod; never ship the Supabase `service_role` key
   to the client.

## Project overview

Next.js 16 (App Router, RSC + Server Actions) · React 19 · TypeScript strict ·
Tailwind CSS v4 · Drizzle ORM + Supabase Postgres · Supabase Auth (SSR) ·
React Hook Form + Zod · TanStack Query + Zustand · next-intl (pt-BR) ·
Vitest + fast-check + Testing Library · Playwright · Biome · lefthook.
Hosted on Vercel (preview per PR, prod on `main`).

## Architecture (4 layers + dependency rule)

```
src/
  app/            # Next.js App Router: routes, layouts, Server Actions (presentation/routing)
  domain/         # PURE TS: Money, entities, value objects, calculators. No I/O, no framework.
  application/    # use-cases + ports/ (repository interfaces). Imports only domain.
  infrastructure/ # Drizzle/Supabase/auth/env. Implements ports. Never imported inward.
  presentation/   # shared UI: components, hooks, stores, forms.
  shared/         # Zod schemas, formatting, bank-themes, Result type.
```

See each folder's `README.md` for its contract. A finance miscalculation must be
catchable by a `*.test.ts` in `domain/` with no mocks.

## Domain glossary (pt-BR ↔ en)

| pt-BR | code (en) |
|-------|-----------|
| Lançamento | Transaction |
| Receita / Despesa | Income / Expense |
| Transferência | Transfer |
| Parcela / Parcelamento | Installment |
| Rateio / Divisão | Split |
| Saldo | Balance |
| Fatura | Card bill |
| Conta / Carteira | Account |
| Cartão | CreditCard |
| Pessoa | Person |
| Categoria | Category |
| Acerto / Quitar | Settlement / Settle |
| Lançamento fixo | Recurring rule |
| Projeção / Previsto | Projection / Projected |
| Orçamento | Budget |
| Meta | Goal |

Money sign convention: expense `amount < 0`, income `> 0`, transfer `= 0`.
Person balance: `> 0` they owe you · `< 0` you owe them · `0` settled.

## Commands (pnpm)

| Command | What |
|---------|------|
| `pnpm dev` | Dev server |
| `pnpm build` | Production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` / `pnpm lint:fix` | Biome check / autofix |
| `pnpm test` / `pnpm test:watch` | Unit + component tests |
| `pnpm test:domain` | Domain tests with coverage gate (95%) |
| `pnpm test:integration` | Repository/Server Action tests (needs DB) |
| `pnpm test:e2e` | Playwright end-to-end |
| `pnpm db:generate` / `db:migrate` / `db:studio` / `db:seed` | Drizzle workflow |

## Conventions

- **Forms:** React Hook Form + Zod; the Zod schema is shared between the client
  form and the Server Action (re-validate on the server — never trust the client).
- **Server Actions** are thin adapters: `auth → validate (Zod) → use-case → revalidateTag`.
- **Errors:** use-cases return `Result<T, E>` from `@/shared/result` (no throwing for
  expected domain errors).
- **Tests:** co-locate unit/component tests (`*.test.ts(x)`); integration + e2e live
  in `tests/integration/` and `e2e/`. Prefer fast-check property tests for `Money`.
- **Imports:** use the `@/*` alias for `src`.

## Git workflow (GitHub Flow)

- `main` is always deployable. Branch → PR → Vercel preview → squash-merge.
- Branch names: `feat|fix|chore|docs|refactor|perf|test/<kebab-slug>`.
- Conventional Commits (enforced by commitlint). PR title must also be conventional.
- Never push to `main` directly; never force-push shared branches.

## Do / Don't

- ✅ Small PRs, domain tests first, integer-cents money, Zod on every input.
- ❌ Float money, cross-layer imports, secrets in code, co-author trailers,
  `--no-verify`, shipping `service_role` to the client.

> Tooling note: the committed `.claude/settings.json` pre-allows common safe
> commands and denies reading `.env*`. Personal overrides go in
> `.claude/settings.local.json` (gitignored).
