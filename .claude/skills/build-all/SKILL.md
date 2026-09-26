---
name: build-all
description: Build the whole plan unattended — repeatedly take the next ready unit, build it with the build-unit skill, wait for the merge workflow to merge its pull request, and carry on until every unit is merged. Use when asked to build everything, build the whole app, keep building, or run the factory.
---

# Build every unit

The plan is the newest implementation-ready file in `docs/plans/`. Progress lives in git (merged units and open pull requests), so a new session continues where the last one stopped.

## Loop

1. `git fetch origin`, then read the plan's Implementation Units and Sequencing sections.
2. Take the next ready unit by the build-unit skill's "next" rule. If the prompt that started this session limits you to a lane or a list of units, take only those, so two sessions can run side by side. U33 is operator-run: never take it.
3. Check the product-owner gates in Sequencing before the first Phase D unit, and before U21 or U32. Unless the starting prompt says they are cleared, ask once, then keep building ready units the gates do not block while you wait for the answer.
4. Build the unit with the build-unit skill, end to end, including its pull request.
5. Wait for the merge: every few minutes, `git fetch origin main` and look for a commit whose subject starts with `U<n>: `. While you wait, you may start the next ready unit that does not depend on this one.
6. If CI has had time to finish and the pull request is still open:
   - behind `main`: rebase, rerun the gates and push;
   - CI failed: find the failure (`gh pr checks` when `gh` works here, otherwise rerun `pnpm verify`), fix it on the same branch, rerun the gates and push;
   - a draft, or held by the merge workflow: note why and carry on with units that do not depend on it.
7. Repeat until every unit except U33 is merged. When nothing is ready but pull requests are still open, keep waiting; stop only when nothing is ready and nothing is open, or when a gate is waiting for an answer.

## Report

After each unit, one line: the unit, its pull request and where it stands. At the end: units merged, pull requests held and why, gates still open, and the operator steps for U33.
