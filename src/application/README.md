# `application` — Use cases & ports

Orchestrates the domain to fulfill user intentions. Depends **only on `domain`**.

Contents:

- `ports/` — repository and service **interfaces** (e.g. `TransactionRepository`,
  `UnitOfWork`, `Clock`, `IdGenerator`). Infrastructure implements these.
- `use-cases/` — one function per intention: create/update/delete transaction
  (delete scope: `one | forward | all`), settle person, transfer, get dashboard,
  get monthly statement, get card bill, import statement, etc.
- `dto/`, `mappers/` — input/output shapes and domain↔dto mapping.

Rules:

- A use case is a plain async function `(input, deps) => Result<Output>`.
- Never import `infrastructure` or `presentation`. Dependencies are injected via
  the `ports/` interfaces.
