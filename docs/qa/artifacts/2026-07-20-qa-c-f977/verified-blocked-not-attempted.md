# Verified, blocked, and not attempted

## Verified

| Check | Result |
|---|---|
| Isolated namespace/browser used | `QA-C-20260720-f977`; no QA-A/QA-B record selected |
| Login recovered after authorized docs fix | Visible sign-in UI; zero console errors |
| QA-C organization and slug | Created through UI |
| QA-C facility | Created through UI; Tanzania, `Africa/Dar_es_Salaam` |
| Pre-mapping certification navigation | Only Settings exposed |
| Missing Isometric project/credentials | Clear fail-closed Settings gate; environment identified as Sandbox |
| Direct removal access | Ended at Settings; transient false facility-empty flash recorded as P3 |
| Supplier/source location | Created through UI |
| Reactor | Created through UI |
| Feedstock and biochar storage | Two isolated locations created through UI |
| Feedstock intake/allocation | `FS-26-001`, 20,000 kg wet at 15% moisture; 17,000 kg transferred to QA-C bin |
| Production run | `PR-26-001` created with energy fields and QA-C CSV attachment |
| Open-run CSV behavior | Attachment succeeded; import failed closed until end time; precise reason available on retry |
| External safety | No registry/project mutation or submission |
| Repo/database safety | No reset, migration, cleanup, second server, or product-code modification |
| Credential/PII handling | Values not persisted; screenshots containing signed-in email were removed from artifacts |

The UI auto-generated operational codes (`FAC-26-001`, `SUP-26-001`, `R-26-001`, `SL-26-001`, `SL-26-002`, `FS-26-001`, `PR-26-001`) and exposed no code override in the exercised forms. Isolation therefore relies on the required QA-C names and suffix rather than the requested code prefix.

## Blocked after the shared server stopped

- Confirming that production-run completion persisted
- Re-importing the CSV after an end time exists
- Credit batch and missing application evidence agreement (#246)
- Evidence add/remove/replace refresh and retirement
- Clustered and distributed sample verdicts (#474)
- Sample bounds, duplicate codes, date edits, and facility-timezone boundary dates
- Historical, unlock-day, post-unlock, and back-entered Method A/B cases (#445)
- Unsampled Method-B fail-closed route (#417)
- Removal remediation links, Back/reload, double-click, and facility switching
- GHG zero-removal, membership, reporting-period, and `In verification` checks

## Not attempted

- PDF upload
- Any external submission
- Cleanup
- Video/GIF of readiness-to-removal, because readiness-to-removal was never reached

The server was not restarted because the brief explicitly prohibited it.
