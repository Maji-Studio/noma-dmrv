# E2E manual-test findings — fix plan — archived

This fix plan has been **executed and archived**. Full tiered findings with
verified file:line refs and concrete fixes:
[docs/archive/2026-06-07-e2e-findings-fix-plan.md](../archive/2026-06-07-e2e-findings-fix-plan.md).

## Stable decisions / outcomes (evergreen)

- **A1 tenancy model — resolved: single-org / shared-data.** All authenticated
  users may read/edit/delete shared records; there are no per-user ownership
  checks. The `*Options` fetchers and list queries are aligned to this model
  (the earlier "supplier picker shows others' rows" symptom was this model, not
  a leak). `requireAuth` enforces authentication, not ownership.
- **Sequencing that was followed:** A1 (tenancy decision) first → B1/B2
  correctness → C1–C4 polish → D1–D3 product decisions.
- **P0/P1/P2 items were fixed.** P3 product decisions (Readings wire-in vs
  remove, registry-mirror view) are tracked in `docs/open-questions.md`.

Source of the underlying findings: `memory/e2e-manual-test-findings-2026-06.md`.
