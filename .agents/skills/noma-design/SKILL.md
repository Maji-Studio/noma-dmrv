---
name: noma-design
description: noma-dmrv's UI layer on top of maji-design-app. Points to noma's design system, forms, copy and decision docs, and covers what is specific here (wet mass first, explanations behind an (i), worktree prototypes, Before | After evidence, advisory design review). Use for any UI work in noma-dmrv, such as building or changing a page, sheet, form, dialog, table, chart or map, choosing between layouts, writing interface copy, prototyping, or reviewing a UI PR.
---

# noma design

Load `maji-design-app` first and follow its steps. This skill adds what noma decides differently or more precisely.

## Sources (read the target before the work)

- `docs/design-system.md`: tokens, spacing trap (default Tailwind spacing and radius classes are deleted), Canonical Page Shell, list-page idiom, dialogs, choice controls, illustrations, EmptyState, wet/dry mass.
- `docs/forms.md`: FormField, FormActions, explanations behind an (i), derived blocks, entity selects.
- `docs/ux-writing.md`: terms, message structure, missing-value tokens, no en or em dashes (`pnpm check:ux-copy` enforces the dashes).
- `docs/design-decisions.md`: what was tried per surface, what replaced it, and what the user rejected. Read the entries for your surface before proposing anything.
- `GLOSSARY.md`: domain terms override casual wording.

## noma specifics (look up the owning section, do not restate it)

- Wet mass first: `docs/design-system.md` § Wet mass, moisture, dry mass; `docs/forms.md` § Stock blocks lead with wet mass.
- Explanations: `docs/forms.md` § Explanations behind an (i) (one view, `ExplanationInfo`, two inline lines).
- CERT chip: `docs/forms.md` § CERT chip status.
- Dialogs: `docs/design-system.md` § Modal (action order, width, linked records).
- Locks: `docs/design-system.md` § Notice (informative box, no unavailable action).
- Consistency: `docs/design-system.md` § Consistency across sibling surfaces.

## Prototypes in noma

- Build variants in a worktree from `scripts/worktree.sh new`, on the real route, with `?variant=`. Give the user the server command the script prints, the sign-in, and the variant links.
- A worktree server on another port shares localhost cookies with :3100 and can loop sign-in; say so and give the fix with the link.
- After the pick: fold it in, delete the switcher and the losing variants, and keep no prototype code in the PR.

## Evidence and review

- Screenshots and GIFs come from `codex-computer-use`; Playwright with the `adminPage` fixture is the fallback.
- Every UI PR carries Before | After at 1440 and 390, plus GIFs for interactions, hosted on the orphan `issue-assets` branch.
- UI PRs wait for the user's OK before merging, even when merging is otherwise allowed.

## Design review (advisory)

Review a PR or branch for design drift. Findings never block; the author decides.

- Scope: the files the PR or branch changes, plus screenshots at 1440 and 390 of the screens it touches.
- Run `pnpm tsx scripts/check-design-rules.ts --changed` first. It is report-only (rules `radius`, `shadow`, `raw-button`, `formatting`; `--rule <name>` limits it; explicit file paths also work) and exits 0 with findings. Confirm each hit against the code before reporting it.
- Then the judgement checks: the LLM text habits in `maji-design-app` section 5, then the noma list in `references/design-review.md`.
- Report findings as `path:line`, each with the rule and its owning doc, ordered by what the operator would notice first. No score.

## Guards

`pnpm verify:static` runs the mechanical design checks: spacing scale (`check:spacing-scale`), CSS variables (`check:css-vars`), UX copy dashes (`check:ux-copy`), and the ESLint rules for Phosphor imports. A check failure is a design bug, not a lint nuisance.

The design-rules helper above is not part of `pnpm verify:static`. It never fails a build.
