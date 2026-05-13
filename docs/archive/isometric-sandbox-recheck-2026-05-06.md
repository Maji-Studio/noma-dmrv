# Isometric Sandbox Re-check Log - 2026-05-06

Archived implementation-log detail moved out of `docs/open-questions.md`.
Current unresolved decisions remain in `docs/open-questions.md`; durable
decisions and verification summaries remain in `docs/isometric/changes.md`.

## Live-template `INPUT_MAPPING` coverage

Sandbox re-check against project `prj_1K9YJ33RKSBX9FFF` returned two templates:
`Protocol default` and `Dark Earth removal template`.

The same blocker class remained: 21 monitored inputs were unmapped across the
two sandbox templates, and fixed constants were still mostly unbound.

Consequence: the sandbox validation pass kept Gates D (credit-batch Removal
POST + idempotency + stale-lock recovery) and E (GHG statement lifecycle) in
`blocked-by-template-readiness`. Phases 1, 2, and the read paths were
sandbox-verified, but the write paths could not proceed until a sandbox
template had both required-input coverage and pre-bound fixed constants.
