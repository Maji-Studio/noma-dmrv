# Certification Review Corrections (2026-08-09)

GHG Statement report generation now serializes with verifier submission for the
facility, so a newer report cannot supersede an approved version between the
submission freshness check and the provider request. Only the latest generated
report remains eligible for approval or submission.

Production Batch reconciliation still uses the stable supplier reference before
any non-idempotent create. A matching registry record is now adopted only when
its facility, feedstock types, kind, dry mass, production window, and supplier
reference also match the pending request.

The GHG Statement workspace blocks creation up front when a project is shared
across facilities. Removal readiness also blocks a grouped Removal when any
completed member production run lacks an application, while preserving more
specific broken-lineage guidance.
