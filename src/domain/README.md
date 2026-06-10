# `domain` — Enterprise business rules

**Pure TypeScript. Zero framework, zero I/O, zero imports outside `domain/`.**

This is the heart of FinCore: money math, entities, value objects and the
financial calculators ported 1:1 from the approved prototype. Everything here
must be unit-testable with **no mocks**.

Contents:

- `money/` — the `Money` value object (integer **cents**, never floats).
- `entities/` — `Transaction` (discriminated union), `Account`, `CreditCard`,
  `Person`, `Category`, `Budget`, `Goal`.
- `value-objects/` — `Share`, `Installment`, `Recurrence`, `CompetenceMonth`, …
- `services/` — calculators: balance, card bill, split, installment generation,
  person ledger, recurring projection, personal-vs-general, budgets, goals.

Rules:

- Money is always integer cents. A finance miscalculation must be catchable by a
  `*.test.ts` here.
- No dependency on `application`, `infrastructure`, `presentation`, React, Next
  or any package that performs I/O.
