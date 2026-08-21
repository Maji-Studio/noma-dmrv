# Delivery proof-of-delivery evidence (documentation-based mass verification)

**Date:** 2026-08-21 · **Status:** agreed with Kenji, ready to implement · **Branch:** `feat/delivery-proof-of-delivery-evidence` (create from `staging`)

## Context and decisions (settled — do not relitigate)

Operators have no weighbridge access at application/delivery sites, so `deliveries.truckMassOnArrivalKg/DepartureKg` are never captured (there is deliberately no UI for them). Today that hard-fails removal submission in the biochar-application intent compiler.

Protocol basis: Biochar Protocol v1.3, "Measurement of Mass of Biochar Stored" → "Alternative Method: Documentation-Based Verification" — signed delivery receipts, bills of lading, or photographic evidence of delivery, in place of weighbridge data. **Isometric has pre-approved this pathway for us** (confirmed by Kenji 2026-08-21). Authoritative text: <https://registry.isometric.com/protocol/biochar/1.3#measurement-of-mass-of-biochar-stored>

Decisions:

1. **No generated application PDF.** Original idea dropped. Primary evidence is operator-uploaded documents; a generated PDF restates DB values and proves nothing. (`LedgerArtifactSpec` seam stays available for a later summary sheet if ever wanted.)
2. **`POST /biochar_applications` payload untouched.** `truck_mass_on_arrival/departure` are required by the API schema (`CreateBiocharApplicationRequest`); we never fabricate values. When a delivery lacks truck masses, the application registration is **gated (skipped with an explicit `gateReason`)** instead of failing the removal submission. When masses exist, the POST happens exactly as today.
3. **Evidence UX: one combined "Delivery evidence" section** on the delivery form (renamed from "Transport evidence"), with the standard CERT chip. Per-entity chip lists; per-document registry badge. No operator-set cert toggle — classification is automatic by type + role metadata.
4. **Bindings:** proof-of-delivery documents bind to the sequestration `co2-stored` / `product_mass` datapoint and ride the existing lineage walk into the Removal's `source_ids`. No dependence on the biochar-application POST. Multiple sources per datapoint is already normal (durability ledger + inventory already target `product_mass`).

## Implementation work items

Read first per CLAUDE.md: `docs/code-style.md`, `docs/architecture.md`, `docs/design-system.md`, `docs/ux-writing.md` (no en/em dashes in operator copy), `docs/forms.md`, `docs/isometric/README.md`.

### 1. Source bindings (`src/lib/certification/removal-source-bindings.ts`)

- New rule `proofOfDelivery`: `nomaRole: "proof_of_delivery"`, target `{kind: "sequestration", groupKey: "co2-stored", inputKey: "product_mass"}` (mirror the `inventory` rule at :113-120, incl. its optional safety-margin additional target if applicable — check whether the safety-margin rationale extends to delivery mass evidence; if unclear, target `product_mass` only).
- Extend `deliveryBillOfLading` (:146-155) with an additional intended target on `co2-stored`/`product_mass` (BOL does double duty; protocol lists BOLs as accepted proof of delivery).
- Classification branches in `classifyRemovalSourceCandidate` (:256): `delivery` + `delivery_receipt` → `proofOfDelivery`; `delivery` + `photo` **only when** the document metadata carries the proof-of-delivery role marker (see item 2) → `proofOfDelivery`. Bare photos must NOT bind.
- Extend the `NomaEvidenceRole` union with `proof_of_delivery`.
- `SOURCE_BINDING_MAPPING_REVISION` derives from the rules hash, so it bumps automatically; do not touch `SOURCE_BINDING_MATERIALIZATION_REVISION` unless wire attachment behavior changes.

### 2. Document metadata role for delivery photos

- Follow the application-evidence pattern (`src/lib/certification/application-evidence.ts`, `logbookEvidenceType`): a delivery-evidence role constant, e.g. metadata `deliveryEvidenceRole: "proof_of_delivery"`, stamped by the uploader for the "Delivery photo" chip.
- `src/schemas/documents.ts` restricts which types may carry metadata (~:160-176) — widen the refinement so `photo` on a `delivery` may carry the role metadata. Keep the existing GIS/logbook constraints intact.

### 3. Delivery form UI

- `src/components/deliveries/delivery-trailing-sections.tsx`: retitle section to "Delivery evidence"; pass the CERT chip prop on `FormSection` (`src/components/forms/form-section.tsx:37`).
- CERT chip status via the `cert-field-status.ts` contract: neutral during creation; from saved state, colored by whether the delivery has ≥1 proof-of-delivery-classified document (receipt, role-stamped photo, or BOL). Never blocks anything.
- `src/components/transport-legs/classified-transport-evidence-uploader.tsx` + `transport-evidence-documents.tsx` (+ `src/lib/certification/transport-evidence.ts`): chip list becomes per-entity. Delivery: `Bill of lading | Weighbridge ticket | Other transport | Delivery receipt | Delivery photo`. Transport legs: unchanged three. "Delivery photo" chip stamps the role metadata; uses `photo` upload rule (images only).
- Per-document badge inside the panel marking registry-bound docs (receipt / role-stamped photo / BOL) vs retention-only (weighbridge ticket, other transport). Reuse/extend the `transport-leg-cert-status.ts` pattern.
- Deferred-attachment create mode and live-panel edit mode keep today's behavior; deferred adds must carry the role metadata too (`use-deferred-attachments` path).

### 4. Gate instead of block (`src/fn/certification/biochar-application-intents.ts`)

- `compileBiocharApplicationIntents` / `getBiocharApplicationRegistryInputs` (`src/data-access/certifier-biochar-applications.ts:42`): when `truckMassOnArrivalKg` or `truckMassOnDepartureKg` is null, do NOT throw the SafeError. Produce a gated intent (or skip with a recorded reason) so `ensureRemovalBiocharApplications` (`src/fn/certification/biochar-applications.ts:38`) journals `lifecycleStatus: 'gated'` + `gateReason` (schema `src/db/schema/certifier-biochar-applications.ts` already supports both) and the removal submission proceeds.
- Mind the snapshot path: intents are snapshotted pre-mutation (`removal-submission-build.ts:656`) and re-read on resume (`removal-snapshot-readers.ts:93-123`) — the gated shape must round-trip through the zod snapshot schema.
- Keep all other guards (split-delivery refusal, positive field size, immutable slices) unchanged.

### 5. Docs + tests

- `docs/isometric/changes.md`: dated entry — pre-approved documentation-based verification, gating semantics, new bindings. Update `docs/isometric/openapi-index.md` biochar-application row status if wording now stale.
- Tests: binding classification (new branches incl. bare-photo negative case), uploader chip/role stamping (`classified-transport-evidence-uploader.test.tsx`), intent gating incl. snapshot round-trip, cert-status resolver. Validate with `pnpm lint`, `pnpm typecheck`, targeted vitest.

## Parked (Kenji's call, out of scope)

- Lifting the production hard-block on the biochar-application layer (`biochar-application-intents.ts:57`, `biochar-applications.ts:50-54`).
- Truck-mass entry UI (deliberately none for now; API path un-gates automatically once data exists).
- PDD must document production-site weighing, transport protocols, chain of custody (Kenji-side, per protocol text).
