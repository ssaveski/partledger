# Partledger — working rules

A parts-and-suppliers platform for small and mid-sized manufacturers. Read `docs/brief.md` before planning or writing code. Implementation plans live in `docs/plans/`.

## Confidentiality

- Never name customers or prospects, and never put their data, contracts, drawings or documents in this repo. The first customer is "a Canadian aerospace manufacturer".
- Fixtures and seed data are synthetic only: invented parts, suppliers and certificates.
- No secrets in the repo. `.env` files stay local; commit an `.env.example` with placeholder values.
- Nothing from this repo is published outside it: no public gists, no external document-sharing tools.

## Stack

- TypeScript end to end, `strict` on, Node LTS, pnpm workspace.
- API: NestJS. Database: PostgreSQL with row-level security.
- Frontend framework is an open decision (Vue 3 or React), settled in the first plan.
- zod schemas are the single source of truth for every boundary shape; types are inferred from them.
- Tests: Vitest; integration tests against real PostgreSQL (Testcontainers); end-to-end with Playwright.

## Engineering rules

- No `any`, no `as` casts. Parse unknown input (HTTP bodies, ERP imports, supplier uploads, AI output) with zod instead of casting it.
- Expected failures (not found, refused, invalid, expired) are returned as typed results from services, not thrown. One module maps them to HTTP. Error bodies carry a stable message key plus params, never prose.
- Integrity lives in the database: foreign keys, unique constraints, and insert-only audit tables (no UPDATE or DELETE, enforced by grants and row-level security).
- Multi-tenant from day one: every tenant-owned row carries its tenant and is protected by row-level security. Each tenant has a data-residency region (Canada or EU at first).
- RFQ and award lifecycles are server-side state machines. The client can request a transition; only the server performs it.
- An approved award is sealed: the quotes, the supplier evidence (by content hash) and the approver are written once, hash-chained, and never modified.
- AI only suggests. A person approves every decision that matters. Every AI suggestion and its acceptance or rejection lands in the audit trail, and every audit entry records its actor type: person, AI agent or supplier access token.
- Tell supplier staff when they are interacting with AI-generated content or an AI agent.
- Tests change in the same commit as the behaviour they cover. Name tests as plain sentences.
- Comments only for non-obvious constraints; never narrate what the code does.
- Full words in names: `context`, not `ctx`; `request`, not `req`.

## Git

- Work on a branch; never push to `main` and never merge by hand. A unit's pull request merges through the CI merge workflow once `verify` passes on top of the latest `main` (plan KTD6). Open it as a draft when the owner must merge instead: U3, an unresolved finding, or changes to `.github/`, `.claude/`, `CLAUDE.md` or `docs/plans/`.
- Conventional commit messages: `feat(scope): …`, `fix(scope): …`.
