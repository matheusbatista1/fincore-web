---
description: Scaffold a vertical feature slice across the clean-architecture layers and start a feat/ branch.
argument-hint: <feature-name-in-kebab-case>
---

Create a new feature called `$1` for FinCore, scaffolding a vertical slice that
respects the layering (domain → application → infrastructure/presentation).

Steps:

1. Create branch `feat/$1` from an up-to-date `main` (`git switch -c feat/$1`).
2. Scaffold, in order, only what the feature needs:
   - `src/domain/` — entity/value-object and/or a calculator service, with a
     co-located `*.test.ts` (write a failing test first when practical).
   - `src/application/` — a use-case function + any new port interface.
   - `src/infrastructure/` — a repository implementation of the port (Drizzle).
   - `src/app/` + `src/presentation/` — Server Action, RSC page/section, and a
     React Hook Form + Zod form (schema in `src/shared/schemas`).
3. Wire it end-to-end and run `pnpm typecheck && pnpm lint && pnpm test`.

Keep money in integer cents, validate inputs with Zod on the server, and add tests
for the domain logic. Do not open the PR yet — leave that to the user / `/release`.
