# Forms Guide

Conventions, invariants and traps for form handling in noma-dmrv — React Hook Form + Zod 4 schemas in `src/schemas/`, components from `@/components/forms`. Read this before writing or editing any form or form schema. It carries only what the code does not state plainly: which of two coercion layers to use, which shared schema helper already exists, and the round-trip bugs that hand-rolled validation reintroduces.

Related: [design-system.md](./design-system.md) owns the visual contract (Canonical Page Shell, `FormSection` treatment, tokens) · [architecture.md](./architecture.md) owns React Query + `ActionResult` + server-action layering · [code-style.md](./code-style.md) owns naming and React Compiler rules · [storage.md](./storage.md) owns uploads.

Canonical form to copy from: `src/components/feedstocks/feedstock-form.tsx`.

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

Two mechanisms exist. **`@/schemas/helpers` is canonical**: coercion belongs in the schema via `z.preprocess`, so server actions re-validating the same payload get the same behaviour. `@/lib/form-utils` (`numericValue` / `nullableNumericValue` / `integerValue`, applied at the register site with `setValueAs`) is the fallback for forms not yet on schema-side coercion. **Never apply both to the same field** — double coercion.

**Never use `valueAsNumber: true`** — it turns `""` into `NaN`, which fails every Zod branch.

Never write inline preprocess lambdas, and never hand-roll a range check that `helpers.ts` already ships.

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

Prefer the `PositionPicker` component (map preview + address search + manual lat/lng) over a hand-rolled coordinate input.

## Dates

**Date-only fields must use `requiredDateOnly` / `optionalDateOnly`** from `@/schemas/helpers` — not `z.iso.date()`, not `z.coerce.date()`. They parse `"YYYY-MM-DD"` at **local** midnight, because `new Date("YYYY-MM-DD")` parses as **UTC** midnight, which renders as the previous day west of UTC and walks the stored date back one day on every edit/save round-trip.

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
- **`DryMassInput`** — use for dry-mass entry instead of a hand-rolled mass input.
- **`DistanceCalcField`** — derived transport-leg distance.
- **`PositionPicker`** (+ `PositionValue`, `PickerAccent`) — lat/lng entry.
- **`FormFileUpload`** — see [File upload](#file-upload).

Notes/description/address textareas inside a grid always span full width: wrap in `md:col-span-2` (2-col grids) or `md:col-span-3`.

Dynamic repeatable rows use RHF `useFieldArray` — reference: `src/components/formulations/formulation-form.tsx`.

### FormSection

The visual contract (SectionLabel + `space-y-16` fields + `pt-16` hairline divider, mirrored by `DetailSection` on read-only sheets) is owned by [design-system.md](./design-system.md). Never hand-roll a section wrapper. Caveats that live here:

- `divider` (default `true`) — the first section of a plain form passes `divider={false}`. **`divider` is ignored entirely inside a `FormSpine`**, which owns its own rail chrome; that is why the spine example below omits it.
- `hint` / `certifyRequired` forward to `SectionLabel`; `actions` adds right-aligned header chrome (an "Add" button, a badge).

### Vertical rhythm

- **`space-y-20`** — all side-sheet forms (top-level `<form>`), sectioned or not. `FormSection` owns intra-section rhythm; nothing else sets section spacing.
- **`space-y-24`** — full-page and auth forms only.
- Field grids inside sections: `grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-20`.

### FormActions

The only CTA row — left-aligned, primary action first, sticky by default, nothing renders after it.

- Nested inline forms (child-entity editors, transport legs) pass `sticky={false}`.
- When the actions render **inside an owning parent form**, pass `submitType="button"` + `onSubmitClick` — nesting `<form>` elements is invalid HTML.
- `formId` is the escape hatch when extension content must render between the fields and the CTA: the CTA lives outside the `<form>` and points back at it by id.
- `submitDisabled` gates on an unmet precondition (e.g. an unchecked acknowledgement).

### FormSpine

`FormSpine` is for long, process-shaped side-sheet forms where operators need orientation across several sections. It is a passive rail, not a wizard: all sections stay visible and the parent form still owns submit and validation.

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

## Entity select

`emptyToNull` coerces the `""` an `EntitySelect` sends when nothing is picked, before the UUID check:

```typescript
storageLocationId: emptyToNull.or(z.uuid()).optional().nullable(),
```

**Cache seeding** — after a quick-add creates an entity, `seedEntityCache(queryClient, "driver", { id, label })` from `@/components/forms/entity-select/cache-utils` makes it selectable immediately without a list refetch.

**Quick-add** — minimal-field schemas live in `src/schemas/quick-add.ts`. `useOpenCreateIntent()` (`@/hooks/use-open-create-intent`) opens the create dialog from a `?create=true` deep link.

**Cascading selects (`dependsOn`)** — when a `FormEntitySelect` depends on another field (bins filtered by feedstock type, reactors by facility), pass `dependsOn`. `filterBy` is already part of the React Query key so options refetch on its own; `dependsOn` is what **clears the stale selection**, resetting the field to `null` when any watched value changes (it skips initial mount). Pass an array for multiple parents.

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
