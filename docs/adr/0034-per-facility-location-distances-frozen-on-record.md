# Per-facility location distances freeze on recording

**Status: Accepted** (2026-10-16).

A location's road distance depends on the facility serving it (#456, DEF-003).
Live propagation of a location edit could rewrite historical transport facts,
including certification lineage (F30). This decision defines the boundary
between reusable route defaults and recorded transport facts.

## Decision

- Store one positive one-way distance and its provenance per (location, facility).
- Capture the pair in a delivery snapshot independently of any trip override.
  Feedstock legs retain their own stamped distance and provenance.
- Saving a pair fills a missing distance; never changes a recorded one.
  Fill within the pair transaction, skipping archived cargo and locked lineage.
- Reject pair writes for facilities the organization cannot actively use.
  GPS estimation is opt-in and available only in location forms.
- Migration 0153's owner-approved copy creates pair defaults only for organizations
  with exactly one active facility. Independently, every existing delivery retains
  its old location scalar and provenance, including locked and archived history.

## Consequences

Missing distances permit entry but block required transport readiness. Location
repair links can resolve missing facts without rewriting recorded history.
Changing a default affects future records; deliberate historical correction
uses the explicit, version-checked refresh from location workflow. Refresh
refuses overridden records, missing pairs and locked certification lineage,
and updates the recorded distance and derived transport in one transaction.
Feedstock overrides persist on the intake row; clearing one deliberately
captures the current pair. Delivery overrides retain an independent recorded
pair snapshot and clearing one restores that snapshot. Multi-facility organizations enter their
pair defaults explicitly rather than inheriting an ambiguous scalar.
