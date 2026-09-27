# Key screens: RFQ detail, quote comparison, approval packet

Unit U3 of the Release 1 plan. These three staff screens decide whether a buyer, quality engineer or approver trusts the product, so they are built and reviewed on synthetic data before Phase D wires them to the API (KTD4). This document records the flows, the decisions behind them, and what outside reviewers found.

Requirements covered: R21, R22, R35, R36, R40, and the screen side of R23, R24, R41 and R42.

## How to open them

- `pnpm --filter @partledger/web exec vite` and open `http://127.0.0.1:5173/`. The overview lists one card per synthetic scenario, each with links to its detail, quote comparison and approval packet.
- Every screen shows a banner saying it is a preview with synthetic data and that nothing is saved.
- Building with `VITE_API_ADAPTER=http` swaps the fixture adapter for the HTTP adapter; the screens do not change.

| Scenario (fixture RFQ) | What it shows |
| --- | --- |
| Open RFQ (RFQ-1042) | Response status only; the comparison says it opens at close |
| Closed RFQ ready for selection (RFQ-1038) | All seven cell states, evidence badges, buyer-recorded quotes, outside-quote recording, winner selection |
| Re-bid with a blocked gate (RFQ-1031-R2) | A lapsed certificate blocking approval (AE2), the previous round, a justified non-lowest winner |
| Award ready for approval (RFQ-1027) | A passing gate, an active deviation (R41), a buyer-recorded winning quote (R42) |
| Draft without suppliers (RFQ-1050) | The empty response list |
| Slow connection, service unavailable, no permission | The loading, error and no-permission states of every screen |

## Flows

1. **Chasing responses while the RFQ is open (F3, R40).** RFQ detail lists each invited supplier as "Responded" or "Not yet", with the time of its last submission and nothing else. A filter (`?show=notYet`) narrows the list to the suppliers still to respond. The quote comparison of an open RFQ is an empty state that explains why and links back to the response status.
2. **Selecting winners after close (F5, R21, R22).** The comparison grid shows lines as rows and suppliers as columns. The buyer reads the normalised totals, then decides every line below the grid: a winner or "No award for this line". Nothing starts selected. Choosing a winner that is not the lowest total reveals a required justification whose hint names the lowest supplier and total. "Submit for approval" validates the form; errors appear on each field and focus moves to the first one.
3. **Recording a quote received outside the portal (R42).** After close, every cell where the portal holds no current quote from that supplier (pending, late or stale) offers "Record outside quote". The dialog asks for the price, currency, minimum order quantity, one-off costs, lead time, validity, the date it arrived and the supplier's document (PDF, PNG or JPEG up to 20 MB). A quote counts up to the RFQ's deadline, not up to when it closed: RFQ-1038 closed early on 22 September, but a quote that arrived on 23 September is still accepted because the deadline was 24 September. The recorded quote carries the "Recorded by a buyer" marker in the grid and in the approval packet, and the line's lowest total is highlighted again.
4. **Approving or rejecting (F5, R23, R24, R41).** The approval packet shows who submitted the award and when, the gate checklist with each check's outcome as a message, every line's decision with the winning supplier's evidence (status, expiry and content hash) and any active deviation, the exchange rates, and the previous round of a re-bid. Approve and Reject are disabled, with the server's reason beside them, when the read says they are not allowed. Once one is chosen in the preview, both close. An accepted alternate part is named on its line, and a winner with no evidence on file or required says so.

## Decisions

- **The server decides what is allowed.** Screens read `allowedTransitions` and `blockingReasons` (message keys with params) from each query (R32) and never re-derive the lifecycle. A disabled action stays focusable (`focusableWhenDisabled`) and is described by its reason, so a keyboard or screen-reader user learns why it is unavailable.
- **Answers cannot leak before close by construction.** The RFQ detail contract has no field that could carry an answer, and every contract object is strict, so an extra field fails parsing in the client. The comparison read of an open RFQ is a separate `notYetClosed` shape with no lines.
- **Lowest is highlighted, never chosen.** The best-price cell has a green border, bold total and trophy icon; the copy above the grid says the lowest total is never chosen for you. Winner selects start empty, and the lowest option is labelled "(lowest total)" rather than preselected.
- **Winner options say what an approver would ask.** Each option names the supplier and total, and adds "(lowest total)", the alternate part it offers, or that a buyer recorded it.
- **Winners are chosen outside the grid.** The grid follows the APG grid pattern with one widget per cell (KTD28). A select inside a cell would fight the grid for arrow keys, so each line's decision is a labelled field set below the grid. Only current quotes and alternates a quality engineer accepted are offered as winners (R22); stale, pending, late and no-quote cells are not.
- **The outside-quote action sits in the cell that lacks a quote.** The plan asks each supplier column to offer it after close. Putting it in the header would add the button's name to every cell's column header for screen readers, so it appears in each cell of that supplier's column where the portal holds no current quote, named with supplier and line ("Record outside quote from Kestrel Machining for line 4") and described by the cell's state ("Pending"), which the focus would otherwise skip. A supplier that answered every line has nothing to record.
- **Colour is never the only signal.** Every cell state, marker and evidence status has its own icon and a label; the legend shows the same label the cell announces (visually hidden text beside the icon).
- **Instants are shown in UTC and say so**, because deadlines are decided in UTC (R19). Amounts use Canadian English formatting, so a USD or EUR price keeps its code (`US$41.10`, `€67.20`) and totals are always in the tenant currency.
- **Designed states on every screen.** Loading (with a page heading for assistive technology), empty with a next action (never an empty grid), error with retry and a message key, and no permission. A malformed RFQ id is "Page not found"; an unknown one is the not-found error from the server.
- **After a client-side navigation focus moves to the main region**, and a skip link reaches it from the top of the page.

## Contracts and client

- Read contracts: `libs/contracts/src/rfqs/queries.ts` declares `rfqs.detail`, `rfqs.comparison` and `rfqs.approvalPacket` with U5's `defineQuery`; they pass the API registry rules (`apps/api/src/commands/rfq-queries.spec.ts`) so Phase D registers handlers without changing them.
- Typed client: `libs/contracts/src/client/` parses input before sending and output on arrival against the same declaration. Failures are values (`refused`, `invalid`, `unauthenticated`, `unavailable`, `malformed`), never thrown; a `Forbidden` refusal renders the no-permission state.
- HTTP adapter: `GET /api/v1/queries/<name>?input=<json>` through the same-origin `/api` proxy (KTD30), mapping 401, validation and declared refusal bodies.
- Fixture adapter: serves `libs/contracts/src/fixtures/` (invented parts, suppliers, people and certificates) through a JSON round trip, with simulated latency in the browser.
- Recording an outside quote works only in the fixture preview. Against the API the action is shown disabled, with the reason that it is not available yet, until U19 adds the command, so no screen fakes a server write.
- Writes are preview-only. Submitting an award, approving, rejecting and recording an outside quote change nothing on a server. Recording an outside quote updates the cached comparison, normalising at the exchange rates the comparison captured; U19 and U20 replace these with commands, after which the screen reads the comparison again.

## Comparison cell states

| State | Icon | Meaning | Data source |
| --- | --- | --- | --- |
| Best price | Trophy, green | Lowest normalised total on the line | U19 |
| Submitted | Check, blue | A current quote | U18 |
| Alternate part | Swap, accent | A quote for an alternate part; shows whether quality accepted it | U18 |
| No quote | Slashed circle | Declined, with the supplier's reason | U18 |
| Pending | Dashed circle | Invited, no response by close | U17, U18 |
| Stale: line changed since | History, amber | Answered an earlier version of an amended line (AE1); struck-through total | U16 |
| Late: refused after the deadline | Alarm off, red | Attempted after the deadline and refused (R19) | **None yet; see below** |

Marker (not a state): "Recorded by a buyer" (R42), on any quoted cell.

## Open questions

- **"Late" has no data source yet.** From the plan's 2026-09-26 review: R19 refuses late submissions at the server, and neither U18 nor U19 records a refused attempt for the buyer to see. The state is rendered from fixture data only (Kestrel Machining on RFQ-1038 line 3). Before U19, the product owner decides whether a refused late attempt is recorded (and where, without its answers entering the audit chain, R26) or whether the state is dropped from the grid and legend.
- **What rejecting an award asks for.** Reject returns the RFQ to selection. Whether the approver must give a reason, and whether the buyer sees it, is a product decision for U20; the preview asks for none.
- **Buyer-recorded quotes and the "late" state.** A pending or late cell offers "Record outside quote"; the dialog refuses a quote received after the deadline. Whether a late portal attempt should also be recordable as an outside quote (same supplier, same deadline) follows from the question above.

## Walkthrough findings (product owner)

> To be completed by the product owner after this unit merges and before Phase D (plan Success Criteria). Record findings without names: the reviewer's role (for example "buyer, mid-sized machining shop" or "AS9100 quality engineer"), not who they are. The first customer's staff do not take part while the IP gate is closed.

| Date | Reviewer role | Screen | Finding | Decision |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## Demand check for offline verification (product owner)

> To be completed before U21 or U32 starts (plan Dependencies): at least one target-segment buyer or quality lead and one AS9100 auditor walk through the approval packet and a mocked export-and-verify result. Record the answer without names. If they would not use offline verification, U21 and U32 return to the product owner.

| Date | Reviewer role | Would use offline verification? | Notes |
| --- | --- | --- | --- |
|  |  |  |  |

## Secondary screens

Unit U27 of the Release 1 plan: the overview, the RFQ list, the RFQ builder, supplier assignment, the parts and supplier lists, and evidence review, on the same shell, client and fixture approach as the key screens. Requirements covered: R35, R36, and the screen side of R8, R9, R10, R13, R14, R15, R16 and R41. U10, U15 and U16 wire them to the API.

### How to open them

- The main navigation reaches Overview, RFQs, Parts, Suppliers and Evidence. Each RFQ screen gains a "Suppliers" section link to its assignment; "New RFQ" on the RFQ list opens the builder.
- The overview's "Screen states preview" links open every screen in each designed state. Screens whose reads take no id get their state from the address: `?preview=empty`, `slow`, `unavailable` or `forbidden` applies to every read of the page opened (a full page load). Only the fixture adapter honours it.
- Writes in the fixture preview (publishing, amending, extending, confirming, rejecting, recording a deviation) are kept for the page's lifetime in a preview store the fixture client reads first, so every screen sees them until a reload. Against the API each of these actions is shown disabled with the reason that it is not available yet, until its command exists.

| Screen | Reads | Designed states |
| --- | --- | --- |
| Overview (`/`) | `rfqs.list`, `evidence.reviewQueue`, `suppliers.list` | Each section loads, fails, is refused or is empty on its own |
| RFQs (`/rfqs`) | `rfqs.list` | Loading, empty (with "New RFQ"), error, no permission, no match |
| New RFQ (`/rfqs/new`) | `parts.list`; `suppliers.list` and `rfqs.list` when saving | Loading, no active parts, no lines yet, error, no permission |
| Supplier assignment (`/rfqs/:id/assignment`) | `rfqs.assignment` | Loading, no suppliers to invite, error, no permission |
| Parts (`/parts`) | `parts.list` | Loading, empty, error, no permission, no match |
| Suppliers (`/suppliers`) | `suppliers.list` | Loading, empty, error, no permission, no match |
| Evidence review (`/evidence`) | `evidence.reviewQueue` | Loading, nothing awaiting confirmation, no gaps, error, no permission |

### Flows

1. **Building and publishing an RFQ (F2, R15).** The builder asks for a title and a UTC deadline, then lists the active parts in a grid with an Add or Remove button per row; each added part becomes a line with its quantity, optional quantity breaks (such as `100, 500`) and required date, which cannot fall before the deadline. "Save draft and invite suppliers" creates the draft and opens its supplier assignment, where each line lists every supplier with a checkbox and whether its approved scope covers the line's category. "Publish RFQ" needs a supplier on every line; the RFQ then opens with every invited supplier as "Not yet".
2. **Changing a published RFQ (R16).** The RFQ detail offers "Amend a line" (quantity or required date; the next version, with a notice that answers to the line become stale) and "Extend the deadline" (a later UTC deadline and a reason, for every supplier; a closed RFQ reopens). Once staff have seen the answers after close, the read blocks the extension and the button stays focusable, disabled, and described by the server's reason: start a re-bid instead.
3. **Reviewing evidence (R12, R13, R14, R41).** Each document awaiting confirmation is a card with its type, supplier, file, uploader (a supplier link or staff), issue date, how long it counts (12 months from issue for an undated attestation), scope, content hash, expiry badge and scan status. "Open document", "Confirm" and "Reject" are on every card; a file the malware scan has not cleared can be none of them, with the reason shown once. Rejecting opens a dialog whose "Reject document" enables only once a reason is written. Below, the gaps grid lists each supplier's missing, expired or rejected evidence type; "Record deviation" asks for a reason and an end date no later than the read's limit, after which the gap shows as covered until that date.
4. **Keeping master data honest (R6, R8, R9, R10).** The parts list marks ERP-owned parts and parts an import deactivated; the supplier list shows approval status, scope, end date with an "expires within 60 days" or "expired" badge, evidence status and the latest identity check (verified, register names someone else, not in the register, not checked, no register applies), and says whether the approved-supplier list mirrors the ERP. Open RFQ lines whose part changed after publish carry a "Part changed since publish" flag naming the change (for example "Revision B is now C"), in the RFQ detail and as a count in the RFQ list and on the overview.

### Decisions

- **Every screen declares its reads.** `libs/contracts/src/parts/queries.ts` (`parts.list`), `suppliers/queries.ts` (`suppliers.list`), `evidence/queries.ts` (`evidence.reviewQueue`), and in `rfqs/` `rfqs.list` and `rfqs.assignment`, plus quantity breaks and drift on RFQ detail lines. They follow the API registry rules (`apps/api/src/commands/secondary-screen-queries.spec.ts`). List reads take no input: the tenant comes from the credential.
- **The server decides dates and scope.** Expiry statuses (`current`, `expiringSoon` within 60 days, `expired`, `noExpiry`) and the latest date a deviation may end come in the read with the server date they were evaluated on, and whether a supplier is inside a line's approved scope is a field of the assignment read. Screens compare no dates and derive no scope; the preview's own stand-ins (a new draft's scope marks, confirming, deviations) are marked as such in `apps/web/src/routes/`.
- **Lists filter on the client, in the address.** Search text and one select per list live in the URL (`?q=`, `?category=`, `?approval=`, `?status=`), so a filtered list can be shared. The lists stay well under the grid's 1,000-row threshold in Release 1; a tenant that outgrows it would move the filters into the read's input. A filter that matches nothing shows an empty state with "Clear filters", never an empty grid, and focus returns to the search field.
- **Out-of-scope suppliers are marked, not hidden.** Assignment lists every supplier on every line with "Within approved scope" or "Outside approved scope" (icon and text, and the checkbox's description), plus a suspended or conditional approval and the evidence status. The tenant setting decides: under `warn` (the fixtures) they can be invited and the line summary counts them; under `block` their checkbox is disabled. Choosing suppliers in a grid would put a widget per cell and fight the grid's keys, so each line is a labelled field set of checkboxes, and each supplier's name toggles its box.
- **The builder is a page, not a wizard.** Details, parts and lines are sections of one form, and supplier assignment is its own screen, because the same assignment screen serves a draft saved earlier (RFQ-1050) and shows who a published RFQ invited.
- **The overview reads each section on its own.** A buyer without access to evidence still sees RFQs; each section has its own loading, error, no-permission and empty state under its heading.
- **Opening a document goes through U14's audited download.** Against the API "Open document" is a link to `GET /api/v1/evidence/documents/:id/download` (declared in the contracts); the fixture preview has no files and says so instead.
- **Rejecting needs a reason before the action enables** (plan test scenario), rather than the award form's pattern of showing an error on submit; the disabled button is focusable and described by what is missing.

### Open questions

- **How long a deviation may last.** The read carries the latest end date (`maxDeviationUntil`); the fixtures use 180 days. Whether the limit comes from the market pack, the tenant, or the evidence type is for U15.
- **Assigning suppliers after publish.** The assignment of a published RFQ is read-only here; inviting another supplier to an open RFQ would be an amendment. Whether U16 allows it, and whether invitees see the earlier version, is open.
- **Tenant currency in the builder preview.** A new draft takes CAD until a tenant settings read exists (U8); the API sets it on save.

### Tests

- `apps/web/e2e/secondary-screens.spec.ts`: every screen's loading, empty, error and no-permission states; out-of-scope suppliers on assignment; rejection needing a reason; a view action per document; the builder publishing from fixture parts; extension blocked once answers were shown; amending, drift, deviations, sorting and filtering; axe in both themes; keyboard only.
- Unit tests for the contracts and fixtures (`libs/contracts/src/{parts,suppliers,evidence,rfqs}/*.spec.ts`, the fixture adapter's preview states) and for each form and preview stand-in in `apps/web/src/`.
