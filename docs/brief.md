# Product brief — Partledger (working name)

Last updated: 2026-09-26. Status: pre-planning. This brief is the input for the first implementation plan.

---

## In one paragraph

Small and mid-sized manufacturers buy parts from dozens or hundreds of suppliers through spreadsheets and email. Their own customers, and now EU law, increasingly demand proof: certificates, material declarations, software parts lists, and a traceable record of why each supplier was chosen. Partledger keeps every part, its approved suppliers, their quotes and the proof behind them in one place. It syncs from the ERP, lets AI read supplier documents, and locks each approved award into a record auditors can verify. A compliance pack per market (EU and Canada first, US later) decides which proof each part needs.

---

## Why now

- **Compliance is pushed down the supply chain.** Tier-2 and tier-3 suppliers receive questionnaires and document requests from the manufacturers they supply, often beyond their own legal duties. 70.1% of German Mittelstand buyers rank supplier management as their top digitalisation need (Onventis purchasing barometer 2026).
- **New EU rules with fixed dates:**
  - Cyber Resilience Act: vulnerability and incident reporting applies since 11 Sep 2026; the main obligations, including due diligence on third-party components, SBOMs and a declared support period, apply from 11 Dec 2027.
  - Machinery Regulation (EU) 2023/1230: applies from 20 Jan 2027 with no transition period; technical documentation is kept for 10 years; it covers AI-driven safety functions and cyber-safety.
  - NIS2: medium and large makers of electronics, electrical equipment, machinery and vehicles must manage supplier security (Art. 21).
  - REACH/SCIP, RoHS and conflict-minerals declarations per part.
  - CBAM: definitive regime since 1 Jan 2026 for importers of covered goods above 50 tonnes a year; first annual declaration due in 2027.
  - Forced Labour Regulation: applies from 14 Dec 2027 to companies of every size.
  - AI Act: transparency duties (Art. 50) apply from Aug 2026; procurement is not a high-risk use.
- **Quality systems and customer audits** (AS9100/EN 9100, ISO 9001, IATF 16949) expect traceable supplier approval and sourcing decisions.
- **Today it runs on spreadsheets and email:** no audit trail, no comparable quotes, no expiry tracking.

---

## Who it is for

- **First customer:** a Canadian aerospace manufacturer (AS9100) running Global Shop Solutions ERP. Its data must stay in Canada.
- **Next:** North American job shops and precision manufacturers on the same ERP; EU manufacturers with 20–250 staff in robotics, electronics, machinery and aerospace (tier 2–3) facing the machinery and CRA deadlines.
- **Roles:** the buyer is the head of purchasing or quality; daily users are buyers and quality engineers; supplier staff answer through links, without accounts.

---

## What it does

| Module | What it does |
|---|---|
| Parts and suppliers hub | Reads parts, suppliers and the approved-supplier list (with approval scope and expiry) from the ERP or a spreadsheet. Verifies supplier identity against the EU VAT register (VIES) and the LEI register (GLEIF). |
| Evidence vault | Requests, collects and tracks certificates and declarations per supplier and per part. AI reads each document, extracts fields and expiry dates, and flags gaps. The market packs decide what each part needs. |
| RFQs and quotes | RFQs straight from a parts list (BOM), with several suppliers per line for competition. Suppliers answer through scoped, expiring links: exact quote, no-quote with a reason, or an alternate. AI reads quote PDFs into the form. Side-by-side comparison. |
| Approval and sealed awards | An award cannot be approved until every winning supplier's required evidence is on file and valid. Approval seals the quotes, evidence hashes and approver into a hash-chained record that can be verified offline and exported for auditors. |
| Answer your customers | Because evidence is held per part, the platform produces the pack a customer requests for a part you supply: declarations, certificates, SBOM and support period. |
| Reports | Cycle time, supplier responsiveness, quote variance, approval times, expiring evidence. |

---

## Market packs

A tenant can enable several packs, for example a Canadian manufacturer exporting to the EU.

| Pack | Evidence it requires | Hosting |
|---|---|---|
| EU | CRA: SBOM, support period, vulnerability contact. Machinery Regulation declarations of conformity or incorporation. REACH/SCIP, RoHS, conflict minerals (CMRT). CBAM emissions data from non-EU suppliers of covered goods. NIS2 supplier-security questionnaires. | EU region, GDPR |
| Canada | AS9100 supplier approval and scope. Forced and child labour reporting (S-211). | Canada region |
| US (later) | UFLPA forced-labour traceability, conflict minerals, export-control flags. | US region |

---

## ERP integration

- Read-only. The platform never writes back to the ERP.
- For everyone: spreadsheet import with AI-assisted column mapping.
- First connector: Global Shop Solutions, the first customer's ERP. Its database is Actian Zen (formerly Pervasive), readable over ODBC; GSS can also produce scheduled flat-file or XML exports. When the ERP is on-premises, a scheduled export drop is simpler and safer than a database tunnel. Data pulled: supplier master, approved-supplier list with capabilities, part master, BOM references.
- Later, one connector per paying customer's ERP (for example SAP Business One, Microsoft Dynamics 365 Business Central, Odoo).

---

## AI features and their rules

- Reads supplier PDFs (certificates, declarations, quotes) into structured fields; flags missing, expired or mismatched evidence; drafts evidence requests and reminders; suggests suppliers from past RFQs; flags quote outliers against history.
- AI never decides. People approve every award and every supplier approval.
- Every AI suggestion and its acceptance or rejection is audited with its actor type.
- Supplier staff are told when content comes from AI.
- The model provider must process each tenant's data in that tenant's region or a region the tenant approves.

---

## Ready for AI agents

- **Now:** every audit entry records its actor type (person, AI agent, supplier token) and the approval it acted under.
- **Later, when a paying customer asks:** an agent-readable interface (for example an MCP server) on top of supplier tokens to read an RFQ and submit a quote, plus an A2A agent card. EU Business Wallet mandate checks once that regulation is adopted (likely 2028 or later).
- **Out of scope:** agent payment protocols (ACP, AP2, Visa and Mastercard agent programs, x402). They serve consumer checkout or micropayments, not quotes, approvals or invoice terms.

---

## Competition (checked September 2026)

| Vendor | What it covers | Gap for us |
|---|---|---|
| Tacto | RFQs with quote PDF parsing, supplier documents with expiry, REACH/RoHS, conflict minerals, CE, LkSG/CSDDD, CBAM, AI agents; EU-hosted, ISO 27001; Mittelstand to large companies | Closest competitor. No CRA/SBOM or Machinery Regulation evidence; no tamper-evident awards mentioned. |
| JAGGAER | Enterprise sourcing with AS9100/IATF supplier qualification and RoHS/REACH/CMRT | Enterprise-priced |
| Onventis, Ivalua, SAP Ariba, Coupa | Procurement suites | Enterprise, or weak on compliance evidence |
| osapiens, IntegrityNext, Assent, Kodiak Hub | Supplier compliance data (LkSG, CBAM, REACH, conflict minerals) | No RFQs. Assent sells a supplier-side request manager from $250/month. |
| Fairmarkit | Enterprise AI sourcing; per-event audit trail exportable to Excel | Trail not described as tamper-evident; enterprise |
| Luminovo | Electronics (EMS) quoting and sourcing | No public audit trail; electronics only |
| Paperless Parts | Seller-side quoting for job shops (ITAR, CMMC) | Not a buyer tool |

No vendor checked claims any of: tamper-evident award records auditors can verify; CRA or Machinery Regulation supplier evidence inside sourcing; published pricing for small manufacturers.

---

## First release

What the first customer needs: the parts and suppliers hub (Global Shop Solutions import plus spreadsheet), RFQs and quotes with supplier links, approval and sealed awards, the audit trail and reports, the Canada pack, and Canadian hosting. The EU pack follows the first EU customer.

### Not in the first release

- Drawings and export-controlled technical data. ITAR in the US and the Controlled Goods Program in Canada restrict who may access and host it; store part numbers and document status only.
- The US pack, supplier discovery or marketplace, payments, automatic negotiation, writing back to the ERP, the agent-facing interface.

---

## Constraints

- **Data residency per tenant** (Canada, EU), chosen when the tenant is created.
- **GDPR:** the team is in North Macedonia, which has no EU adequacy decision, so EU tenants are hosted in the EU and covered by standard contractual clauses and a data processing agreement.
- **Security:** aim for ISO 27001 (competitors have it). The platform is itself software sold in the EU and falls under the CRA.
- **IP:** the first customer's build runs under a separate contract. Settle its IP terms before building customer-specific features here.

---

## Business model (hypothesis to test)

- €400–900 a month per company, unlimited suppliers.
- €15–25k a year for aerospace customers needing dedicated regional hosting and WORM storage.
- Paid setup for ERP connectors.

---

## Risks

1. Tacto adds CRA and Machinery Regulation evidence (estimate: 12–24 months).
2. Small manufacturers' willingness to pay is unproven; most demand is passed down from their customers.
3. No competitor markets tamper-evident awards. That may be a gap or a sign nobody asks for it; test with buyers before building around it.
4. Tools that extract SBOMs from firmware (for example ONEKEY) reduce the need to request SBOMs from suppliers.
5. Two people must also handle certification, keep regulatory content current, and sell.
6. IP terms with the first customer.

---

## Open questions

- Frontend: Vue 3 or React?
- At the first customer, is Global Shop Solutions on-premises or GSS-hosted, and is ODBC access or a scheduled export allowed?
- Which EU vertical first: robotics, electronics, machinery or aerospace?
- When to start ISO 27001?
- Product name.

---

## Sources

- Cyber Resilience Act: https://digital-strategy.ec.europa.eu/en/policies/cyber-resilience-act and reporting https://digital-strategy.ec.europa.eu/en/policies/cra-reporting
- Machinery Regulation: https://single-market-economy.ec.europa.eu/sectors/mechanical-engineering/machinery_en
- NIS2: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32022L2555
- CBAM definitive regime: https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism/cbam-definitive-regime_en
- Forced Labour Regulation: https://single-market-economy.ec.europa.eu/single-market/goods/forced-labour-regulation_en
- AI Act: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai and Annex III https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-3
- European Business Wallet: https://digital-strategy.ec.europa.eu/en/policies/business-wallets
- Canada S-211: https://laws.justice.gc.ca/eng/acts/F-10.6/page-1.html
- UFLPA: https://www.cbp.gov/trade/forced-labor/UFLPA
- VIES VAT validation: https://ec.europa.eu/taxation_customs/vies/
- GLEIF LEI: https://www.gleif.org/
- Tacto: https://tacto.ai/en/product
- JAGGAER aerospace and defense: https://www.jaggaer.com/vertical/aerospace-defense
- Fairmarkit event history: https://docs.fairmarkit.com/buyers/events/view-event-details-and-history
- Luminovo security: https://luminovo.com/security
- Assent Request Manager: https://www.assent.com/asp/request-manager/
- osapiens: https://www.osapiens.com/en/solutions
- IntegrityNext: https://www.integritynext.com/product-compliance
- Kodiak Hub: https://www.kodiakhub.com/use-cases/product-compliance
- Paperless Parts: https://www.paperlessparts.com/
- Onventis purchasing barometer 2026: https://www.onventis.de/blog/einkaufsbarometer-mittelstand-2026/
- ONEKEY: https://www.onekey.com/
- A2A protocol: https://github.com/a2aproject/A2A
- MCP specification: https://modelcontextprotocol.io/specification/latest
