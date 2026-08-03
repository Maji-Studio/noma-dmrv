# UX review fixes (e2e flow + certification) — archived

The 2026-06-07 UX review has been **mostly executed and archived**. Full
walkthrough, per-item status, and verification log:
[docs/archive/2026-06-07-ux-review-fixes.md](../2026-06-07-ux-review-fixes.md)
(12 done · 1 partial · 6 open).

## Still-open items (evergreen — pick up here)

- **P2 detail-pattern convention.** Credit Batch = full page; Production Run =
  side-sheet. Pick one (full page recommended for entities with child data).
- **P2 removal RM-code.** Removals show a raw UUID; add a local
  `RM-2026-NNN` code on create, keep the registry ID as "Set on submit".
- **P2 production-run code format.** Draft `PR-26-001` (2-digit year) vs
  `PR-2026-NNN` elsewhere — align the code generator.
- **P2 row-action affordances.** Standardize the DataTable row-action pattern;
  move destructive Delete behind a `⋯` menu or confirm.
- **P2 stat-card density.** Normalize card count/layout across entity pages
  (Feedstocks = 4, Suppliers = 1).
- **P3 facility selector empty box** before data loads — add a
  placeholder/skeleton.

Partial: P3 disabled-Submit tooltip (code in place, not browser-reproduced —
seed has no selectable-but-unready batch).
