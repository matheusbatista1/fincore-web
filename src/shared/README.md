# `shared` — Cross-cutting utilities

Small, dependency-light helpers usable by any layer (keep it tiny).

Contents:

- `schemas/` — Zod schemas shared between client forms and Server Actions.
- `formatting/` — BRL currency + pt-BR date formatting (replaces the prototype's
  `BRL`/`dateLabel` helpers).
- `theme/` — `bank-themes.ts` (the ~19 bank gradient recipes / accent colors).
- `result.ts` — the `Result<T, E>` type used across use cases.
