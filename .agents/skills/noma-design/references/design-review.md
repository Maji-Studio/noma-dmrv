# noma design review list

Used by the "Design review" section of `SKILL.md`, after `pnpm tsx scripts/check-design-rules.ts --changed` and the `maji-design-app` section 5 list. Each item names the owning section. Read it there; this file does not restate the rule. Report a hit as `path:line`, the item, and the owning doc.

For every item, check the changed code and the 1440 and 390 screenshots.

## Tokens

- Radius is `none`, `full`, `4` or `8`, never a default Tailwind radius or an arbitrary value: `docs/design-system.md` § The invariants that break code silently.
- No shadow on controls or panels: `docs/design-system.md` § Color System, and § Flat controls.
- Spacing uses the 1px scale (`p-4` is 4px, not 16px), and a deleted default class such as `rounded-md` renders nothing: `docs/design-system.md` § The invariants that break code silently.

## Components

- `Button`, not a raw `<button>`: `docs/design-system.md` § Button.
- Dialog actions sit bottom left, primary first: `docs/design-system.md` § Modal (also `.greptile/config.json` rule `ui-action-order`).
- A surface with nothing in it uses `EmptyState`, not bare text: `docs/design-system.md` § Other primitives (and § Missing values for what `EmptyState` is not for); copy in `docs/ux-writing.md` § Empty states.
- A text action is `TextAction`, and a button stays busy until its result shows: `docs/design-system.md` § Button.
- A list cell is quiet: a name before a code, no decorative icon, no grey line that only repeats a code or category; a Sent record shows the lock icon right before its code, not a lock column: `docs/design-system.md` § List-page idiom.
- A sheet's view footer has its actions first and Close last: `docs/design-system.md` § Canonical Page Shell. A form's actions stay pinned to the bottom of the sheet: `docs/forms.md` § FormActions.
- Wet mass comes first, with moisture and dry mass derived after it: `docs/design-system.md` § Wet mass, moisture, dry mass; `docs/forms.md` § Stock blocks lead with wet mass.

## Formatting and copy

- Dates and times go through the shared formatters in `src/lib/format-utils.ts` (`formatDate`, `formatDateTime`, `formatDateRange`, `formatFacilityDateTime`, `formatFacilityDay`, `formatDayString`), never `toLocaleDateString` or `Intl.DateTimeFormat` in a component: `docs/design-system.md` § Date and time display. `src/lib/date-utils.ts` holds the facility clock and input-side helpers.
- Copy follows the terms, structure and review checklist, with no en or em dashes: `docs/ux-writing.md` § Review checklist (and § Core rules, § Message structure for wording).
- A missing value uses the shared token and says what unblocks it where the code knows: `docs/design-system.md` § Missing values; `docs/ux-writing.md` § Missing values.
- A value change is two blocks and an arrow, with unchanged readings left out: `docs/design-system.md` § Before and after.
- A list-page `PageHeader` subtitle stays only when it adds information: `docs/design-system.md` § Other primitives (`PageHeader`).

## Recurring corrections

The four rules live in `SKILL.md` § The corrections that recur. Judge them on the screenshots and the diff.

- Reuse first: a new component or style has no existing sibling that would have done the job.
- Rest state: the screen at rest shows what the next step needs, and the rest opens on interaction.
- One place: no fact, setting or page appears twice unless the log records the repeat, and a replaced surface is deleted.
- Operator decides: no new blocked save, helper flow that enters a record for the operator, or automatic fix without a named data-integrity risk.

## Phone (390)

Judge these on the 390 screenshot. This list is their only home; the related sections are `docs/design-system.md` § Modal (dialog width), § Canonical Page Shell (responsive spacing) and § Other primitives (`DataTable` rows and mobile cards).

- No sideways page scroll.
- A wide table becomes cards or scrolls inside its own box.
- The page reads top to bottom in task order.
- Tap targets meet the 44px minimum and its named exceptions: `docs/design-system.md` § The invariants that break code silently.
- Dialogs fit the screen, actions included.

## Consistency and history

- A style change reaches every sibling surface in the same PR: `docs/design-system.md` § Consistency across sibling surfaces.
- Nothing returns that `docs/design-decisions.md` lists as tried and replaced or rejected. Read § Cross-cutting and the section for the touched surface.
- A PR that lands a pick or a reversal adds its entry to `docs/design-decisions.md` and says who decided: `SKILL.md` § Log the pick.
