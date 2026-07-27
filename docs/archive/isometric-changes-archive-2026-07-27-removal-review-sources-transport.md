# Isometric changes archive — 2026-07-27

## Removal submit review hierarchy

The New removal wizard separates its concise operator review from the full
compiled Isometric diagnostics with accessible Review and Technical details
tabs. Compiler blockers and captured-but-not-represented warnings remain on the
default Review tab, while diagnostic identifiers, payload samples, and the
recompile action remain available under Technical details.

This is a UI hierarchy change only. It does not change or make a new claim about
protocol requirements, readiness, compiled payloads, or submission behavior.

## Removal sources become read-only after submission

The Removal detail no longer detaches local Source mappings. It shows Mirror
only while the authoritative derived Removal state is actionable; submitted,
accepted, superseded, and in-flight rows are status-only. The public mirror
action enforces the same lifecycle boundary, while the internal mirror seam
used by submission-generated evidence remains available.

Evidence is deleted or replaced from its owning record before submission.
Owning-document deletion retires an unreferenced local Isometric mapping under
the shared per-document lock and never deletes the remote Source. Any persisted
submission snapshot that references the Source blocks deletion so submitted
certification history remains intact.

## Transport distance provenance decoupled from evidence

- Distance source is a pure distance-provenance choice: mapped/route
  calculation or manual entry. `Transport document` is no longer offered for
  new values; legacy saved `document` values remain displayable and submittable
  without silent mutation.
- Classified transport evidence (bill of lading, weigh-scale ticket, or other
  transport evidence) is always visible on feedstock, delivery, and
  transport-leg forms. Its CERT state depends only on at least one accepted
  upload, and the existing document-to-Source-candidate pipeline is unchanged.
- Missing accepted transport evidence remains CERT-flagged and blocks registry
  submission. Evidence coverage stays independent from distance provenance.
- Registry basis: Transportation Emissions Accounting module v1.1 §5 accepts
  mapped distances, while §6 required records still apply to every transport
  leg.
