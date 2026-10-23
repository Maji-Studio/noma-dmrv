# Forms Guide

Conventions, invariants and traps for form handling in noma-dmrv — React Hook Form + Zod 4 schemas in `src/schemas/`, components from `@/components/forms`. Read this before writing or editing any form or form schema. It carries only what the code does not state plainly: which of two coercion layers to use, which shared schema helper already exists, and the round-trip bugs that hand-rolled validation reintroduces.

Related: [design-system.md](./design-system.md) owns the visual contract (tokens, the [form type set, lines and spacing](./design-system.md#form-type-lines-and-spacing), the moisture and composition pictures) · [architecture.md](./architecture.md) owns React Query + `ActionResult` + server-action layering · [code-style.md](./code-style.md) owns naming and React Compiler rules · [storage.md](./storage.md) owns uploads.

Canonical form to copy from: `src/components/feedstocks/feedstock-form.tsx`.

## Organization operating defaults must exist before RHF mounts

React Hook Form reads `defaultValues` once. Organization defaults therefore
cannot arrive in an effect after a create form mounts: that race silently keeps
the system fallback for the lifetime of the form. The `(app)` layout resolves
the active organization's defaults server-side, and `FacilityProvider` seeds
the organization-scoped React Query entry through
`useOrganizationDefaults(..., initialData)` before child forms render. Create
forms call `useOrganizationDefaultValues()` synchronously and apply defaults
only in create mode; saved records always win in edit mode.

Keep that hydration chain intact when adding a default. Update the config,
schema/table, server payload, settings editor, and consuming form together.
Changing an operating default never rewrites existing records and never changes
a protocol constant. The settings editor deliberately waits for loaded data and
keys its inner RHF form by the loaded values because its own `defaultValues`
also need a remount to change.

## Schemas

Schemas live in `src/schemas/<feature>.ts`, grouped by feature. Always export the inferred type (`export type MyFormData = z.infer<typeof myFormSchema>`) — never define a type in a component body when a schema already describes that shape.

A **form schema** holds UI fields only; the **server action schema** extends it with ids the client does not type (`facilityId`, `projectId`):

```typescript
export const createItemSchema = itemFormSchema.extend({ projectId: z.uuid() });
```

When form and update variants share a repeated object shape (ingredient bins, allocations), extract a base schema and `.extend()` per variant — the form variant adds the preprocessors, the server variant does not.

For integer row-version preconditions, use `expectedVersionSchema` from
`@/schemas/helpers` on update and delete schemas. It requires the positive
integer loaded with the record and tells the operator to reload when it is
missing or invalid. Every edit form uses this integer mechanism. See [architecture.md](./architecture.md#expected-version-checks-on-edit-forms).

### Zod 4 string formats

Format checks are **top-level**, not chained. The chained forms still compile but emit a deprecation diagnostic.

| Deprecated | Use |
|---|---|
| `z.string().uuid()` | `z.uuid()` |
| `z.string().email()` | `z.email()` |
| `z.string().url()` | `z.url()` |
| `z.string().datetime()` | `z.iso.datetime()` |
| `z.string().date()` | `z.iso.date()` |

New UUID inputs use `uuidSchema(message?)` from `@/schemas/helpers`, not bare
`z.uuid()`: it lowercases the id, so ids compare and fingerprint the same way
rows come back, and the published schema is unchanged. Keep
`.uuid(msg).toLowerCase()` on existing chains such as
`z.string().min(1, …).uuid(…)`: piping a chained check through `uuidSchema`
drops `format: uuid` from the OpenAPI document.

`z.iso.datetime()` accepts UTC `Z` only by default — exactly what `Date.prototype.toISOString()` emits. Pass `{ offset: true }` for numeric offsets, `{ local: true }` for none. Validate timestamp **format** at parse time rather than guarding `Number.isNaN(new Date(x).getTime())` downstream.

`z.ZodIssueCode.custom` is still the in-repo idiom for `ctx.addIssue` under Zod 4 (see `src/schemas/helpers.ts`, `src/schemas/samples.ts`, `src/config/env.ts`) — do not churn those call sites.

Empty-string handling: HTML inputs send `""` where `.optional()` expects `undefined`. Use `z.string().max(1000).optional().or(z.literal(""))` for text, and `emptyToNull` for ids (below).

## Numeric coercion — pick the right layer

Two mechanisms exist. **`@/schemas/helpers` is canonical for new and changed
numeric fields**: coercion belongs in the schema via `z.preprocess`, so server
actions re-validating the same payload get the same behaviour.
`@/lib/form-utils` (`numericValue` / `nullableNumericValue` / `integerValue`,
applied at the register site with `setValueAs`) remains in forms whose schemas
expect numbers already (including the current application form). **Never apply
both to the same field** — double coercion.

**Never use `valueAsNumber: true`** — it turns `""` into `NaN`, which fails every Zod branch.

Do not write an inline **numeric** preprocessor or hand-roll a range check that
`helpers.ts` already ships. Small field-specific normalization still exists for
non-numeric select values (for example `"" → undefined` on optional application
enums); do not mistake that scoped compatibility pattern for a second numeric
coercion system. Extract a named/shared preprocessor when the same normalization
repeats.

| Need | Use (from `@/schemas/helpers`) |
|---|---|
| Optional finite number, empty → `null` | `optionalNumber` |
| Optional non-negative number | `optionalPositiveNumber` |
| Optional 0–100 percent | `optionalPercent` |
| Required number with friendly messages | `requiredNumber(requiredMsg, invalidMsg)` |
| Raw preprocessor, empty → `null` | `toNumberOrNull` |
| Raw preprocessor, empty → `undefined` | `toNumberOrUndefined` |
| Integer, empty → `null` | `toIntOrNull` |
| Soil temperature (°C) | `defaultSoilTemperatureSchema` |
| Clearable patch field (see below) | `clearableNumber` · `clearablePositiveNumber` · `clearableDefaultSoilTemperature` · `toClearableNumber` |

`requiredNumber()` already packages the Zod 4 `error: (iss) => iss.input === undefined ? … : …` callback — do not hand-write that lambda.

`toIntOrNull` does **not** `parseInt`. It uses `Number(trimmed)` and, when the result is `NaN` or non-integer, returns the **raw trimmed string** so Zod reports a type error. That is the point: it rejects partial parses like `"12abc"` instead of silently accepting `12`.

> **Gotcha — clearing a value on edit needs empty → `null`, never empty → `undefined`.** Drizzle's `.set()` drops `undefined` keys, so an update built from `undefined` leaves the old value in the database: the field appears un-clearable and the change silently reverts. `null` is an explicit value Drizzle persists. (Reference: `src/components/storage-locations/storage-location-form.tsx`.)

### The partial-update contract: omitted / null / zero

One meaning per value, the whole way down — form field, Zod schema, server
action, data access:

| Value | Meaning | What the writer does |
|---|---|---|
| `undefined` | omitted from this patch | leaves the stored value alone |
| `null` | explicit clear | writes `NULL` |
| `0` | the number zero | writes `0` |

Three rules follow.

**Clearable numeric inputs register with `nullableNumericValue`, not
`numericValue`.** `numericValue` maps `""` to `undefined`, which the contract
reads as "omitted", so clearing the field is a silent no-op. Use
`numericValue` only where the schema requires the field (it can never be
cleared) or where the schema's own preprocessor normalizes `undefined` away.
The same trap in reverse is `value ?? undefined` in a submit handler or a
`setValue` call: pass the `null` through instead.

**Update schemas use the `clearable*` family; create and whole-form schemas
keep `optionalNumber` / `optionalPositiveNumber`.** `toNumberOrNull` folds
omitted into cleared, which is right when every field is present (a create, or
a form that always submits the whole record) and wrong for an `update*Schema`,
where an absent key must not overwrite a column. `toClearableNumber` keeps
`undefined` as `undefined` and turns `""` / `null` into `null`.
`updateFeedstockSchema.transportDistanceKm` is the reference case: the derived
transport leg preserves its stored distance only while that key is absent, so
folding to `null` wiped a manual distance on every unrelated edit.

**The server derives values it owns rather than trusting the patch.** Feedstock
dry mass is derived from the *effective* wet mass and moisture (patch value
falling back to the stored row) inside the same locked transaction, so a
moisture-only edit yields the right dry mass. `massDryKg` is not a PATCH input.
Cross-field rules work the same way: `updateFeedstockType` re-validates the
merged category/usage pair against the stored row, because a refine on the
patch alone never fires when only one half of the pair is present.

### Mass and integer caps

Masses are backed by `numeric(14,3)` columns. A hand-rolled `z.number().positive()` lets a fat-fingered entry reach Postgres as a raw `numeric field overflow`. Use the capped family instead — `massKgSchema` · `positiveMassKgSchema` · `requiredMassKgSchema` · `requiredPositiveMassKgSchema` · `optionalMassKgSchema`. They enforce `MASS_INPUT_MAX_KG` (100,000,000 kg) / `MASS_INPUT_MAX_TONNES` with a friendly message.

Same reasoning for `PG_INTEGER_MAX` on integer columns, and `RATIO_INPUT_MAX` (9.999999) for ratio fields backed by `numeric(7,6)` whose domain exceeds `[0, 1]` (H:C org, O:C org). True 0–1 fractions keep their own `.max(1)`.

### Native number constraints

A number input's native `min`, `max` and `step` come from the Zod schema that
validates it, never from hand-typed numbers. Build a lookup once at module
level and spread it onto the input:

```typescript
const numberBounds = numberInputConstraintsFor(sampleFormSchema);
<FormInput id="totalCarbonPercent" type="number" {...numberBounds("totalCarbonPercent")} … />
```

`numberInputConstraintsFor` (`@/lib/number-input-constraints`) unwraps
preprocess pipes, nullables and `"" | number` unions, reads array elements
(`"ingredients.sharePercent"`) and throws on an unknown path. `step` is the
schema's `multipleOf`, 1 for an integer, else `"any"`; an exclusive bound
(`.positive()`) becomes the next step, or the bound itself with `"any"`. For a
lone field schema use `numberInputConstraints(latitudeSchema)`. A form may set
`step` after the spread when its display precision differs (formulation
shares). `number-input-bounds-coverage.test.ts` fails on a number input with no
bounds spread and no `min`.

The native attributes give the spinner its range and expose min and max to
assistive tech. They do not block a save: `FormActions`' submit sets
`formNoValidate` on click (`skipNativeChecksUnlessUnparsed`), so the schema's
messages explain a refusal. The exception is a number input holding text the
browser cannot parse ("1e"): it reports an empty value the schema would read as
cleared, so the browser's own check stays on and blocks the save.

### GPS coordinates

Facilities, supplier locations and customer locations require a GPS pair to
save. Updates may omit the pair to preserve it, but cannot clear it or supply
only one coordinate. Supplier and customer creation requires at least one
location. Their optional one-way site distances must be greater than zero
when entered; empty values clear the distance.

`latitudeSchema` / `longitudeSchema` (optional, nullable) and `requiredLatitudeSchema` / `requiredLongitudeSchema` (with the required-vs-invalid message distinction built in) all expect a **number**, so form schemas wrap them:

```typescript
gpsLatitude: z.preprocess(toNumberOrNull, latitudeSchema),
gpsLongitude: z.preprocess(toNumberOrNull, longitudeSchema),
```

Range checks alone are not enough: a half-filled pair otherwise validates. Attach `.superRefine(gpsPairSuperRefine)` to any schema carrying `gpsLatitude` / `gpsLongitude` — it points the error at the coordinate still missing. Reference usage: `src/schemas/customers.ts`.

### Cross-field error revalidation

Every React Hook Form that uses a schema with `.refine()` or `.superRefine()`
must render `ResolvedErrorRevalidator` with its `control` and `trigger`. React
Hook Form normally merges resolver results for only the field that changed, so
correcting a related field can otherwise leave an old error visible elsewhere.
The revalidator watches values in an isolated, non-visual child and revalidates
only field paths that already have Zod errors; it leaves imperative
`manual`/`server` errors alone, does not validate untouched fields, and does not
rerender the parent form on every keystroke.

Prefer the `PositionPicker` component (map preview + address search + manual lat/lng) over a hand-rolled coordinate input.

## Saved values after a lock refusal

`useSaveRefusal` requires the form's `resetField` alongside `setError`. Its
locked-field reset uses RHF defaults, so those defaults must describe saved
values. Delivery and feedstock initialize from the opened record. Feedstock
resets both its total and single-bin allocation mass together. Application
updates its defaults explicitly when an update commits but an attachment upload
fails: the parent adopts the returned row and calls the form's committed-record
callback, which uses `reset(committedValues, { keepValues: true, keepSubmitCount: true, keepIsSubmitted: true, keepDirty: true })`. Typed input
stays on screen; a background refetch never re-syncs the form. A stale-version
refusal does not replace that snapshot. The profile password pane also wires
`resetField`, although it has no record-lock read. The customer location has no lock-read kind, so after a lock refusal its form disables name and GPS from local state until the dialog reopens or switches location.

Mutations declare affected kinds with `recordLockMeta`. A `certification_locked`
`ActionError` refreshes those kinds even though the write failed; unrelated
failures leave ordinary lock reads alone. Registry mutations refresh all kinds
even on other failures. Refetching retains ready status while saved lock data
is available.

When the re-read turns the whole record Sent, the form is read-only and `FormActions`
hides its footer, so the refusal would vanish. `EntitySideSheet` (edit mode) and
`RecordLockFormFrame` hold a refusal slot above the lock line, shared through
`RefusalSlotContext` (`src/components/ui/refusal-slot-context.tsx`; the element is
kept in a `useState` ref callback, no effect). On `block.readOnly` with an error
message `FormActions` portals `TopRefusal` into that slot and focuses it, since
the Save button that held focus is gone. After a `certification_locked` refusal it says only
"Your changes were not saved." (`useSaveRefusal` files `errors.root.lockRefusal`, which
`FormActions` reads through `control`; the error summary skips `root`, the next submit
clears it); the lock line below keeps the reason and how to free the record. Any other
message (a partial save, a stale version, a form not yet on the hook) shows as the
server worded it, since the fields were not necessarily reverted. It is a focusable `role="group"`
named by its own text, not a live region, so a screen reader hears it once from
focus. Without a slot the box renders inline. A refusal made only of locks focuses
the summary box (also a named group) rather than the field, which is disabled once
the lock read lands, whether or not a reason sits beside the count, so the reason is
read from it; a locked link in the summary scrolls to its field without focusing it.
A refused override edit on a delivery or feedstock goes back to the saved override
as a whole (distance, source, note, and whether the panel is open).

## Dates

Union date fields use `dateOrStringSchema` from `@/schemas/helpers`.
The resolver shows the first branch's first issue, so the helper puts strings
first and shares that message with server validation.

Use `calendarDateSchema` from `@/schemas/helpers` for business dates persisted
as **UTC-midnight date-only values**, such as the feedstock delivery date. It
accepts strict `YYYY-MM-DD` strings and real calendar days only, decodes them to
a UTC-midnight `Date`, and publishes as `format: date`. Server re-validation
accepts a `Date` only at UTC midnight. Use
`toDateInputValue(value, facilityToday(timeZone))` for defaults of these
persisted UTC date-only values. Resolve `timeZone` with
`useFacilityClock(record?.facilityId ?? activeFacilityId)` so empty or invalid
values default to the facility calendar day. Unknown facilities use the shared
UTC fallback.

Use `requiredDateOnlySchema(<required message>)` / `optionalDateOnly` where a date is combined with a
facility time, as in production runs. They parse `"YYYY-MM-DD"` at **local**
midnight, because `new Date("YYYY-MM-DD")` parses as **UTC** midnight, which can
render as the adjacent day and walk a stored date on an edit/save round-trip.
`z.iso.date()` validates a string but does not produce a `Date`.

New-record business dates use `facilityToday(timeZone)` from
`@/lib/date-utils`, never the browser calendar. Physical event inputs keep UTC
instants and show them through `EventTimeInput` on the facility clock. Use
`formatFacilityWallClock` when a facility-local datetime input value is needed.
`toDateInputValue` preserves the stored UTC calendar of date-only records;
its required second argument supplies the facility day for empty/invalid values.

Timezone fields use `requiredTimezoneSchema()` / `optionalTimezoneSchema()` / `ianaTimezoneSchema()` from `@/schemas/timezone` (the one valid-IANA-zone check, backed by the `@vvo/tzdb` catalogue in `@/lib/timezones`) and the `TimezoneCombobox`, never a hand-listed enum. No timezone has a default: facility fields start empty and required, and the organization default may stay unset.

**Incident and in-process measurement times** use `EventTimeInput` and the
parent production run's facility clock. Their shared schemas use
`createEventInstantSchema(<field message>)` so a cleared time gets a plain
message. Writers resolve `{ date, time }` through
`resolveEventInstant` with the saved parent run's facility zone. Offset-free
datetime strings are refused. A measurement needs at least one recorded value
(zero counts), with the empty-record error on Weight.

**Output stock event times** (product placed, delivery, loss, count) are entered
and shown on the facility clock, like production runs
([output-stock.md](./output-stock.md)). The contract:

- `EventTimeInput` (`src/components/forms/event-time-input.tsx`) is the only
  picker. Its RHF value is an ISO 8601 UTC instant and it takes the facility
  `timeZone`. A time skipped or repeated by a daylight-saving change is refused,
  not shifted: the field value stays empty, the typed time stays visible, and
  the input says why under itself (`eventTimeRefusal`).
- `useFacilityClock(facilityId)` (`src/hooks/use-facility-context.ts`) gives
  `{ timeZone, hint }`; pass `hint` as the `FormField` `cue` (which clock the
  time is on is a unit the operator needs while typing).
- `stockEventInstantSchema()` (`@/schemas/helpers`) validates the wire value.
- Read surfaces format it on the same clock; see
  [design-system.md](./design-system.md#date-and-time-display).

A lab sample's sampling time uses the same picker on the clock of its credit
batch's facility (round 7 Q51): the zone comes from the batch durability
summary, with the context facility's clock until that loads. The server
action schema takes a `Date` or an instant with an explicit offset, never a
bare wall clock.

## Components

New or touched leaf and shared components should import from `@/components/forms/<file>` because the barrel loads every entity editor, increasing unit-test import cost. Move existing barrel imports in those components as they are edited. Full forms may keep using the `@/components/forms` barrel (`src/components/forms/index.ts`); read it for the full surface and TypeScript prop signatures, with only non-obvious contracts documented here.

- **`FormField`** — three kinds of help, one rule: **the ⓘ holds explanations; a `cue` stays visible only for a unit, a limit or a consequence** the operator needs while typing.
  - `hint` and `helperText` both render behind the ⓘ beside the label (hint first), whatever their length. They also reach screen readers as the control's description. Definitions, examples, "why we ask", plain scope notes ("Seeds new orders.") and typical ranges ("0 to 100% of wet mass", "Only an empty bin can switch to split.") go here.
  - `cue` is one visible `body-caption` line under the control: "Minimum 8 characters", "-90 to 90", "Facility time: Africa/Dar es Salaam", "1,200 kg available from this delivery", "Seeds new facilities. Existing facilities keep their own." (organization defaults timezone), "Applies to new Sources across the organization." (registry default visibility), "Annual average for this application site" (soil temperature). It is tagged by hand at the call site; never move an explanation into it to make it visible. Exception: exactly the last three examples above (the timezone and default-visibility scope notes and the soil temperature definition) stay visible as cues by product decision; no other explanation may be a cue. An error or warning replaces it while shown.
  - `cueAction` ({ label, onClick, disabled?, ariaLabel? }) puts one tertiary text action at the right of the cue row, for a shortcut that fills the control from the cue's figure ("Add all" beside "1,000 kg available from this delivery"). It stays mounted whenever `cue` has text, even while an error or warning replaces the cue's message, so a click that follows the input's blur still lands. Compute the value with `wholeStockDrawKg` (`@/lib/stock-overdraw`), set it with `shouldDirty`, `shouldTouch` and `shouldValidate`, and omit the action (do not dim it) when the field is locked.
  - `unit` renders a suffix inside the control ("kg", "%", "km"), so the label drops its "(kg)". The label keeps the unit for screen readers. Use it only for a single input; the read-view value already carries the unit, so the read label drops it too.
  - The label row is `min-h-24` (the ⓘ hit area), so a one-line label reads at the same height with or without a CERT chip or ⓘ. The ⓘ is a sibling of the `<label>`, never inside it.
- **`FormError` / `ServerError`** — field-level vs server-level; both carry `role="alert"`. A refused save is split, not all-or-nothing: an issue whose field is on screen shows at that field, the rest show once in the error box. A form calls `useSaveRefusal` (`src/components/forms/use-save-refusal.ts`) and calls the returned function from its submit `catch`, **inside the `handleSubmit` callback** (RHF works out `isSubmitSuccessful` when the callback ends, and `FormErrorSummary` shows only after an unsuccessful submit, so a later `setError` is never listed or focused). Its handler is `(error: unknown, fallback: string) => string | null`: it returns the plan's footer, including `null` when every issue sits at a field, or the supplied fallback for a stale-version or conflict refusal, a refusal without issues, or a non-`ActionError`. This handler owns the one footer rule; parents keep their conflict and blocker side effects. The rule itself is `planSaveRefusal` (`src/lib/save-refusal.ts`). Server paths the form names differently go in an alias map next to the payload builder (`feedstockUpdatePayload`, `applicationOperationInput`, delivery's shared `DELIVERY_REFUSAL_ALIASES` next to `deliveryOperationInput` in `src/schemas/deliveries.ts`). A server path the form splits across several controls goes in `splitFields` (`{ serverPath: [controlNames] }`), for example an instant split into a date control and a time control: the production run's `startTime` is `startDate` plus `startTime`. A change to any part counts as a change to the field, a refusal files its error on every part, and a lock reverts and marks every part. Aliases match the whole dotted path first, then patterns where `*` matches exactly one segment and the target's `*` takes that segment (for example `ingredients.*.wetMassKg -> ingredientBins.*.massKg`), then the first segment. The delivery create action returns operation paths (form-schema refusals keep form names); the update action validates and writes with form names except stock posting refusals (`occurredAt`, `wetMassKg`). The form applies the shared map, which carries those two to the delivery date and the load mass. A lock refusal (`certification_locked`) restores the saved value with `resetField`, then shows **"Locked. Your change was not saved."** at a field the operator changed and that is on screen; the lock's reason shows once in the footer, and a lock without a changed visible field goes to the footer only. Lineage refusals include changed operation fields so their typed values revert too. The summary words it apart: "Not saved. 2 fields are locked." (mixed: "Not saved. Fix 1 field. 2 fields are locked."). Forms that do not use the hook yet keep the footer line. Never copy a server rule into the form just to show it at the field; the server's issue now lands there. Parents hand the form's handler the caught error and their existing fallback: `onSubmit(data, onRefusal)`, then `setError(onRefusal(error, fallback))`; a null footer means every reason sits at a field, so `?? fallback` would wrongly bring the generic line back (see `delivery-list.tsx`, `feedstock-list.tsx`, `application-list.tsx`, `order-list.tsx`, `sample-list.tsx`, `credit-batch-list.tsx`). The picker edit dialogs hand it through `usePickerEditSubmit` (`onSubmitWithRefusal` in `entity-edit-forms.tsx`), which keeps the `ActionError`. `saveCreditBatchEdit` returns the thrown error as `cause` for the same reason. A form whose field revalidates itself (credit batch end date) must skip that when the error is a server or locked one, or the refusal is cleared at once.
- **`FormSelect`**, **`FormInput`**, **`FormTextarea`** — styled primitives; spread `{...register(name)}`.
  Use `EntitySelect` / `FormEntitySelect` for lists of user data, including
  customer locations, deliveries and registry projects or templates. Keep
  native `FormSelect` for hard-coded lists such as enums, units and roles.
- **`ChoiceCardGroup`**, **`SegmentedControl`** — native-radio choice controls, spread `{...register(name)}` like `FormSelect`. When to use which, and the sizing and a11y contract: [design-system.md](./design-system.md#choice-controls--srccomponentsforms). Evidence method is the card reference (`application-evidence-panel.tsx`). The bin stock sheet opens Lost mass directly and has no loss / count selector.
- **`MassMoistureFields`** — the canonical wet-mass + moisture pair for an unmixed material, with the live `MoistureSplit` bar spanning both. It owns the labels, wet-basis hint, range helper, and derived readout. A blended biochar product is the exception: pair standalone `WetMassField` and `MoistureField` controls with `ProductCompositionPreview`, because finished-product moisture does not split tracked dry biochar from ingredients and water. The standalone fields also cover lab samples with no paired mass and bin stock-takes whose counted mass is recorded separately. Each takes the caller's `register(...)` result so `setValueAs` stays with the owning form. Pass `materialLabel` ("Biochar", "Feedstock") to qualify canonical labels, and `step="any"` for a column backed by `real` instead of the exact `numeric` families. Vocabulary and precision come from `@/lib/mass-moisture` — see [design-system.md](./design-system.md#wet-mass-moisture-dry-mass). (`DryMassInput` and its "Dry: 237.5 kg" caption are gone.)
- **`DistanceCalcField`** — derived transport-leg distance. It and similar derived-with-provenance fields (distance plus `distanceSource`) are wired with `useController`, one per field, written through `field.onChange(...)`; never `watch` / `useWatch` plus `setValue`. Pass `null` to clear, not `undefined`: `useController` falls back to the default value on `undefined`, so a cleared saved value reappears. A provenance select bound to a controller field spreads `{...field}` instead of `register`, as `transport-leg-form.tsx` does. Reference: `src/components/customers/customer-location-fields.tsx`.
- **`DistanceOverrideField`** (`src/components/transport-legs/distance-override-field.tsx`) — the feedstock and delivery One-way distance, two-state per GLOSSARY "Distance override": the location's facility distance read-only, or an override (distance, source, note). One outline `Button` (`variant="default"`, 40px) sits outside the input, to its right, and wraps below it on a narrow sheet: "Override" unlocks entry, "Reset to default" returns to the location default. Provenance ("From {location}. Source: …", "Override. Location default is 42 km.") reads behind the label's ⓘ, never as a visible state label; the only caption is an actionable one (no location distance, with its repair link). The form owns the mode and maps it with `distanceOverridePatch` (`distance-override.ts`): a derived or unchanged value is omitted, `null` clears an override, a positive number sets one. Never send a derived distance back as data. Read views mirror it with `distanceReadFields` (same ⓘ text) and show drift with `TransportDistanceDriftNotice`; edit forms show it as the compact `DistanceDriftAction` under the input, disabled while the form has unsaved edits, and reopen on the refreshed version.
- **`PositionPicker`** (+ `PositionValue`, `PickerAccent`) — lat/lng entry.
- **`FormFileUpload`** — see [File upload](#file-upload).

Notes/description/address textareas inside a grid always span full width: wrap in `md:col-span-2` (2-col grids) or `md:col-span-3`.

A dropdown takes the full width of the form, and its menu is as wide as the
field. It never shares a row with another field or action. Where a legacy
layout still forces sharing, the important dropdown sits on the left. Table
toolbars, filters and pagination are exempt.

Free-form **Notes** fields are always the final editable field before
`FormActions`. Put derived previews or selectable cohorts immediately after the
inputs that control them, then place Notes after those previews. Documentation
uploads remain the explicit ordering exception: the upload goes immediately
before its trailing Notes field.

Dynamic repeatable rows use RHF `useFieldArray` — reference: `src/components/formulations/formulation-form.tsx`.

### FormSection

A `SectionLabel` title over a `space-y-16` field stack, with a `pt-16` hairline divider above every section but the first (mirrored by `DetailSection` on plain read-only panels). The title style is in [design-system.md](./design-system.md#form-type-lines-and-spacing). `EntitySideSheet` read mode renders its configured `DetailSection`s through the shared `DetailSpine`. Its numbered passive rail is enabled only when the paired edit form uses `FormSpine`. Never hand-roll a section wrapper or rail. Caveats that live here:

- `divider` (default `true`) — the first section of a plain form passes `divider={false}`. **`divider` is ignored entirely inside a `FormSpine`**, which owns its own rail chrome; that is why the spine example below omits it.
- `hint` / `certifyRequired` forward to `SectionLabel`; `actions` adds right-aligned header chrome (an "Add" button, a badge).
- Omit `title` for a group whose field labels already identify it. The section
  keeps its divider and field spacing without an empty heading row. Read views
  mirror this: a `DetailPanelSection` without a title requires a stable `id`
  for its React key. Titled sections may also supply an `id`.

### Vertical rhythm

- **`space-y-20`** — all side-sheet forms (top-level `<form>`), sectioned or not. `FormSection` owns intra-section rhythm; nothing else sets section spacing.
- **`space-y-24`** — full-page and auth forms only.
- Field grids inside sections: `grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-20` for inputs only; a dropdown gets its own `grid-cols-1` row (see the dropdown rule above).
- Controls in a field-grid row top-align independently. `FormField`'s fixed
  `min-h-24` label row keeps one-line labels level; a wrapped label still shifts
  only its own control down. Do not "fix" that with per-field label heights,
  spacer elements, or a shared subgrid — a `.grid > .form-field` subgrid was
  tried and reverted (it staggered grids containing any non-`FormField` child
  and opened voids under neighbors of fields with always-visible helper text).
  Prefer labels short enough not to wrap.

### FormActions

The only CTA row — left-aligned, primary action first, sticky by default, nothing renders after it.

- Never stack a parent dialog or step-flow footer beneath `FormActions`. The
  embedded form owns the one action row. Give its secondary action the
  context-specific label (for example, `cancelLabel="Not now"`) and omit the
  parent footer for that step.
- Submission-level server/action/root errors go through `errorMessage` (references the refusal named go in `errorAction`). `FormActions` renders them as the form's one error box at the end of the form, directly above the sticky footer; never earlier in the form or in a parent sheet. The footer keeps only the Save blocker, `preview` and the buttons. Do not render the same error in a parent sheet.
- **Error box.** One `Notice tone="error"`, never two. The bold title is the first sentence of the server message (`splitErrorMessage`, `src/lib/error-title.ts`; a lead such as "Feedstock was not saved." folds into "Not saved. <next sentence>"), the rest of the message is the detail, `ServerError` outside `FormActions` splits the same way. With `control`, a Save that validation refused shows
  `FormErrorSummary` as that box: the count title ("Not saved. Fix N fields."), the server message as detail, one link per field error in form order labelled with the field's name only (the reason shows once, at the field; "Share, row 2" for an array row), then `errorAction`. Focus moves to the first field, scrolled to the middle of
  the sheet; each link focuses its field. With no field error the box shows the message alone and a refused Save scrolls it into view (`nearest`) and focuses it, once per attempt. The list follows the live errors and
  goes once none are left. Save stays pressable. It finds a field by its RHF
  path as the control's `data-field-name`, `name` or `id`: a `Controller`
  widget keeps its `id` equal to the field name, or sets `data-field-name`
  (`EntitySelect` takes `fieldName`, `PositionPicker` takes `fieldNames`). An
  error with no matching control lists unlinked, by its message. The list is not a live
  region: one sr-only alert announces each refused save, so fixing a field
  does not re-read the whole list. A field message that is long may run the full form width: `FormField errorOutside` plus `FieldErrorRow` in the grid (see the delivery wet mass).
  Do not hand-roll a summary or a focus-first-error helper in a form.
- Nested inline forms (child-entity editors, transport legs) pass `sticky={false}`.
- Sheet forms pass `control` (the RHF `control` object). It feeds the side
  sheet's unsaved-changes guard with `formState.isDirty`, which is the only
  signal that sees programmatic `setValue` from custom widgets. Inside a sheet
  the Cancel *click* routes through the sheet's guarded cancel; the caller's
  `onCancel` still decides whether a Cancel button renders at all.
- `FormDialog` also reads `control` and the submitting state to guard every
  dismissal path. Multiple forms in one dialog register independently. Keep
  controls mounted after a failed save; reset RHF defaults after success.
  `showSubmit={false}` hides a premature or unnecessary action while keeping
  dirty tracking active; `submitVariant="default"` uses the outline style for
  a secondary action such as linking a registry project.
- When the actions render **inside an owning parent form**, pass `submitType="button"` + `onSubmitClick` — nesting `<form>` elements is invalid HTML.
- `formId` is the escape hatch when extension content must render between the fields and the CTA: the CTA lives outside the `<form>` and points back at it by id.
- `submitDisabled` gates on an unmet precondition (e.g. an unchecked acknowledgement).
- **Association preview.** `preview` takes one `FormFooterPreview` line,
  rendered under the Save blocker, directly above the
  buttons: what saving associates the record with. The Production Run form
  shows the credit batch the run joins, is expected to join, or belongs to
  (#1164); there the server answers from the unsaved values with the save
  path's own rule, so the browser holds no copy of it. Credit batch lines
  render through `CreditBatchLine`
  (`src/components/credit-batches/credit-batch-line.tsx`) from a form-specific
  `CreditBatchLineCopy`. The Lab Sample line repeats the batch chosen in the
  form, read from the batch summary the form already loads. The Emissions entry
  line repeats the batch whose Emissions page opened the form, with no request;
  that slide-over passes it to `SlideOverPanelFooter`'s `preview`, placed where
  `FormActions` puts its own. The line never blocks Save, and it shows "Checking" whenever
  its last answer is not for the current inputs.
  Feedstock, Delivery, Application and Biochar Product render `RecordCreditBatchLine` from saved
  provenance via `getRecordCreditBatches`. While creating, a new Feedstock says
  "Set when a production run uses this feedstock"; the other three pass the chosen
  source bin or delivery as `preview` (#1350). `previewRecordCreditBatches` plans the
  draw with the stock preview's own request (`prepareOutputStock`) or the
  application's shares (`planApplicationShares`), the planners the save posts, and
  resolves the runs through `getCreditBatchesForSourceRuns`, by each record's
  saved lineage rule: a delivery keeps runs with drawn dry biochar, a product
  every run layer it draws (a residual one included), an application runs with
  a share. Every line reads as a label, the same before and after saving:
  "Credit batch: CB-26-001". Before the mass is entered it reads the runs the
  source holds: "Credit batch:" when they share one batch, "Possible credit
  batch(es):" when they span several or some are in none (the draw can take
  from one or all of them). An entry the save would refuse says "Shown once
  the load / amount / biochar draw can be saved"; a delivery whose saved
  allocation does not balance says "Can't be traced for this delivery". The
  date window is hidden below 640 px, except in a warning about the window. A failed stock save invalidates these previews with
  the stock previews (`invalidateAfterFailedStockSave`).
  When several batches apply, "+N" opens a list of all their batches.
- The submit skips the browser's constraint bubbles except for unparsed number text (see [Native number constraints](#native-number-constraints)); a nested `submitType="button"` is untouched.

### Double submit

`disabled={isSubmitting}` turns on only after a render, so a double-click sends two saves (#1238). Every form uses the latch below; runner-backed create hooks also send an intent key. The stock-posting forms are the exception: they keep their own domain request keys (the emissions entry form likewise has its own latch).

- Wrap the RHF handler: `const latched = useLatchedSubmit(); <form onSubmit={latched(handleSubmit(...))}>`. The inner handler must `return` or `await` the save, or the latch lets go before the server answers.
- Create hooks backed by `runOperationInProcess` use `useIntentMutation` from `@/hooks/use-create-intent-key`. Its `mutationFn(variables, intentKey)` passes `{ intentKey }` to the action and throws on an unsuccessful `ActionResult` (use `unwrap` or `throwActionError`). The action uses `withCreate(callback, options, actionOptions)`; see [architecture.md](./architecture.md#layers). The helper keeps the key through failed saves, rotates it before the caller's `onSuccess`, and exposes `startDraft()` to rotate it for a new draft: call it when a create sheet or dialog opens, or when a dialog that stays mounted closes. A retry inside one open draft keeps the key and replays the first save.

Facility, reactor, storage-bin sheet, feedstock-type settings and production-process
creates use the same intent hook. List create handlers and the process confirmation
start a new draft on open. The onboarding sheet mounts fresh per open, so its
key is already new; the storage-bin sheet stays mounted and synchronizes draft
rotation with its prop-driven opening. Mutation rerenders and failed saves do
not rotate the key. Their form error handling is unchanged.

All six quick-add dialogs use the key owned by `useQuickAddSubmit`: its `serverFn(data, intentKey)` forwards the key, and the hook rotates it after success. Dialogs call `startDraft()` on open; formulation calls it on close. Failed saves keep the key and existing error behaviour. A create that saves several records in a loop, such as pending Sample transport legs, passes one key per record instead of the draft key.

API key creation sends an intent key without the runner, and a retry replaces the unseen key instead of replaying it because the secret is shown only once (see [docs/auth.md](./auth.md)).

### FormSpine

`FormSpine` is for long, process-shaped side-sheet forms where operators need orientation across several sections. It is a passive rail, not a wizard: all sections stay visible and the parent form still owns submit and validation.

The read-mode `sections` passed to `EntitySideSheet` must mirror the form's section titles, order, and field grouping. Enable the numbered read rail only for an edit form that uses `FormSpine`; otherwise keep the shared read rendering unnumbered. Keep useful derived or read-only content inside its matching section, or in a clearly named trailing section when the form has a recap or extension. Do not add generic `Record Metadata`, `Relationships & Metadata`, or similar sections: the sheet header already owns the record identity, and non-form identifiers do not belong in the mirrored process flow.

```typescript
<form className="space-y-20" onSubmit={handleSubmit(onSubmit)}>
  <FormSpine control={control}>
    <FormSection
      title="Run setup"
      icon={<Factory size={14} weight="bold" />}
      fields={["date", "reactorId", "status"]}
    >
      …fields…
    </FormSection>
    <FormSection title="Transfer preview" icon={<ArrowsLeftRight size={14} weight="bold" />}>
      …read-only recap…
    </FormSection>
  </FormSpine>
  <FormActions onCancel={onCancel} isSubmitting={isSubmitting} />
</form>
```

- `fields` names the section's owned fields and scopes the live subscription. Its only job is to turn the marker **red** when one of those fields has a surfaced validation error (after blur or submit).
- The marker is the **step number** and stays a number through every state — orientation, never a completion claim. The spine deliberately says nothing about whether a section is "done": a green completion tick conflated process progress with certification readiness and read as misleading. Readiness is a field-level concern carried by the CERT chips.
- Field-less sections render as plain numbered orientation steps — use them for previews and recaps, not required input.
- Conditional sections may mount/unmount; numbering derives from rendered order and stays contiguous.

### Required stars

A red star on a label means the save refuses the field empty. The rules:

- Star what the schema or the submit handler rejects when empty. Do not star a field that merely feels important, or one a blank value defaults.
- A field required only in one state shows the star only in that state (cancellation reason when cancelled, nutrient shares while claims are on, the override distance while Override is on, the GIS reference for that evidence method).
- A field needed for certification but not for saving gets the CERT chip below, never a star.
- `FormField` takes `required`. Anything drawn outside a FormField (a picker label, a legend, a readout) uses `RequiredMarker` from `@/components/forms/required-marker`, imported by file path, never through the barrel. For a fieldset control (`SegmentedControl`, `ChoiceCardGroup`) also pass `required`, which adds "Required" to the sr-only legend that names the group. Do not add `aria-required`: the control would announce it twice.
- The star adds "Required" to the label, so locate a starred field in specs with a regex or by role and a prefix match, not by exact name.
- The guard lives in `src/components/forms/form-required-markers.test.tsx`: every sheet form is submitted empty and any field that shows an error must carry a star. Its limit: Zod 4 aborts an object `superRefine` after an `invalid_type` issue and handler checks run after validation, so an empty submit never reaches a conditional requirement. Those go in its second table, which starts from a valid fixture, empties one field and asserts the star and the error together. A new conditional requirement gets a row there.

### CERT chip status

A field with `certifyRequired` carries the CERT chip on its label row (`CertificationFieldTag`). It explains itself on hover and to screen readers ("Required for certification"); there is no sheet legend. `FormField` accepts `certifyStatus`; the section's `certifyRequired` controls whether the chip shows. The chip reflects the record's **saved** state, frozen — it does not flip while the user types:

- create mode → `neutral` (neutral chip, no claim)
- edit mode, saved value present → `satisfied` (green chip with a check)
- edit mode, saved value missing → `missing` (orange chip with a warning mark)

Derive it with `makeCertFieldStatus(savedValues)`, passing the form's `defaultValues` in edit mode (or `undefined` while creating):

```typescript
const certStatus = makeCertFieldStatus(isEditMode ? defaultValues : undefined);
<FormField id="biocharOutputKg" certifyRequired certifyStatus={certStatus("biocharOutputKg")} … />
```

For a cert input that is **not** a plain form value (a derived leg distance, an upload, a status that must equal a specific value) compute the `CertFieldStatus` directly instead of reading `defaultValues` — e.g. the feedstock transport distance tracks its saved leg, and the production-run status chip is satisfied only once the saved run is `complete`.

## File upload

`FormFileUpload` has **three modes** — check `src/components/forms/form-file-upload.tsx` before wiring one:

1. **Real upload** — pass `entityType` + `entityId` and either a fixed `documentType` or `resolveDocumentType(file)` for a multi-type picker; files go straight to storage by presigned PUT via `useFileUpload`, and `onUploaded(documentId)` / `onUploadError` fire per file. This is the mode you want for anything that must persist.
2. **Deferred** — parent holds real `File` objects until the parent entity exists (`deferred`, `deferredFiles`, `onDeferredAdd`, `onDeferredRemove`). No network calls.
3. **Mockup** (default) — captures `{ name, size, type }` locally and emits via `onChange`. **No network calls, nothing reaches storage.** Legacy forms only; do not build new uploads on it.

Application evidence additionally passes `applicationEvidenceRole` / `applicationLogbookEvidenceType`. Storage config (`STORAGE_PROVIDER`, presigned URLs, S3 in production) is owned by [storage.md](./storage.md).

Placement: in a "Documentation" section, the upload field goes **before** the notes textarea.

### Application location evidence

Application evidence has three alternative paths: `location`, `boundary`, and
`visual`. The form defaults to `location`, using the GPS pair derived from the
selected delivery's customer location when available; operators can enter or
correct that pair in Field details. Both coordinates are required when this
method is selected. `boundary` reveals the GIS reference editor. `visual`
remains visible but unavailable. Evidence-health gaps are informational and do
not block certification submission. Optional Application images and PDFs use
the separate Supporting evidence section and do not change the selected method.

### Application GIS boundary evidence

GIS boundary text never goes straight into `applications.gis_boundary`.
`normalizeGisBoundaryFn` accepts uploaded or pasted GeoJSON, authenticates and
rate-limits the normalization, and returns the canonical versioned envelope.
Normalization retains only Polygon/MultiPolygon area features, enforces size,
feature, vertex, coordinate, and plausibility limits, and records source,
capture time, notes, canonical bbox/center/area statistics, and the normalized
FeatureCollection. Application data access calls `parseGisBoundary()` again
before persistence so all derived statistics are recomputed from the stored
geometry rather than trusted from the client.

The normalized JSON envelope is the application's boundary reference. Related
`gis_boundary` and application-mass-record uploads remain `documents` evidence.
Do not store raw uploaded GeoJSON in the JSONB column or infer a complete
boundary evidence path from the presence of one file alone.

## Entity select

Pass `allowEdit` to `EntitySelect` or `FormEntitySelect` to offer **Edit <name>**
beside **Add new**. `EntityEditDialog` loads a fresh record on each open and
renders the entity's existing form in `QuickAddDialogShell`. The opened record
and version stay fixed while editing, including after a stale-save refusal.
The shared shell stops portalled form submits from reaching the entry form.
Nested dialogs use the shared modal stack; Escape closes only the top layer.

The label uses the selected entity's name; `editLabel` overrides it. Editing
leaves the selected value unchanged. With `selectionLocked` and a selection, only
Edit is available. `disabled` prevents all interaction, including Edit.
`onEditSelected` remains available for custom edit flows and takes precedence
over the built-in handler. Archived records open read-only, without Reconcile or
stock actions.

Supported types are storage bins, formulations, suppliers, customers, feedstock
types, reactors, orders, vehicles, operators and drivers. Feedstock-type Edit
requires the server-resolved management permission (Admin or Platform Admin). Facility and Credit batch pickers deliberately have no Edit row. Driver
is supported by the shared dialog but currently has no form picker.
The order form's Customer location picker uses `onEditSelected` to open
`CustomerLocationDialog` for the selected location.

`SELECT_SEARCH_MIN_OPTIONS` in `src/config/forms.ts` is 5: search shows from
6 options. `alwaysShowSearch` and `hideSearch` remain explicit overrides.
Caller-owned lists pass `options`, `isLoading` and an `Error` via `loadError`.
`error` is a boolean for field-invalid styling only; a load failure shows the
load-failure message without marking the field invalid.
This mode filters names, codes and subtitles locally and makes no entity
queries. `optionLabel` names its search box. An option's `disabled` flag keeps
it visible but skips it for click, keyboard and automatic selection.
Server-backed lists show a refine-search hint when the result limit is reached.
Bin allocation and production draw rows give the bin picker its own full row,
with mass below it.

`emptyToNull` coerces the `""` an `EntitySelect` sends when nothing is picked, before the UUID check:

```typescript
storageLocationId: emptyToNull.or(z.uuid()).optional().nullable(),
```

**Cache seeding** — after a quick-add creates an entity, `seedEntityCache(queryClient, "driver", { id, label })` from `@/components/forms/entity-select/cache-utils` makes it selectable immediately without a list refetch.

**Quick-add** — minimal-field schemas live in `src/schemas/quick-add.ts`. `useOpenCreateIntent()` (`@/hooks/use-open-create-intent`) opens the create dialog from a `?create=true` deep link.

**Cascading selects (`dependsOn`)** — when a `FormEntitySelect` depends on another field (bins filtered by feedstock type, reactors by facility), pass `dependsOn`. `filterBy` is already part of the React Query key so options refetch on its own; `dependsOn` is what **clears the stale selection**, resetting the field to `""` when any watched value changes (it skips initial mount); the schema's `emptyToNull` turns that into `null` on submit. Pass an array for multiple parents.

```typescript
<FormEntitySelect
  control={control}
  name="storageLocationId"
  entityType="storageLocation"
  filterBy={{ type: "feedstock_bin", feedstockTypeId: watchedFeedstockTypeId || "" }}
  dependsOn={[watchedFeedstockTypeId, watchedFacilityId]}
/>
```

The underlying `useClearOnDependencyChange` (`@/hooks/use-clear-on-dependency-change`) is standalone — use it directly in custom form components that are not `FormEntitySelect`.

**Order form departs from `dependsOn`.** The customer picker clears the customer location from its own `onChange` (only when the value differs from the current customer), not through the location's `dependsOn`, because `dependsOn` also fires on a programmatic `resetField` such as a lock revert, which restores customer and location together.

**A select's own pick is a default on an untouched form** (#1360). When `autoSelectSingle` picks the only option, or `dependsOn` clears the field, while the form is still clean, `FormEntitySelect` moves the field's default with its value (`useSelectDefault`), so Cancel closes without "Discard unsaved changes?". Once the operator has edited anything, the same change is an edit and stays in `dirtyFields`, so a dirty-fields patch still sends it. The caller's `onChange` side effect also runs on the pick, with `change.asDefault`: a side effect that sets other fields sets them with `resetField(name, { defaultValue })` when `asDefault` is true (the credit batch month window). A plain `EntitySelect` under a `Controller` passes `onAutoSelect={(id) => setSelectDefault(name, id, field.onChange)}` with `const setSelectDefault = useSelectDefault(control)`.

**Default each registered field to the value its input produces when empty.** RHF fills a field whose default is `undefined` from its input, and `isDirty` compares every value with the defaults, so a mismatch makes the untouched form read as edited the next time anything recomputes it. That is `""` for a text or picker input and for a number input with no `setValueAs` (facility `timezone`, order `quantityKg`, production run `residenceTimeMinutes`), `null` for an input whose `setValueAs` gives `null` such as `nullableNumericValue` (storage bin `capacityKg`) and for radios with none chosen (storage bin `type`), and `undefined` only where `setValueAs` maps empty to `undefined` (`numericValue`, `integerValue`).

## Explanations behind an (i)

There is one view of every form and read sheet. Explanation does not switch on
and off; it opens from an (i) beside the figure or caption it explains.

**The contract:** an input, section, action or anything that informs a decision
is always visible: available stock, before → after, matching bins, blockers,
warnings, dry figures as `secondary` lines (`DetailField`, `DerivedHeadline`,
both through `SecondaryFigure`, CERT chip included). Explanation is what only
checks a number: composition ledgers, calculation arithmetic, the figures
behind a movement, FIFO batches, source runs, yield arithmetic, H:C / O:C
formulas, carbon estimate inputs, durability raw value, cap, component and
formula version, held allocations. It sits behind an (i).

- **`ExplanationInfo`** (`@/components/ui/explanation-info`) is the one (i):
  `<ExplanationInfo title hint?>{tables}</ExplanationInfo>`. It is a `Popover`
  with `openOnHover`, so it opens on mouse hover (desktop) and on a tap, click,
  Enter or Space (touch, keyboard); Escape, an outside press, the close button or
  a second press closes it, so a panel never traps the field being edited. The
  trigger is a `span` with `role="button"` named "About {title}" (a native button inside a read-only form's `<fieldset disabled>` would be disabled, and a locked record must still open its explanations), looks like
  `InfoHint`, keeps its 24px hit area and carries `data-presentation-control`, so
  a press on it never marks a sheet dirty. The panel is up to 420px wide and
  never wider than the viewport minus 32px; it scrolls past the Popover's max
  height. The body mounts only while open. Do not build this on the Base UI
  Tooltip, which closes on the tap that opens it.
- **One (i) per block.** A block with a definition and an explanation passes
  both: the `hint` leads the panel, then the tables. A block with only a
  definition keeps `InfoHint`.
- **Two short lines stay inline,** because the operator checks them on every
  entry: the dry mass formula sentence under a moisture split
  that derives dry mass from moisture (`formatSplitArithmetic` in
  `ui/moisture-split`; a stored dry mass explains itself inside the (i)) and the dry biochar before →
  after line on a stock movement ("Dry biochar in bin 540 → 135 kg"). Add no
  third without a decision in `docs/design-decisions.md`. Other explanation
  goes behind the (i).
- **Read sections:** `DetailPanelSection.explanation` (titled sections only)
  opens from the (i) beside the section title, after the section's `hint`;
  `DetailPanelField.explanation` does the same beside one figure's label, when a
  section holds several (`explanationTitle` names it). Read sheets build their
  sections in a named builder (`*-read-sections.tsx`, returning
  `DetailPanelSection[]`), never inline in the list;
  `src/components/read-sheets.test.tsx` fails for a builder without a
  case.
- **No "Add X" reveals** for fillable fields. A field may still appear when an
  earlier answer makes it relevant (a cancellation reason, an over-allocation
  justification). Keep long sheets calm by grouping, pairing and unit
  suffixes, never by hiding.
- **No presentation state.** There is no provider, no sheet prop and no level to
  test. A test of a block asserts the inline content, then opens the (i) and
  asserts the explanation.

### Derived blocks

A derived block is a `CompositionCard` (`@/components/forms`) that sits flat
under the inputs that drive it, with no tint and no frame: a sentence case
caption, an optional `headline`, the picture as `children`, one `explanation`
slot and one action row holding the block's own `actions` (a fix such as
"Balance to 100%"). The caption's one (i) opens `explanation`, led by the
`hint` definition; with no `explanation` the `hint` stays an `InfoHint`. Put a
short line that must stay visible (the stock movement's dry pair) in `children`.
Stock history lives on the storage bin and its own loss, count and correction
form, never on the block of a form that only draws from a bin. Omit
`explanation` when it would only restate visible numbers. Do not draw
proportions from an incomplete or zero basis.

Before any input, a form's moisture split and product composition would only
explain what will appear, so they render nothing until the first value makes
them data (`MassMoistureFields` and `ProductCompositionBlock` gate on
`started`).

`DerivedHeadline` is the block's one figure, at most one per block: a caption
label, the figure with its unit and approximation in the value ("≈ 1,110 kg",
so the label stays a plain name), an optional muted `before` value and arrow for
a change, and an optional `sub` caption naming the entry behind it. A `null`
figure is left out: the label stays with `sub` saying why, and with no `sub`
the headline renders nothing. Pass `figureLabel` so a before and after pair is
announced as one phrase.

Presentation controls (the (i), a history link) never submit or dirty the form.

### Stock blocks lead with wet mass

Stock is kept in dry biochar, but operators weigh and load wet mass, so the
stock family presents wet first. Only presentation changes. A wet figure reads
"N kg wet mass", number first, in every caption; never the short "kg wet".

- **Movement blocks** (`OutputStockPreview variant="movement"`: correction,
  loss, count, delivery load). Headline "Wet stock in bin, estimate" as
  "≈ 1,420 → 1,110 kg", with the entry as its caption ("310 kg wet mass removed at
  22.7% moisture", "Counted 2,650 kg wet mass at 27.4% moisture", "1,190 kg wet mass
  loaded at 16% moisture"). Before is each batch's wet stock, wet mass added
  less wet mass taken out from its last count; after takes this entry's wet
  mass out, or for a count, sets each batch to the count. The picture is the entered wet mass split into
  solids and water, then any notice, then the moisture reset block. The dry biochar before and after pair is an
  inline line under the picture (one of the two lines that stay visible); the
  entered figures and the FIFO batch draw sit behind the caption's (i). Without a moisture there is no estimate, and the dry pair takes
  the headline. Ingredient bins track wet stock directly, so their headline is
  not labelled an estimate.
- **Order availability** (`OutputStockAvailability` in `MatchingOutputBins`,
  right after the requested wet mass field). Headline "Available wet stock,
  estimate", each batch's wet mass added less wet mass taken out from its last
  count, since an order has no departure moisture yet, with available dry stock as a secondary line under it;
  the batch bar and key as the picture. On the order form and
  read sheet the bins collapse into one tappable row labelled "Available" with
  the wet figure only ("2,500 kg wet mass"), plus "in N of M bins" when some
  bins lack an estimate so a partial sum never reads as the full stock. Dry
  stock and the bin breakdown sit in the "Matching stock" modal the row opens.
- A wet estimate is computed at a moisture, not weighed, and reads in whole
  kilograms as "N kg wet mass" with no "≈" and no "estimate" on the figure.
  Where the figure has a label, the label says estimate ("Available wet stock,
  estimate"); otherwise its info hint says "Estimated: …". Secondary figures
  lead with the number ("1,500 kg dry biochar", "270 kg dry solids").

### Stock moisture readings

Every stock moisture field (delivery, loss, count, the product form's biochar
draw, ingredient moisture) is required and starts empty. Corrections are the
one exception: they start from the saved reading. The estimate is a hint and a
check, never a value:

- Pass `estimate` and the watched `reading` to `MoistureField` (or the
  `moisture` props of `MassMoistureFields`). The field then shows "Estimated
  moisture: 29.4%" under the input, the basis ("From the count on …") behind
  the ⓘ, and an advisory warning when the reading differs by more than
  `MOISTURE_READING_WARNING_POINTS` (`@/config/output-stock`). It never blocks.
- The product, delivery and stock forms (loss, count, correction) share `useOutputDrawDraft`
  (`src/hooks/use-output-draw-draft.ts`): readings gate, preview, estimate and
  the one save gate (`gate()`, which also fails on `isFetching` and `error`).
  Read the submit guard and `submitDisabled` from it, never re-derive them. A
  failed save is not retried in the form; the mutation hooks invalidate
  `outputStockKeys.all`, which refreshes the previews.
- For an output bin, `useOutputMoistureEstimate(bin, facility, occurredAt,
  preview?.moistureEstimate)` supplies the estimate: the bin at the entry's time,
  each batch at the moisture it was added with or last counted at, or the live
  preview's own (which leaves out the entry a correction replaces). Ingredient bins keep wet stock, so their
  estimate is the weighted remaining intake basis.
- Only a count resets the estimate. The movement block shows that as
  `MoistureResetChange`: the remaining stock at its previous estimate, an arrow,
  then at the reading, as two blocks rather than a sentence. Stock history
  repeats it as its own "Moisture updated" row. A delivery, loss or product draw
  takes its wet mass from the wet stock and leaves the moisture unchanged.

### Stock change in bin selectors

A bin selector whose choice moves stock shows the change in its selected value:
`EntitySelect`'s `formatSelectedLabel` returns a `ReactNode`, and
`StockChangeLabel` renders "Biochar bin (−100 kg wet mass)" in amber for a draw and
"Product bin (+400 kg wet mass)" in green for an addition. It shows only for a fresh,
unblocked projection with a finite, non-zero mass; pass `available={false}`
while the preview refetches or has failed. The biochar product form's biochar,
ingredient and product bin selectors are the reference; they replace separate
per-bin stock blocks above the form.

**One stock figure per draw field.** When the mass field's cue states what can
be drawn ("N kg available in this bin", "N kg available to this run", "N kg
available to this application"), the picker drops its "Remaining now" line:
`EntitySelect` `showRemainingMass={false}`, decided by
`pickerShowsRemainingStock` in `src/lib/stock-overdraw.ts`. The line comes back
whenever the cue is not on screen: availability unknown, or a mass error other
than the over-draw error (which already states the figure). The cue is wet
only; this is the one exception to "Dry figures are data", and the dry balance
stays on the bin's View sheet and in the product composition.

Do not add a switch to a short form or a surface already served by an effective
accordion or history dialog. Verify narrow header layout, radio keyboard
operation, scope resets, field preservation, and clean-versus-dirty closing
when adopting this pattern.
