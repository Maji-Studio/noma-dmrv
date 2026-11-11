---
name: noma-design
description: noma-dmrv's UI layer on top of maji-design-app. Points to noma's design system, forms, copy and decision docs, and covers what is specific here (wet mass first, explanations behind an (i), the corrections that recur, clickable prototype rounds, answer pages for picks, Before | After evidence, advisory design review). Use for any UI work in noma-dmrv, such as building or changing a page, sheet, form, dialog, table, chart or map, choosing between layouts, writing interface copy, prototyping, or reviewing a UI PR.
---

# noma design

Load `maji-design-app` first and follow its steps. This skill adds what noma decides differently or more precisely, and wins where the two differ.

## Sources (read the target before the work)

- `docs/design-system.md`: tokens, spacing trap (default Tailwind spacing and radius classes are deleted), Canonical Page Shell, list-page idiom, dialogs, choice controls, illustrations, EmptyState, wet/dry mass.
- `docs/forms.md`: FormField, FormActions, explanations behind an (i), derived blocks, entity selects.
- `docs/ux-writing.md`: terms, message structure, missing-value tokens, no en or em dashes (`pnpm check:ux-copy` enforces the dashes).
- `docs/design-decisions.md`: what was tried per surface, what replaced it, and what the user rejected. Read § Cross-cutting and the section for your surface before proposing anything.
- `GLOSSARY.md`: domain terms override casual wording.

## noma specifics (look up the owning section, do not restate it)

- Wet mass first: `docs/design-system.md` § Wet mass, moisture, dry mass; `docs/forms.md` § Stock blocks lead with wet mass.
- Explanations: `docs/forms.md` § Explanations behind an (i) (one view, `ExplanationInfo`, two inline lines).
- CERT chip: `docs/forms.md` § CERT chip status.
- Dialogs: `docs/design-system.md` § Modal (action order, width, linked records).
- Locks: `docs/design-system.md` § Notice (the lock box); `docs/design-decisions.md` § Credit batches and locks (no action the record cannot take).
- Consistency: `docs/design-system.md` § Consistency across sibling surfaces.
- List cells: `docs/design-system.md` § List-page idiom (quiet cells, names before codes).
- Sheet footers: `docs/design-system.md` § Canonical Page Shell (view mode: actions, then Close); `docs/forms.md` § FormActions (pinned to the bottom).
- Text actions and busy buttons: `docs/design-system.md` § Button (`TextAction`; busy until the result shows).
- Missing values: `docs/design-system.md` § Missing values; `docs/ux-writing.md` § Missing values.
- Value changes: `docs/design-system.md` § Before and after (two blocks and an arrow).

## The corrections that recur

These four come back in the decision log and in review more than any others. Apply each one before the user sees the work.

- **Reuse first.** Build from the component a sibling surface already uses (`DataTable`, `FormActions`, `TextAction`, `RemovalRecords`, the list pages' filter select). A new style is the option the log rejects most. When nothing existing fits, say so on the answer page and show the nearest existing one beside the new one.
- **Rest state.** At rest a screen shows what the operator needs for the next step. Everything else opens on interaction: groups closed, the first three rows then "Show all N", a details view one click away, the reason behind an (i).
- **One place.** One working page per thing, one setting per choice, one line per fact. When two surfaces do the same job, merge them and delete the other. A repeat on purpose (a sheet that previews a routed page, a form footer that repeats the credit batch) is a pick the log records.
- **Operator decides.** Lead the options with the simplest one: the save goes through, a to-do or a note shows what is open, and a sent record stays locked. Offer a blocked save, a helper flow that enters a record for the operator, or an automatic fix only against a real data-integrity risk, and name that risk in the option.

Done when the work passes all four, or the answer page names the one it breaks and why.

## Picks go on an answer page

Every design decision that belongs to the user (a variant, a wording, a trade-off) goes on an answer page or the PR's merge card, a single question included. This replaces the threshold of three in `maji-design-app` step 6.

- One card per question: a plain question, the situation in two sentences of operator words, a picture of the concrete example, options that say what happens, the recommendation preselected, a note field.
- The picture is a rendered mock, a screenshot or before → after blocks. A wording question shows each framing as a rendered mock with the user's own numbers.
- Later rounds go on the same page, with the settled answers folded.

Done when the user can answer every open question from the page alone.

## Prototypes in noma

- Build variants in a worktree from `scripts/worktree.sh new`, on the real route, with `?variant=`. Add `?scenario=` for the states that matter, so the user can click through the whole flow and its important empty, blocked and error cases.
- The agent that builds the variants knows only its brief. Name `maji-design-app` and `noma-design` for it to load, and paste the decision log entries for the surface, Rejected lists included.
- Before the links go out: typecheck, lint, every variant and scenario renders, and every variant has passed the text habits list in `maji-design-app` step 5 and `docs/ux-writing.md`. A prototype round has no screenshot pass; the user clicks through in the browser.
- Hand over the server command the script prints for the user to start (a server an agent starts stops after two hours), the sign-in, and one link per variant and scenario. A worktree server on another port shares localhost cookies with :3100 and can loop sign-in; say so and give the fix with the links.
- Expect rounds. The user picks, combines ("A's list with B's walk") or asks for more. A picked variant keeps its letter and its refinements extend it (D1, D1a), so the log can name them.
- After the pick: fold it in, delete the switcher and the losing variants, and keep no prototype code in the PR.

## Log the pick

The PR that builds a pick or a reversal adds its entry to `docs/design-decisions.md` under the surface: the date, what was there, what replaced it, the variants tried under their letters, what was rejected, and who decided. A choice made without the user's pick is logged as the agent's call and listed on the PR for them. This replaces proposing the wording in chat (`maji-design-app`, Learn from corrections); a lesson that reaches beyond noma goes on the answer page as a proposed `MAJI-##` rule.

Done when the entry is in the PR's diff.

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

`pnpm verify:static` runs the mechanical design checks (the `check:*` scripts in `package.json` and the ESLint rules for Phosphor imports). A check failure is a design bug, not a lint nuisance. The design-rules helper above sits outside it and never fails a build.
