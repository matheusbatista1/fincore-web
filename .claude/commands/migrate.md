---
description: Generate, review and apply a Drizzle migration safely (expand/contract, RLS via migrate).
allowed-tools: Read, Grep, Glob, Bash(pnpm db:generate), Bash(pnpm db:migrate), Bash(pnpm exec drizzle-kit:*), Bash(git diff:*)
---

Run the FinCore database migration workflow using the `db-migration` subagent's
principles:

1. Run `pnpm db:generate` to produce SQL from the current Drizzle schema.
2. Show me the generated SQL under `drizzle/` and review it: indexes, FKs,
   `ON DELETE`, CHECK constraints, and RLS policies (`auth.uid()`, USING + WITH CHECK).
3. Confirm it is additive (expand/contract — no destructive drops without asking).
4. Apply against the local/test DB with `pnpm db:migrate` (NOT `push`, so RLS lands).
5. Summarize what changed.

Stop and ask before any destructive operation.
