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
- Frontend: React 19 with shadcn/ui on Base UI (plan KTD1); the staff app and the supplier portal share `libs/ui`.
- zod schemas are the single source of truth for every boundary shape; types are inferred from them.
- Tests: Vitest; integration tests against real PostgreSQL (Testcontainers); end-to-end with Playwright.

## Workspace

- Apps in `apps/` (api, web, portal, verifier), libraries in `libs/`. Nx tags enforce the boundaries in lint: `db`, `domain` and `packs` are API-only, `ui` is front-end-only, `contracts` is shared, and the verifier imports only `libs/chain`. Apps are never imported.
- `pnpm verify` runs every gate: action pins, format and lint, typecheck, `db:check`, contrast, unit tests, vectors, integration tests (Docker for Testcontainers) and Playwright. Cloud-session setup: `docs/runbooks/cloud-session-setup.md`.
- Only `apps/api/src/config/` reads `process.env`. User-facing text comes from translation keys; literal strings in components fail lint.
- Dependencies: install scripts run only for packages allowlisted in `pnpm-workspace.yaml` (`allowBuilds`), and a version must be three days old (`minimumReleaseAge`). CI actions are pinned by commit digest.

## Parallel sessions

- Never share single files between units: translation catalogues (`libs/contracts/src/i18n/en/<module>.json`), permission expectations (`apps/api/test/permissions/<module>`) and job schedules are split per module.
- Rebase every pull request on the latest `main` before pushing; units that touch `libs/db` regenerate migrations and run `pnpm db:check` after the rebase.

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

- Work on a branch; never push to `main` and never merge by hand. A unit's pull request merges through the merge workflow once CI's `verify` passes on top of the latest `main` (plan KTD6). Open a draft only when the owner must merge: an unresolved finding, or a change to `.claude/` or `docs/plans/`. Never change `.github/workflows/unit-merge.yml`; the workflow never merges a change to itself.
- Conventional commit messages: `feat(scope): …`, `fix(scope): …`.
