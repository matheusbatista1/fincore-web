# Contributing to FinCore

Thanks for working on FinCore. This is a small project — keep changes focused and
the `main` branch always deployable.

## Workflow (GitHub Flow)

1. Branch off an up-to-date `main`:
   `git switch -c feat/<slug>` (types: `feat|fix|chore|docs|refactor|perf|test`).
2. Make the change with tests. Keep PRs small.
3. Open a PR. Vercel posts a preview; CI runs the quality gates.
4. Squash-merge once green. Delete the branch.

Never push directly to `main`; never force-push shared branches.

## Commits

[Conventional Commits](https://www.conventionalcommits.org), enforced by commitlint:

```
feat: add expense split form
fix: correct installment rounding on the last parcela
```

PR titles must also be conventional (we squash-merge, so the title becomes the
commit). **Commits are authored solely by the repository owner** — do not add any
co-author trailer.

## Code standards

- **English** for code, comments, identifiers and commits. UI copy is pt-BR (i18n).
- **Money is integer cents** via the `Money` value object — never floats.
- **Respect the layers**: `domain` imports nothing external; dependencies point
  inward (see `CLAUDE.md`).
- **Validate inputs with Zod** on the server. Never commit secrets or read `.env*`.
- Run `pnpm typecheck && pnpm lint && pnpm test` before pushing (git hooks help).

## Tests

- Add unit + property tests for any domain logic (target 95% coverage on `src/domain`).
- Add/adjust component, integration or e2e tests for the layer you touch.

## Database changes

- Edit the Drizzle schema, run `pnpm db:generate`, review the SQL, commit the
  migration. Migrations are **additive** (expand/contract). RLS policies apply via
  `pnpm db:migrate`.
