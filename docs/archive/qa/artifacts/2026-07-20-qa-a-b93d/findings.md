# QA-A findings

## P0 — Current HEAD cannot render any route

- **Route:** `/login` (also blocks all application routes)
- **Exact action/input:** start the current checkout with `pnpm dev` and request `http://localhost:3100/login`.
- **Expected:** login renders.
- **Actual:** HTTP 500 and the development build overlay; generated CSS contains an invalid wildcard custom-property radius value.
- **Reproducibility:** repeated on a clean `.next` rebuild. Testing could proceed only from an isolated archive with the documentation example neutralized.
- **Evidence:** [server-compile-blocker.png](screenshots/server-compile-blocker.png)
- **Likely root cause:** `docs/design-system.md:35` contains a Tailwind arbitrary-class example with a wildcard custom property. Tailwind source scanning begins at `src/app/globals.css:1`; the wildcard radius theme is declared near `src/app/globals.css:378`. The documentation token is interpreted as a class and emitted as invalid CSS.

## P1 — Fresh-session facility deep link loses context (#473)

- **Route:** `/reactors?facility=2b1db56d-f0ce-44c9-86a1-0d9b62aa64b3`
- **Exact action/input:** open the URL in a fresh isolated browser context, sign in through the normal UI, and do not open the organization switcher.
- **Expected:** the active organization and `E2E QA-A Facility One 20260720-b93d` resolve from the valid facility ID.
- **Actual:** URL canonicalizes to `/reactors`; the shell shows generic organization branding, `Select a facility`, and `Add First Facility`.
- **Reproducibility:** 1/1 isolated fresh-context attempt; consistent with open issue #473.
- **Evidence:** [fresh-session-deeplink.png](screenshots/fresh-session-deeplink.png), `raw-results.json`
- **Likely root cause:** `src/components/navigation/facility-provider.tsx:49` depends on active organization state before resolving the query parameter, while `src/hooks/use-facilities.ts:80` and `:105` disable facility queries when the organization ID is `null`.

## P1 — Rapid double-submit creates duplicate facilities

- **Route:** `/facilities`
- **Exact action/input:** open Create Facility, enter `E2E QA-A Facility Two 20260720-b93d`, then dispatch a rapid double click on `Create Facility`.
- **Expected:** one mutation and one facility row.
- **Actual:** matching row count increased from 2 to 4; two persistent facilities were added.
- **Reproducibility:** 1/1 instrumented double-submit attempt.
- **Evidence:** [facility-creation.png](screenshots/facility-creation.png), `raw-results-pass4.json`
- **Likely root cause:** the client disables from mutation pending state only after submission (`src/components/facilities/facility-list.tsx:113-129`, `:461-468`; `src/components/forms/form-actions.tsx:60-67`). The create path has no request idempotency or uniqueness backstop; code allocation in `src/data-access/code-generator.ts:196-238` makes each duplicate look independently valid.

## P2 — Exact duplicate facility names are accepted

- **Route:** `/facilities`
- **Exact action/input:** create a second facility named exactly `E2E QA-A Facility One 20260720-b93d` in the same organization.
- **Expected:** reject the duplicate or explicitly warn and require disambiguation.
- **Actual:** a second row with the identical display name was accepted and given another generated code.
- **Reproducibility:** 1/1 attempt.
- **Evidence:** [facility-creation.png](screenshots/facility-creation.png), `raw-results-pass3.json`, `raw-results-pass4.json`
- **Likely root cause:** `src/schemas/facilities.ts:149-155` validates trim and length only; the create data-access path has no organization-scoped name uniqueness check.

## P2 — Facility switcher is unreachable while detail or form sheet is open

- **Route:** `/production-runs?facility=<primary>&run=f6a1b91d-7bd4-4cc4-877a-fed50f9e76e8` and `/production-runs?facility=<primary>` with Create Run open
- **Exact action/input:** open a production-run detail sheet or create form, then click the sidebar facility selector to switch to Facility Two.
- **Expected:** switch and reconcile URL, navigation, facility label, and data, or offer an explicit close-and-switch flow.
- **Actual:** the modal overlay intercepts the pointer; the facility selector cannot be operated.
- **Reproducibility:** 2/2 states (detail and form).
- **Evidence:** `raw-results.json`; the recorded run shows both attempts.
- **Likely root cause:** the shared `src/components/ui/entity-side-sheet.tsx` uses modal/inert behavior that covers the navigation shell.

## P3 — Archive preview hides zero-count dependency categories

- **Route:** `/facilities`
- **Exact action/input:** choose Archive for Facility One, which has one reactor and one production run but no application or sample.
- **Expected:** preview makes it possible to confirm that applications, samples, and other dependency classes were evaluated.
- **Actual:** preview says only `Also archives: 1 reactor, 1 production run.` Applications and lab samples are absent.
- **Reproducibility:** 1/1 attempt.
- **Evidence:** [archive-preview.png](screenshots/archive-preview.png), `raw-results.json`
- **Likely root cause:** all required categories exist in `IMPACT_LABELS` (`src/components/facilities/archive-facility-dialog.tsx:23-37`), but `impactParts` filters out zero values at `:51-55`. Backend impact counting includes these classes; this is preview transparency rather than evidence of missing cascade logic.

## Security-negative results

No cross-scope disclosure or accidental editing was observed. A Facility One production-run link opened under Facility Two discarded the `run` parameter and displayed the safe error. The same link opened from the second organization exposed no QA-A organization data. See [cross-scope-denial.png](screenshots/cross-scope-denial.png).
