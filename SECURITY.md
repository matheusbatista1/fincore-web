# Security Policy

FinCore handles personal financial data, so security is a first-class concern.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Report privately via
GitHub's **"Report a vulnerability"** (Security advisories) on this repository, or
contact the maintainer directly. You'll get an acknowledgement as soon as possible.

## Handling of sensitive data

- **Per-user isolation** is enforced at the database with Postgres Row-Level
  Security (policies keyed on `auth.uid()`), not only in application code.
- **Secrets** live in environment variables (Vercel / `.env.local`); they are never
  committed. The Supabase `service_role` key is server-only and never reaches the
  client. Card/account numbers are stored masked.
- **Inputs** are validated with Zod on the server; the ORM parameterizes all queries.
- **Transport** is HTTPS everywhere; auth sessions use httpOnly secure cookies.

## Supported versions

This is an actively developed personal project; only the latest `main` is supported.
