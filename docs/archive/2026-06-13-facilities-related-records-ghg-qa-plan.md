# Facilities, Related Records, Removals, and GHG QA Plan - 2026-06-13

Browser QA against local `http://localhost:3100` using the authenticated app UI. I read `./.claude/CLAUDE.md` first and did not bypass app authentication or authorization flows.

## Scope

Focused destructive-but-safe checks around facilities, child records, delete/archive flows, certification removals, and GHG statement generation.

Test residue created during this pass:

- Created and archived scratch facility `FAC-26-008` (`447bd29c-adc7-4e0d-a787-9ba01c4bc37b`), name beginning `QA Edge Facility 20260613 !@#$% &' long-name ...`.
- Created then deleted scratch reactor `R-26-007` (`QA Edge Reactor !@#`).
- Created then deleted scratch storage bin `SL-26-009` (`QA Edge Storage !@#`).
- No new removal or GHG statement was created. I stopped at GHG confirmation to avoid sending a new Isometric sandbox create request.

## Already Known / Not Duplicated

Open or archived items I treated as known:

- #245 zero-removal GHG statement policy.
- #246 readiness badge semantics vs removal gate semantics.
- #247 removal draft behavior when emission estimates are missing.
- #248 date/time display format policy.
- #250 status-badge color semantics.
- #251 raw SQL / params leaking through server-action errors.
- #252 human identifier / name uniqueness policy.
- #253 active-facility mismatch on detail routes.
- Existing archive findings for whitespace-only names, duplicate empty-state CTAs, storage-bin dependency delete messaging, and GHG overlap validation history.

## Finding 1 - Shared slide-over drawers remain open or blank after close/success

Priority: P1\
Likely layer: UI / hooks, specifically `SlideOverPanel`, `EntitySideSheet`, entity form containers, and the GHG create drawer close lifecycle.
GitHub: #255

### Steps to Reproduce

Facility create:

1. Open `/facilities?facility=f346545f-ac5e-4642-95f1-9110458012f1`.
2. Click **New Facility**.
3. Fill a long/special-character name, country `Tanzania`, timezone `Africa/Dar es Salaam`, GPS `0, 0`, and valid contact data.
4. Click **Create Facility**.
5. The facility is created and the optional **Link Isometric project** dialog opens.
6. Click **Cancel** in the link dialog.
7. Observe that the original **Create Facility** drawer remains visible with the already-saved values.
8. Click **Cancel**, the close icon, or press Escape.

Reactor/storage create:

1. In the scratch facility, create a valid reactor or storage bin.
2. Observe the new row/card appears in the list.
3. Observe the create drawer remains mounted and visible.
4. Click **Cancel**.

GHG wizard:

1. Open `/certification/ghg-statements?facility=f346545f-ac5e-4642-95f1-9110458012f1`.
2. Click **New GHG Statement**.
3. Enter `2026-07-31`, click **Next**, then **Next** again.
4. On confirm, click **Cancel**.

### Expected Behavior

Successful create should close/unmount the create drawer after mutation success. Cancel/Close/Escape should always dismiss an open drawer without requiring a full page reload. The GHG wizard should close cleanly from every step.

### Actual Behavior

- Facility create stacked the link dialog on top of the original create drawer. Canceling the link dialog exposed the original create drawer, still filled with saved values.
- Reactor and storage create succeeded, but the create drawer stayed open afterward. Cancel did not dismiss it.
- GHG confirm Cancel left a blank `640px` drawer shell mounted with no title, no controls, and no content.
- A full reload was required to recover from the stuck/blank drawer states.

### Why It Matters Operationally

Operators can believe a save failed, re-enter or retry a completed action, or get blocked mid-workflow. In certification paths, a blank stuck drawer during GHG generation is especially risky because it interrupts a period-selection flow and leaves no visible recovery affordance.

### Suggested Fix

- Add regression coverage for `SlideOverPanel`/`EntitySideSheet` close semantics: successful entity create, Cancel after success, nested optional-dialog close, and GHG wizard Cancel from each step.
- Ensure controlled `open={false}` reliably unmounts or hides `Dialog.Popup` and backdrop after exit transitions.
- Audit the recent `.slide-over-panel-popup` state CSS in `src/app/globals.css` and `src/components/ui/slide-over-panel/index.tsx`; the popup must not remain visible/interactable when closed.
- For form containers, ensure `onSubmit` promises are returned/awaited consistently and close state is set after mutation success.

## Finding 2 - Clickable table rows expose nested duplicate action buttons

Priority: P2\
Likely layer: UI / accessibility, specifically shared `DataTable` row-click semantics plus `RowActionsMenu`.
GitHub: #256

### Steps to Reproduce

1. Open `/reactors?facility=447bd29c-adc7-4e0d-a787-9ba01c4bc37b` while the scratch reactor exists.
2. Inspect or navigate the row containing `R-26-007`.
3. The row itself is exposed as a `button` because `DataTable` sets `role="button"` for `onRowClick`.
4. The same row also contains a nested `button` with `aria-label="Actions for R-26-007"`.
5. Browser automation sees two `Actions for R-26-007` buttons: one visible action and one hidden/duplicate target.

### Expected Behavior

Clickable rows should be keyboard accessible without creating invalid nested interactive controls. The overflow menu trigger should have one accessible target and should not be duplicated by a parent row button.

### Actual Behavior

The row button accessible name includes the action label, and the nested action button has the same accessible label. This creates ambiguous locators, likely invalid interactive nesting, and unclear screen-reader navigation.

### Why It Matters Operationally

Operators using assistive technology or keyboard navigation can encounter duplicated actions or confusing row/action semantics. Automated QA also has to work around ambiguous controls, which reduces confidence in regression coverage around edit/delete actions.

### Suggested Fix

- Replace `role="button"` on table rows with a non-nested row activation pattern, such as a dedicated first-cell detail button/link or `aria-selected`/keyboard handlers that do not turn the row into a button.
- Keep `RowActionsMenu` as the only action-menu button in the row.
- Add an accessibility regression that each row exposes exactly one overflow-menu trigger and no nested interactive controls.

## Finding 3 - GHG zero-removal confirmation does not carry forward the preview warning

Priority: P2\
Likely layer: UI / product policy. Tracked by #245; included here as browser-confirmed context, not a duplicate issue.

### Steps to Reproduce

1. Open `/certification/ghg-statements?facility=f346545f-ac5e-4642-95f1-9110458012f1`.
2. Click **New GHG Statement**.
3. Enter `2026-07-31` and click **Next**.
4. Preview shows `PREDICTED TO BE LINKED (0)` and no open removals in the period.
5. Click **Next**.

### Expected Behavior

If zero-removal GHG statements remain allowed, the final confirmation should repeat the zero-removal warning and require an explicit acknowledgement. If they are disallowed, the flow should block before confirmation.

### Actual Behavior

The final confirmation says only: create a GHG Statement for `2026-07-01 -> 2026-07-31`; the `0 predicted removals` warning is absent from the last step and **Create GHG Statement** remains available.

### Why It Matters Operationally

The final action is the last chance to prevent creating a compliance artifact with no linked removals. Operators can miss the preview warning and create a statement that later needs reconciliation or cleanup.

### Suggested Fix

Resolve #245 and enforce the chosen policy in both Preview and Confirm. If allowed, carry the warning into Confirm and require explicit acknowledgement.

## Finding 4 - Facilities list flashes an incorrect empty state before data loads

Priority: P3\
Likely layer: UI / hooks loading state.

### Steps to Reproduce

1. Navigate directly to `/facilities?facility=f346545f-ac5e-4642-95f1-9110458012f1`.
2. Observe the first render before facility data resolves.

### Expected Behavior

The page should show a loading skeleton or pending state until the facilities query resolves.

### Actual Behavior

The page briefly rendered **No facilities yet** before correcting to `Active Facilities 7/8`.

### Why It Matters Operationally

It is transient, but on slower connections it can make operators think data disappeared, especially after archive/delete actions.

### Suggested Fix

Gate the empty-state branch on `!isLoading && facilities.length === 0`, matching the pattern used by entity tables with loading skeletons.

## Passing Checks

- Facility long/special-character name did not overflow the sidebar selector; it clipped safely.
- Facility invalid phone number was blocked with `Please enter a valid phone number`.
- Reactor required fields, negative throughput, and zero throughput were blocked with inline messages.
- Reactor double-submit created exactly one row.
- Storage required fields, missing feedstock type for feedstock bins, negative capacity, and zero capacity were blocked.
- Empty scratch storage bin deletion closed cleanly and updated counts.
- Empty scratch reactor deletion closed cleanly and updated counts.
- Archiving the active scratch facility removed it from active lists and rewrote the active `facility=` parameter to another active facility instead of leaving a dead archived-facility param.
- Removal detail deep links restored after reload; browser forward eventually restored the sheet after the data query settled.
- GHG overlap on `2026-06-30` was blocked with a clear message. `2026-07-31` advanced to preview, so the earlier stale-overlap bug appears fixed.
