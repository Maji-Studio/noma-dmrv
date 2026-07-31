# Isometric Operational Feedback Changes (2026-07-31)

## Application mass record taxonomy removed

The Application form no longer asks operators to classify retained mass records
as Weighbridge, Inventory, or Affidavit. That taxonomy comes from Biochar
Storage in Soil Environments v1.2 and does not apply to the project's current
Biochar Protocol v1.1 and Agricultural Soils v1.1 combination.

The mass-record upload remains available because Biochar Protocol v1.1 still
requires delivery weigh-scale tickets or equivalent application-mass records to
be retained for verification for at least five years. Existing classification
metadata remains readable for compatibility and existing registry Source
bindings, but new uploads do not require or create it.

## Production-run readings evidence readiness

Noma now requires at least one successfully uploaded, unchanged readings CSV
for each completed production run before entity, Removal, and preflight
readiness are complete. Presence means only that the file was supplied: Noma
does not inspect it, import readings rows, or convert it to Certify structured
telemetry. One CSV per run is Noma's conservative control, not a requirement
stated verbatim by Isometric Biochar Protocol v1.1.
