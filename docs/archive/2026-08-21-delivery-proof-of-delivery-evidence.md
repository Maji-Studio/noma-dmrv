# Delivery proof-of-delivery evidence implementation

This archived implementation note records the 2026-08-21 delivery evidence and truck-mass gating change.

Biochar Protocol v1.3, "Measurement of Mass of Biochar Stored", defines an
alternative to weighbridge measurement: documentation-based verification via
signed delivery receipts, bills of lading, or photographic evidence of
delivery. Isometric pre-approved this pathway for this project (confirmed
2026-08-21). Verbatim source:
<https://registry.isometric.com/protocol/biochar/1.3#measurement-of-mass-of-biochar-stored>

- New Noma evidence role `proof_of_delivery`: a delivery receipt or
  role-stamped delivery photo (`metadata.deliveryEvidenceRole =
  "proof_of_delivery"`) on delivery lineage binds to the sequestration
  `co2-stored`/`product_mass` datapoint, plus the optional Safety margin mass
  input. Bare photos never bind. The delivery bill of lading keeps its
  `biochar-transport`/`mass_distance` target and gains the same
  `product_mass` additional target.
- Missing `deliveries.truckMassOnArrivalKg`/`truckMassOnDepartureKg` no longer
  fail Removal submission. The `POST /biochar_applications` payload is untouched
  and values are never fabricated: the registration is journaled
  `lifecycleStatus: "gated"` with `gateReason: "missing_truck_masses"` and no
  payload, then the POST is skipped. Once the delivery carries both masses, a
  later submission upgrades the placeholder into the normal in-flight claim.
- Snapshot `biocharApplicationIntents` entries carry `gateReason` and nullable
  truck masses when gated. Pre-gating drafts without the field remain resumable.
  `SOURCE_BINDING_MAPPING_REVISION` changed through the rules hash.
- PDD obligations for the pathway (production-site weighing, transport
  protocols, chain of custody) are documented outside this codebase.
