# Removal submission recovery and Production Batch unit readback

## Removal submission recovery safety

Definitive registry refusals reject and unlock only the exact Removal draft
claimed by an attempt that made no possible or confirmed registry write. Any
uncertain or confirmed write keeps the draft locked for reconciliation,
including failed lookups and local persistence failures after a successful
create. Those retained drafts record an interrupted attempt and appear as
`Submission interrupted` until a safe retry reconciles them. Durable Sources,
evidence ledgers, and submission journals are retained for that retry.
Production Batch dry-mass comparisons keep the explicit 1 g tolerance.

## Production Batch mass-unit readback

A live Certify Production Batch response was verified to return the canonical
mass unit `kilogram` after noma submitted the request unit `kg`. Production
Batch create-response and orphan-reconciliation identity checks therefore
accept only those two equivalent spellings while continuing to reject other
units without conversion.
