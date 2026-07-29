# Forms Guide

Conventions, invariants and traps for form handling in noma-dmrv — React Hook Form + Zod 4 schemas in `src/schemas/`, components from `@/components/forms`. Read this before writing or editing any form or form schema. It carries only what the code does not state plainly: which of two coercion layers to use, which shared schema helper already exists, and the round-trip bugs that hand-rolled validation reintroduces.

Related: [design-system.md](./design-system.md) owns the visual contract (Canonical Page Shell, `FormSection` treatment, tokens) · [architecture.md](./architecture.md) owns React Query + `ActionResult` + server-action layering · [code-style.md](./code-style.md) owns naming and React Compiler rules · [storage.md](./storage.md) owns uploads.

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

### Zod 4 string formats

Format checks are **top-level**, not chained. The chained forms still compile but emit a deprecation diagnostic.

| Deprecated | Use |
|---|---|
| `z.string().uuid()` | `z.uuid()` |
| `z.string().email()` | `z.email()` |
| `z.string().url()` | `z.url()` |
| `z.string().datetime()` | `z.iso.datetime()` |
| `z.string().date()` | `z.iso.date()` |

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

`requiredNumber()` already packages the Zod 4 `error: (iss) => iss.input === undefined ? … : …` callback — do not hand-write that lambda.

`toIntOrNull` does **not** `parseInt`. It uses `Number(trimmed)` and, when the result is `NaN` or non-integer, returns the **raw trimmed string** so Zod reports a type error. That is the point: it rejects partial parses like `"12abc"` instead of silently accepting `12`.

> **Gotcha — clearing a value on edit needs empty → `null`, never empty → `undefined`.** Drizzle's `.set()` drops `undefined` keys, so an update built from `undefined` leaves the old value in the database: the field appears un-clearable and the change silently reverts. `null` is an explicit value Drizzle persists. (Reference: `src/components/storage-locations/storage-location-form.tsx`.)

### Mass and integer caps

Masses are backed by `numeric(14,3)` columns. A hand-rolled `z.number().positive()` lets a fat-fingered entry reach Postgres as a raw `numeric field overflow`. Use the capped family instead — `massKgSchema` · `positiveMassKgSchema` · `requiredMassKgSchema` · `requiredPositiveMassKgSchema` · `optionalMassKgSchema` · `optionalMassKgInputSchema` (the last preprocesses form strings). They enforce `MASS_INPUT_MAX_KG` (100,000,000 kg) / `MASS_INPUT_MAX_TONNES` with a friendly message.

Same reasoning for `PG_INTEGER_MAX` on integer columns, and `RATIO_INPUT_MAX` (9.999999) for ratio fields backed by `numeric(7,6)` whose domain exceeds `[0, 1]` (H:C org, O:C org). True 0–1 fractions keep their own `.max(1)`.

### GPS coordinates

`latitudeSchema` / `longitudeSchema` (optional, nullable) and `requiredLatitudeSchema` / `requiredLongitudeSchema` (with the required-vs-invalid message distinction built in) all expect a **number**, so form schemas wrap them:

```typescript
gpsLatitude: z.preprocess(toNumberOrNull, latitudeSchema),
gpsLongitude: z.preprocess(toNumberOrNull, longitudeSchema),
```

Range checks alone are not enough: a half-filled pair otherwise validates. Attach `.superRefine(gpsPairSuperRefine)` to any schema carrying `gpsLatitude` / `gpsLongitude` — it points the error at the coordinate still missing. `hasCompleteGpsPair()` and `GPS_PAIR_MESSAGE` are exported for non-schema call sites. Reference usage: `src/schemas/customers.ts`.

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

## Dates

For a new or changed `<input type="date">` whose value is parsed into a `Date`,
use `requiredDateOnly` / `optionalDateOnly` from `@/schemas/helpers`. They parse
`"YYYY-MM-DD"` at **local** midnight, because `new Date("YYYY-MM-DD")` parses as
**UTC** midnight, which can render as the adjacent day and walk a stored date on
an edit/save round-trip. `z.iso.date()` validates a string but does not produce
a `Date`.

Several established application/order/delivery/credit-batch schemas still use
`z.coerce.date()` while their components protect the default side with
`formatLocalDate`. Treat those as legacy contracts: do not mass-change their
output types, but when changing one, trace its component, action, data-access,
and database column and migrate the round trip deliberately. The
production-run schemas are the current reference for the local date-only
helpers.

Defaults have the mirror-image hazard. **Never `toISOString()`** for a form default — use `@/lib/date-utils`:

```typescript
date: formatLocalDate(new Date()),          // "2026-03-03"  → <input type="date">
startTime: formatLocalDateTime(new Date()), // "2026-03-03T14:30" → datetime-local
```

`toDateInputValue`, `parseLocalDateString`, and the facility-timezone display helpers (`formatFacilityTime`, `formatFacilityDate`, `formatTimezoneLabel` — all timestamps are stored UTC) also live in `src/lib/date-utils.ts`.

## Components

All from the `@/components/forms` barrel (`src/components/forms/index.ts`) — read it for the full surface; TypeScript carries the prop signatures. Only the non-obvious contracts are documented here.

- **`FormField`** — `hint` (ⓘ icon) is for explanatory prose; `helperText` is for **short**, always-visible cues and auto-collapses into the hint treatment past `INLINE_HELPER_MAX_CHARS`. Long text in `helperText` is a mistake.
- **`FormError` / `ServerError`** — field-level vs server-level; both carry `role="alert"`. For server validation targeting a field, use RHF `setError('root.serverError', …)`.
- **`FormSelect`**, **`FormInput`**, **`FormTextarea`** — styled primitives; spread `{...register(name)}`.
- **`MassMoistureFields`** — the canonical wet-mass + moisture pair, with the live `MoistureSplit` bar spanning both. Use it for **every** wet-mass/moisture capture; it owns the labels, the wet-basis hint, the range helper and the derived readout. `MoistureField` / `WetMassField` are the standalone halves (lab samples capture moisture with no paired mass; the bin stock-take captures a counted mass separately). Each takes the caller's `register(...)` result so `setValueAs` stays with the owning form. Pass `materialLabel` ("Biochar", "Feedstock") to qualify the labels rather than rewriting them, and `step="any"` for a column backed by `real` instead of the exact `numeric` families. Vocabulary and precision come from `@/lib/mass-moisture` — see [design-system.md](./design-system.md#wet-mass-moisture-dry-mass). (`DryMassInput` and its "Dry: 237.5 kg" caption are gone.)
- **`DistanceCalcField`** — derived transport-leg distance.
- **`PositionPicker`** (+ `PositionValue`, `PickerAccent`) — lat/lng entry.
- **`FormFileUpload`** — see [File upload](#file-upload).

Notes/description/address textareas inside a grid always span full width: wrap in `md:col-span-2` (2-col grids) or `md:col-span-3`.

Free-form **Notes** fields are always the final editable field before
`FormActions`. Put derived previews or selectable cohorts immediately after the
inputs that control them, then place Notes after those previews. Documentation
uploads remain the explicit ordering exception: the upload goes immediately
before its trailing Notes field.

Dynamic repeatable rows use RHF `useFieldArray` — reference: `src/components/formulations/formulation-form.tsx`.

### FormSection

The visual contract (SectionLabel + `space-y-16` fields + `pt-16` hairline divider, mirrored by `DetailSection` on plain read-only panels) is owned by [design-system.md](./design-system.md). `EntitySideSheet` read mode renders its configured `DetailSection`s through the shared `DetailSpine`. Its numbered passive rail is enabled only when the paired edit form uses `FormSpine`. Never hand-roll a section wrapper or rail. Caveats that live here:

- `divider` (default `true`) — the first section of a plain form passes `divider={false}`. **`divider` is ignored entirely inside a `FormSpine`**, which owns its own rail chrome; that is why the spine example below omits it.
- `hint` / `certifyRequired` forward to `SectionLabel`; `actions` adds right-aligned header chrome (an "Add" button, a badge).

### Vertical rhythm

- **`space-y-20`** — all side-sheet forms (top-level `<form>`), sectioned or not. `FormSection` owns intra-section rhythm; nothing else sets section spacing.
- **`space-y-24`** — full-page and auth forms only.
- Field grids inside sections: `grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-20`.
- Controls in a field-grid row top-align independently; a wrapped label shifts
  only its own control down. Do not "fix" this with per-field label heights,
  spacer elements, or a shared subgrid — a `.grid > .form-field` subgrid was
  tried and reverted (it staggered grids containing any non-`FormField` child
  and opened voids under neighbors of fields with always-visible helper text).
  Prefer labels short enough not to wrap.

### FormActions

The only CTA row — left-aligned, primary action first, sticky by default, nothing renders after it.

- Submission-level server/action/root errors go through `errorMessage`; `FormActions` renders the shared `ServerError` immediately above the buttons inside the same sticky footer. Do not render the same error in a parent sheet or earlier in the form.
- Nested inline forms (child-entity editors, transport legs) pass `sticky={false}`.
- When the actions render **inside an owning parent form**, pass `submitType="button"` + `onSubmitClick` — nesting `<form>` elements is invalid HTML.
- `formId` is the escape hatch when extension content must render between the fields and the CTA: the CTA lives outside the `<form>` and points back at it by id.
- `submitDisabled` gates on an unmet precondition (e.g. an unchecked acknowledgement).

### FormSpine

`FormSpine` is for long, process-shaped side-sheet forms where operators need orientation across several sections. It is a passive rail, not a wizard: all sections stay visible and the parent form still owns submit and validation.

The read-mode `sections` passed to `EntitySideSheet` must mirror the form's section titles, order, and field grouping. Enable the numbered read rail only for an edit form that uses `FormSpine`; otherwise keep the shared read rendering unnumbered. Keep useful derived or read-only content inside its matching section, or in a clearly named trailing section when the form has a recap or extension. Do not add generic `Record Metadata`, `Relationships & Metadata`, or similar sections: the sheet header already owns the record identity, and non-form identifiers do not belong in the mirrored process flow.

```typescript
<form className="space-y-20" onSubmit={handleSubmit(onSubmit)}>
  <FormSpine control={control}>
    <FormSection
      title="Run Setup"
      icon={<Factory size={14} weight="bold" />}
      fields={["date", "reactorId", "status"]}
    >
      …fields…
    </FormSection>
    <FormSection title="Transfer Preview" icon={<ArrowsLeftRight size={14} weight="bold" />}>
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

### CERT chip status

`FormField` accepts `certifyStatus`; the section's `certifyRequired` controls whether the chip shows. The chip reflects the record's **saved** state, frozen — it does not flip while the user types:

- create mode → `neutral` (no claim)
- edit mode, saved value present → `satisfied` (green)
- edit mode, saved value missing → `missing` (orange)

Derive it with `makeCertFieldStatus(savedValues)`, passing the form's `defaultValues` in edit mode (or `undefined` while creating):

```typescript
const certStatus = makeCertFieldStatus(isEditMode ? defaultValues : undefined);
<FormField id="biocharOutputKg" certifyRequired certifyStatus={certStatus("biocharOutputKg")} … />
```

For a cert input that is **not** a plain form value (a derived leg distance, an upload, a status that must equal a specific value) compute the `CertFieldStatus` directly instead of reading `defaultValues` — e.g. the feedstock transport distance tracks its saved leg, and the production-run status chip is satisfied only once the saved run is `complete`.

## File upload

`FormFileUpload` has **three modes** — check `src/components/forms/form-file-upload.tsx` before wiring one:

1. **Real upload** — pass `entityType` + `entityId` + `documentType`; files go straight to storage by presigned PUT via `useFileUpload`, and `onUploaded(documentId)` / `onUploadError` fire per file. This is the mode you want for anything that must persist.
2. **Deferred** — parent holds real `File` objects until the parent entity exists (`deferred`, `deferredFiles`, `onDeferredAdd`, `onDeferredRemove`). No network calls.
3. **Mockup** (default) — captures `{ name, size, type }` locally and emits via `onChange`. **No network calls, nothing reaches storage.** Legacy forms only; do not build new uploads on it.

Application evidence additionally passes `applicationEvidenceRole` / `applicationLogbookEvidenceType`. Storage config (`STORAGE_PROVIDER`, presigned URLs, S3 in production) is owned by [storage.md](./storage.md).

Placement: in a "Documentation" section, the upload field goes **before** the notes textarea.

### Application GIS boundary evidence

Application evidence has two domain paths, `visual` and `boundary`, but the
current creation UI is GIS-first: it starts on `boundary`, and the visual option
is shown as unavailable. It therefore does not currently consume the
organization's `defaultEvidenceMethod`, even though the settings model contains
that default. Missing evidence remains a certification-readiness gap, not an
application-create validation failure.

GIS boundary text never goes straight into `applications.gis_boundary`.
`normalizeGisBoundaryFn` accepts uploaded or pasted GeoJSON, authenticates and
rate-limits the normalization, and returns the canonical versioned envelope.
Normalization retains only Polygon/MultiPolygon area features, enforces size,
feature, vertex, coordinate, and plausibility limits, and records source,
capture time, notes, canonical bbox/center/area statistics, and the normalized
FeatureCollection. Application data access calls `parseGisBoundary()` again
before persistence so all derived statistics are recomputed from the stored
geometry rather than trusted from the client.

The normalized JSON envelope is the application's boundary reference; related
`gis_boundary` and classified logbook uploads remain `documents` evidence. Do
not store raw uploaded GeoJSON in the JSONB column or infer a complete boundary
evidence path from the presence of one file alone.

## Entity select

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
