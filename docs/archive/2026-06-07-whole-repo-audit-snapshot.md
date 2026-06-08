# Whole-repo audit snapshot — 2026-06-07

Run-specific snapshot of the 9-commit + working-tree audit. The evergreen
deferred items this surfaced live in `docs/open-questions.md` (§ "Audit
follow-ups"); this file preserves the dated execution summary so that section can
stay decision-focused.

## Execution summary

The high-severity findings were fixed in the audit pass:

- MRV durability gate
- use-server exposure surface
- submit-removal version race
- log redaction
- missing indexes
- nullable-certifier CHECK
- formulation orphan guard
- energy error UI
- GHG rate-limit / breadcrumbs

The remaining items were intentionally held back as needing a product/UX decision
or being larger than a review-fix; they are tracked as open questions in
`docs/open-questions.md`. Sizing convention there: (S) small, (M) medium, (L) large.
