# Data Integrity / Authorization QA Pass 2 - 2026-06-13

Browser-based QA against `http://localhost:3100`, authenticated through the app UI. I read
`./.claude/CLAUDE.md` and `docs/security.md` first. No auth bypass, no direct mutation
outside the UI, and notes use stable codes/IDs where possible.

## Scope

Focused on the remaining gaps after the earlier 2026-06-13 QA docs and the GitHub issues
already opened from them.

Tested in browser:

- Valid direct navigation with `?facility=` on `/reactors`, `/applications`, `/facilities`,
  `/certification/removals`, and `/certification/ghg-statements`.
- Cross-facility certification query params for an existing removal and GHG statement.
- A two-tab stale-delete/edit recovery path using a throwaway reactor.
- Application GPS correction behavior on scratch application `AP-26-002`.
- Facility archive preview for active operator facility `FAC-26-001` without confirming.

Residue:

- Created and deleted throwaway reactor `R-26-007` (`QA Integrity Stale 613`).
- Attempted to clear GPS longitude on scratch application `AP-26-002`; reload showed the
  original value still persisted, so no lasting GPS change remained.
- Did not archive any facility and did not create removal/GHG records.

## Already Known / Not Duplicated

I treated these as already covered by docs/issues and did not re-file them:

- `#245` zero-removal GHG statement policy.
- `#246` readiness badge semantics vs removal gates.
- `#247` removal draft behavior when emission estimates are missing.
- `#248` date/time display policy.
- `#249` list-row/action/pagination consistency.
- `#250` status-badge color semantics.
- `#251` raw SQL / params leaking through server-action errors.
- `#252` human identifier/name uniqueness policy.
- `#253` active-facility mismatch on detail routes.
- `#254` production-run `Complete` precondition/state-machine decision.
- `#255` slide-over drawer close/success lifecycle.
- `#256` nested duplicate action buttons in clickable data-table rows.

## Findings

Severity: P0 = critical security/data loss, P1 = high, P2 = medium, P3 = low.

### P2 - Application GPS corrections can be silently ignored, leaving stale field coordinates

**Repro (browser-confirmed on scratch data):**

1. Open `/applications?facility=71bf5709-74dc-48ce-86b4-2fd21c4b0a8b`.
2. Open application `AP-26-002` and click **Edit Application**.
3. Confirm the field position has GPS latitude `-6.9` and longitude `37.65`.
4. Clear **GPS Longitude** and click **Update Application**.
5. The UI shows no field validation error and no server error.
6. The drawer unexpectedly flips to an empty **Create Application** drawer, which is already
   covered by `#255`.
7. Reload and reopen `AP-26-002`; **GPS Longitude is still `37.65`**.

**Expected behavior:**

The app should either:

- reject a half-coordinate with a field-level error (`Both latitude and longitude must be
  provided together`), or
- persist an intentional clear when both coordinates are cleared.

It should not silently keep the old coordinate after the operator attempted to remove it.

**Actual behavior:**

The attempted clear produced no validation feedback, but the stale longitude remained after
reload. This makes wrong application field coordinates hard to correct and can leave stale
location data in application evidence, chain-of-custody maps, and certification context.

**Likely code path:**

- `src/components/applications/application-form.tsx:212` wires the form to
  `applicationFormSchema`, not the stricter `applicationFormSchemaWithGpsValidation`.
- `src/schemas/applications.ts:165` defines the GPS-pair validation helper, but it is not used
  by create/update schemas.
- `src/data-access/applications.ts:532` and `:533` only write GPS fields when the submitted
  value is not `undefined`; clearing the numeric input appears to become `undefined`, so the
  old value is retained.

**Suggested fix:**

Use the paired-GPS schema in the application form and server action schemas. Normalize empty
coordinate inputs to `null` when the operator clears them intentionally, then update both
columns together. Add regression coverage for:

- one coordinate cleared while the other remains -> field-level validation error;
- both coordinates cleared -> both DB fields become `null`;
- edit save does not morph into an empty create drawer (covered by `#255`, but this flow should
  be in that regression set).

No product decision issue was opened for this finding; the application schema already contains
the intended rule, so this is an implementation gap.

## Passing Checks

- GHG statement query-param deep links respect active facility scoping. Opening an operator
  statement ID under QA Pass3 facility rendered `Statements (0)` and did not open the
  cross-facility statement.
- Removal query-param deep links also respect active facility scoping. Opening an operator
  removal ID under QA Pass3 facility rendered `Removals (0)` and did not open the
  cross-facility removal.
- Reactor stale-delete recovery was safe for the tested path. I opened edit for throwaway
  `R-26-007` in one tab, deleted it from another tab, and the first tab no longer retained a
  stale **Save Changes** surface afterward.
- Facility archive preview for `FAC-26-001` clearly listed impacted child records and warned
  that submitted registry records are hidden locally but unchanged in the registry. I cancelled
  before archiving.

## Issue Decision

No new GitHub decision issue was created. The only new finding is a concrete validation/update
bug, not a missing product rule. Existing decision issues `#245`, `#252`, `#253`, and `#254`
still cover the product-rule questions encountered in this lane.
