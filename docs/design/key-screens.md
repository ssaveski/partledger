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
3. **Recording a quote received outside the portal (R42).** After close, every cell where the portal holds no current quote from that supplier (pending, late or stale) offers "Record outside quote". The dialog asks for the price, currency, minimum order quantity, one-off costs, lead time, validity, the date it arrived (refused after the deadline) and the supplier's document. The recorded quote carries the "Recorded by a buyer" marker in the grid and in the approval packet, and the line's lowest total is highlighted again.
4. **Approving or rejecting (F5, R23, R24, R41).** The approval packet shows who submitted the award and when, the gate checklist with each check's outcome as a message, every line's decision with the winning supplier's evidence (status, expiry and content hash) and any active deviation, the exchange rates, and the previous round of a re-bid. Approve and Reject are disabled, with the server's reason beside them, when the read says they are not allowed.

## Decisions

- **The server decides what is allowed.** Screens read `allowedTransitions` and `blockingReasons` (message keys with params) from each query (R32) and never re-derive the lifecycle. A disabled action stays focusable (`focusableWhenDisabled`) and is described by its reason, so a keyboard or screen-reader user learns why it is unavailable.
- **Answers cannot leak before close by construction.** The RFQ detail contract has no field that could carry an answer, and every contract object is strict, so an extra field fails parsing in the client. The comparison read of an open RFQ is a separate `notYetClosed` shape with no lines.
- **Lowest is highlighted, never chosen.** The best-price cell has a green border, bold total and trophy icon; the copy above the grid says the lowest total is never chosen for you. Winner selects start empty, and the lowest option is labelled "(lowest total)" rather than preselected.
- **Winners are chosen outside the grid.** The grid follows the APG grid pattern with one widget per cell (KTD28). A select inside a cell would fight the grid for arrow keys, so each line's decision is a labelled field set below the grid. Only current quotes and alternates a quality engineer accepted are offered as winners (R22); stale, pending, late and no-quote cells are not.
- **The outside-quote action sits in the cell that lacks a quote.** The plan asks each supplier column to offer it after close. Putting it in the header would add the button's name to every cell's column header for screen readers, so it appears in each cell of that supplier's column where the portal holds no current quote, named with supplier and line ("Record outside quote from Kestrel Machining for line 4"). A supplier that answered every line has nothing to record.
- **Colour is never the only signal.** Every cell state, marker and evidence status has its own icon and a label; the legend shows the same label the cell announces (visually hidden text beside the icon).
- **Instants are shown in UTC and say so**, because deadlines are decided in UTC (R19). Amounts use Canadian English formatting, so a USD or EUR price keeps its code (`US$41.10`, `€67.20`) and totals are always in the tenant currency.
- **Designed states on every screen.** Loading (with a page heading for assistive technology), empty with a next action (never an empty grid), error with retry and a message key, and no permission. A malformed RFQ id is "Page not found"; an unknown one is the not-found error from the server.
- **After a client-side navigation focus moves to the main region**, and a skip link reaches it from the top of the page.

## Contracts and client

- Read contracts: `libs/contracts/src/rfqs/queries.ts` declares `rfqs.detail`, `rfqs.comparison` and `rfqs.approvalPacket` with U5's `defineQuery`; they pass the API registry rules (`apps/api/src/commands/rfq-queries.spec.ts`) so Phase D registers handlers without changing them.
- Typed client: `libs/contracts/src/client/` parses input before sending and output on arrival against the same declaration. Failures are values (`refused`, `invalid`, `unauthenticated`, `unavailable`, `malformed`), never thrown; a `Forbidden` refusal renders the no-permission state.
- HTTP adapter: `GET /api/v1/queries/<name>?input=<json>` through the same-origin `/api` proxy (KTD30), mapping 401, validation and declared refusal bodies.
- Fixture adapter: serves `libs/contracts/src/fixtures/` (invented parts, suppliers, people and certificates) through a JSON round trip, with simulated latency in the browser.
- Writes are preview-only. Submitting an award, approving, rejecting and recording an outside quote change nothing on a server. Recording an outside quote updates the cached comparison with a synthetic normalisation (`fixtureNormalisedTotal`); U19 and U20 replace these with commands, after which the screen reads the comparison again.

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
