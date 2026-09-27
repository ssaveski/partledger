# Supplier portal screens

Unit U28 of the Release 1 plan. These screens are what a supplier's staff see after opening a link from a buyer's email: the landing page, the response form, the read-only last submission, the outcome of their own lines, and the evidence request list. They run on synthetic data until U17 adds link exchange and portal sessions, U18 the response commands and U31 evidence uploads.

Requirements covered: R17, R20, R35, R36, and the screen side of R16, R18, R19 and KTD21.

## How to open them

- `pnpm --filter @partledger/portal exec vite` and open `http://127.0.0.1:5174/`. In the fixture preview the front page lists one card per synthetic link; each opens `/link/<id>#<secret>` with a full page load, as from an email.
- Every screen shows a banner saying drafts and submissions are simulated and never reach a buyer.
- Building with `VITE_API_ADAPTER=http` swaps the fixture adapter for the HTTP adapter. Until U17 adds the exchange endpoint, Continue then reports that the link could not be checked.

| Fixture link | What it shows |
| --- | --- |
| Open request (RFQ-1060) | The response form: three of five lines assigned, two with drafts, line 3 changed in version 2 after the last submission |
| Closed request (RFQ-1055) | The last submission, read-only: a quote, a no-quote with a reason, and an alternate in USD on a line the buyer changed after it was submitted |
| Decided request (RFQ-1047) | The outcome of the supplier's three lines (one awarded), plus its last submission |
| Evidence request | Four requested documents: requested, under review, accepted, rejected with a reason |
| Expired link, revoked link | "This link is no longer available" |
| Slow connection, service unavailable | The loading and error states of the response form |
| Link check fails | The landing page's error state with a retry, when the link cannot be checked |

## Flows

1. **Opening a link (R17, AE7, KTD21).** The landing page `/link/<id>#<secret>` explains what the supplier is about to open, that loading it records nothing, that they will see only their own organisation's lines and outcomes, and that the link should stay private. It offers one action, Continue. Loading the page sends no request with side effects and nothing to `/api`; the secret is in the fragment, which browsers never send. Continue removes the secret from the address bar and history, exchanges it for a session, and opens the first screen the session allows. In the fixture preview the session is kept in the tab's session storage in place of U17's `__Host-` cookie.
2. **Answering (R18, R19, R20, R16).** The response form lists only the lines assigned to the supplier. Each line takes a quote (a unit price per quantity break the buyer asked for, currency, minimum order quantity, lead time, one-off costs, validity), a no-quote with a reason (a note is required for "another reason"), or an alternate part with its description and the same price fields. The header shows the deadline in the supplier's time zone with the zone abbreviation and the same instant in UTC, when the supplier last submitted, how many lines are answered, and the draft status. Submitting checks every line and asks for the submitter's full name and an attestation that they may submit for the supplier; errors appear on each field and focus moves to the first one in page order.
3. **Reading the last submission (R17, AE11).** Shows the declared name, the attestation, the submission and RFQ versions, the receipt time in both zones, and each answer as text. It has no editable controls; before close it says how to change the response, after close that it can no longer change.
4. **Reading the outcome (R20).** After the seal, each of the supplier's own lines says "Awarded to you" or "Not awarded to you", with a count and the sealing time. The contract has no field that could name a winner, another supplier or a price.
5. **Evidence requests (F2).** Each requested document shows its status, due date, upload time, validity and any rejection reason, and says what to do next. The upload action is shown disabled with the reason "Uploading documents is not available yet" until U31.

## Decisions

- **The draft status and the changed-line indicator are separate.** The draft status (in the header, a live status region) reports only whether typed answers are kept: "Draft saved", "Changes not saved yet", or "No draft saved yet". A line the buyer changed after the last submission carries its own amber "This line changed — review and resubmit" notice with the version and time of the change, and the line's field set is described by it. Saving a draft does not clear it; submitting does. After close or the seal nothing can be resubmitted, so the last submission marks such a line "Changed after you submitted — this answer is to the earlier version" instead.
- **One state for every refused link.** A wrong secret, an expired or revoked link, and a missing or ended session all get the API's uniform 401, so they share "This link is no longer available", which tells the supplier to open the link in the buyer's email again and, if it still does not work, to contact the buyer for a new link. That covers an ended session or a reload after the secret was removed as well as a dead link. It offers no retry, because retrying cannot help. A link without a secret shows it without sending anything.
- **The server decides which screens a link opens.** The session read lists the views the RFQ state allows (answer while open, read after close, outcome after the seal); the navigation shows only those, and a screen the link does not open now reads as not permitted and shows the no-permission state with the supplier wording ("Ask the buyer who invited you").
- **Errors point to the buyer.** The portal's unexpected-error message (route errors, the root boundary, an unreadable response) says to contact the buyer who sent the link, since suppliers have no administrator of ours to ask.
- **Suppliers arrive only through links**, so the front page and the page-not-found state point to the email rather than to a menu.
- **Times follow the supplier.** Deadlines, change and receipt times are shown in the supplier's IANA time zone (from the session) with the zone abbreviation, and the deadline also in UTC, because the server decides lateness in UTC (R19). Amounts use Canadian English formatting, so a USD price reads `US$142.00`.
- **AI-generated content.** Nothing on these screens is AI-generated yet. When a later unit shows AI-extracted values to suppliers (for example a quote read from a PDF), the screen must say so beside those values (CLAUDE.md); the contracts will carry that as a field rather than inferring it in the UI.

## Security headers (for U17 and U24)

- The portal must be served with `Referrer-Policy: no-referrer` and `Cache-Control: no-store` on every response, and a strict `Content-Security-Policy` with no third-party origins (KTD21). The Vite dev and preview servers send the first two (`apps/portal/vite.config.ts`); `index.html` also carries `<meta name="referrer" content="no-referrer">` as a fallback. CSP is left to the production server because the dev server's inline preamble would break under it.
- The portal loads nothing from another origin: fonts are bundled from `@fontsource`, and the e2e test checks that every request before Continue goes to the portal's own origin.

## Contracts and client

- Read contracts: `libs/contracts/src/portal/queries.ts` declares `portal.session`, `portal.response`, `portal.submission`, `portal.outcome` and `portal.evidenceRequests` with `defineQuery`, open to `supplier_token` principals only; they take no input, because the session names the supplier and link. `apps/api/src/commands/portal-queries.spec.ts` checks them against the registry rules.
- Fixtures: `libs/contracts/src/fixtures/portal.ts` holds every line and every supplier's answer, and projects them onto the session's supplier as the portal role's policy will, so a test can prove another supplier's lines never reach the screens.
- The fixture adapter gained an `unauthenticated` response, the uniform 401 of a refused link or session.
- Writes are preview-only. Autosaving a draft and submitting change nothing on a server; U18 replaces them with the draft and submit commands.

## Follow-ups

- The portal's shell pieces (theme switcher, query states, document title, formatting) mirror `apps/web/src/shell/`; once both apps settle they can move into `libs/ui`.
- U17: the link exchange endpoint and `__Host-` session cookie, and the HTTP connection's `exchange`.
- U18: draft and submit commands; the declared name enters the chain as a commitment.
- U31: evidence uploads through the scanned upload pipeline.
