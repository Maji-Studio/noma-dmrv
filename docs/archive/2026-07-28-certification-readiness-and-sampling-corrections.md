# Certification readiness and sampling corrections

On 2026-07-28, the certification-readiness work made four related corrections:

- Biochar Protocol v1.1 §8.3.1 was corrected to require at least three samples
  representative of the physical characteristics in a Production Batch. It
  does not require samples from distinct production runs or calendar days.
  The cluster and unknown-provenance warnings built on that misreading were
  removed; the usable-replicate, pre-window, and stored-material checks remain.
- The separate `DURABILITY_MEASUREMENT_SAMPLES_LIVE` flag was removed.
  Durability measurement-sample POSTs are enabled only when
  `ISOMETRIC_ENVIRONMENT` targets the sandbox.
- Transport documents remain retained evidence, but they are not a submission
  requirement. The related readiness and dashboard gaps were removed.
- Removal submission began sending pending managed supporting files
  automatically before compiling and claiming the strict registry artifact.
  The reviewed candidate-file fingerprint is rechecked after those transfers.

This record preserves the implementation history removed from evergreen ADRs,
security guidance, open questions, compliance mappings, and the active
Isometric documentation index.

## Superseded transport-readiness behavior

The 2026-07-21 transport workflow required a `document` distance source and at
least one accepted transport-evidence document. It used one classified
multi-file uploader across feedstocks, deliveries, and manually managed
transport legs. Migration 0087 added `other_transport_evidence` to
`documentation_type`. The upload and classification workflow remains; only the
readiness requirement, CERT status, and dashboard attention row were removed.
