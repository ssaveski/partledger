---
name: build-unit
description: Build one implementation unit from the plan in docs/plans/ end to end — implement it with its tests, pass every gate, get two independent reviews (plus a UX review for UI work), have each finding challenged by a verifier, fix what survives, and open a pull request that the CI merge workflow merges once `verify` passes. Use when asked to build, implement or continue a unit ("build U3", "next unit").
---

# Build one plan unit

Input: a unit ID such as `U3`, or "next". The plan is the newest implementation-ready file in `docs/plans/`.

## 1. Orient

- Read `CLAUDE.md`, the plan's Goal Capsule, the unit's section (goal, requirements, dependencies, files, approach, test scenarios, verification) and every Key Technical Decision the unit cites. Read the parts of `docs/brief.md` the unit touches.
- "next" means the first ready unit in the order of the plan's Sequencing section (Phase A's design lane, then its data lane, then Phases B to E): its dependencies are merged into `main`, it has no open pull request, and no product-owner gate listed in Sequencing blocks it.
- Check the unit's dependencies are merged into `main`. If one is not, stop and report which unit must land first.
- Work on the branch `unit/<id>-<short-name>`, created from the latest `main`, or continue it if it already exists.
- If a GitHub issue exists for the unit (its title starts with the unit ID), note its number.

## 2. Implement

- Write the code and its tests together. The plan's test scenarios are the minimum, not the whole suite.
- Stay inside the unit. Anything you notice outside it goes into the pull request as a follow-up, not into the diff.
- UI work follows the plan's design system and key-screen specs: keyboard access, visible focus, labels on every control, and designed loading, empty and error states.

## 3. Gates

Run every check the plan's Verification Contract names for this unit: typecheck, lint, unit tests, integration tests, and end-to-end tests when the unit ships UI. Commands live in `package.json` scripts.

- Evidence comes only from commands run in this session. Never claim a check passed without running it.
- Fix and rerun until green, at most five rounds. If still red, stop and report the blocker.
- Never weaken, skip or delete a test to get green.

## 4. Reviews

Spawn in parallel, each with fresh context:

- two `reviewer` agents;
- one `ux-reviewer` agent when the unit changes UI.

Give each only: the unit's section of the plan, the output of `git diff main...HEAD`, and `CLAUDE.md`. Do not pass your own reasoning or this conversation.

## 5. Verify

Merge duplicate findings. Send each finding (batched where convenient) to a `verifier` agent, whose job is to prove it wrong. Keep only findings the verifier confirms, or cannot refute with evidence.

## 6. Fix and re-gate

Fix every surviving finding. Add a test for each behavioural fix, then rerun all gates. If a fix would change the unit's scope or contradict the plan, stop and report instead of guessing.

## 7. Pull request

- Rebase on the latest `main`. If the unit touches `libs/db`, regenerate migrations and run `pnpm db:check`. Rerun the gates if the rebase changed anything.
- Commit with conventional messages that name the unit, for example `feat(rfq): compare quotes side by side (U7)`.
- Push the branch and open a pull request titled `U7: <unit name>`, ready for review, so the CI merge workflow merges it once `verify` passes on top of the latest `main` (plan KTD6).
- Open it as a draft instead, so the owner merges it, when the unit is U3, when a finding stays unresolved, or when the diff changes `.github/`, `.claude/`, `CLAUDE.md` or `docs/plans/`.
- The body lists what was built, the gate commands and their results, the review outcome (findings confirmed, refuted, fixed), and follow-ups. Add `Closes #<issue>` when the unit has an issue.
- Never push to `main` and never merge by hand.

## 8. Report

Finish with: the unit, the branch and pull request link, whether it merges automatically or waits for the owner (and why), gate results, findings confirmed versus refuted, follow-ups, and the next unit that is ready.
