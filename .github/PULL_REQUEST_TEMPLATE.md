<!-- PR title must be a Conventional Commit, e.g. "feat: add expense split form". -->

## What & why

<!-- Summary of the change and the motivation. Link issues: "Closes #123". -->

## Type of change

- [ ] feat
- [ ] fix
- [ ] refactor
- [ ] docs
- [ ] chore / build / ci

## Checklist

- [ ] PR title follows Conventional Commits
- [ ] Tests added/updated (domain logic has unit + property tests)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` pass locally
- [ ] Money uses integer cents via `Money` — no float arithmetic
- [ ] No cross-layer import violations (domain ← application ← infra/presentation)
- [ ] Inputs validated with Zod on the server; no secrets committed
- [ ] DB changes are additive (expand/contract) with a committed migration
- [ ] No `Co-Authored-By: Claude` / "Generated with Claude" in commits

## Preview

<!-- Vercel preview URL (auto-posted by the Vercel bot). -->
