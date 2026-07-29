# Certifier-readiness (Tier-2 validation) + dead transport-leg cleanup — archived

This plan has been **executed and archived**. Full design log, decisions, and
file:line findings:
[docs/archive/2026-06-05-certifier-readiness-and-tier2-validation.md](../2026-06-05-certifier-readiness-and-tier2-validation.md).

## Stable decisions (evergreen)

- **Tier-2 source of truth = the `INPUT_MAPPING`-anchored certifier-field
  registry** (`certify-field-registry.ts`), kept honest against `INPUT_MAPPING`
  by a test. A generic readiness helper + a `certifyRequired` form-field marker
  read from it — chosen over per-entity hand-listed readiness fns or parallel
  strict Zod schemas.
- **The dead `delivery` transport-leg path was removed via reseed** (pre-launch,
  per the repo's reseed-not-migrate convention). Emissions transport attaches to
  the cargo (biochar product), not the sales transaction.

No open decisions remain from this plan; any follow-ups live in
`docs/open-questions.md`.
