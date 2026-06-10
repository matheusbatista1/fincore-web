# `presentation` — Shared UI building blocks

React components, hooks and client stores used by the routes in `src/app`.
May import `domain` (types/formatting) and `application` (use case inputs/outputs)
but **never `infrastructure`** directly — server components and Server Actions in
`src/app` wire infrastructure to use cases at the edge.

Contents:

- `components/primitives/` — accessible primitives (Radix, styled with our tokens).
- `components/ui/` — bespoke widgets: `CreditCardWidget`, `KpiCard`,
  `SegmentedControl`, `BottomSheet`, `CommandPalette`, `Money`, `Avatar`, …
- `components/charts/` — ported SVG charts (Area, Bars, Donut).
- `components/forms/` — React Hook Form + Zod forms.
- `hooks/`, `stores/` — `useIsMobile`, privacy-mode/view-toggle Zustand stores.

> Note: Next.js App Router routes, layouts and Server Actions live in `src/app`
> (the presentation/routing layer). This folder holds the reusable pieces they compose.
