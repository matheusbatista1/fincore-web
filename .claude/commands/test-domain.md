---
description: Run the pure financial-domain tests with coverage and report against the 95% gate.
allowed-tools: Bash(pnpm test:domain), Bash(pnpm test:*), Read, Grep, Glob
---

Run `pnpm test:domain` (Vitest unit + property tests for `src/domain` with coverage).

Then report:

- Pass/fail summary and any failing cases.
- Coverage for `src/domain/**` against the 95% statements / 90% branches gate.
- Any calculator or invariant that lacks a property test (suggest the missing case).

If something fails, diagnose the root cause in the domain logic — never weaken a
test to make it pass.
