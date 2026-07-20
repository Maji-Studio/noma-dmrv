# Method A / Method B boundary matrix

The shared server stopped before a credit batch or production process could be created, so no row below is browser-verified.

| Scenario | Expected behavior | Browser result | Recon/dedup note |
|---|---|---|---|
| Batch before unlock date | Fixed as Method A | **Blocked** | PR #444 merged |
| Batch exactly on unlock UTC calendar date | Remains Method A | **Blocked** | PRs #444 and #475 merged |
| Batch after unlock date | Method B when process is validly unlocked | **Blocked** | PR #475 uses the shared UTC calendar-day boundary |
| Back-entered historical batch | Historical classification must not change | **Blocked** | #445 open: lookup may choose the latest process without batch effective date |
| Historical sample before process established date | Must not count toward baseline | **Blocked** | Requires browser verification |
| Unsampled Method-B batch with no eligible six-month pool | Fail closed; no submission without a conservative estimate | **Blocked** | #417 open; highest certification-integrity risk |
| Unsampled Method-B batch with one eligible value | Fail closed if estimator cannot produce required result | **Blocked** | #417 |
| Distributed Method-A baseline and deliberate unlock | Requires at least 30 qualifying samples plus plan/moisture fields | **Blocked** | Static lock/recount logic present |
