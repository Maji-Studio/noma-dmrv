# QA-A coverage

Status meanings: **PASS**, **FAIL**, **INCONCLUSIVE**, **NOT RUN**.

| Area | Check | Status | Result / evidence |
|---|---|---:|---|
| Boot | Current HEAD `/login` | FAIL | Compile overlay; `screenshots/server-compile-blocker.png` |
| Auth | Normal UI sign-in | PASS | Landed on `/dashboard` on isolated same-commit server |
| Empty start | Dashboard before facility selection | PASS | `screenshots/empty-start.png` |
| Facility gates | Dashboard, traceability, feedstocks, production runs, products, reactors, storage, energy, orders, deliveries, applications, credit batches, samples, removals, GHG statements, production processes, certification settings | PASS | 17/17 had exactly one gate, no create CTA, no crash; `raw-results-pass1.json` |
| Route canonicalization | `/chain-of-custody` | PASS | Redirected to `/traceability` |
| Organization | Create/enter QA-A organization | PASS | Namespaced organization used |
| Organization | Create/enter second QA-A organization | PASS | Namespaced second organization used |
| Facility | Create primary and secondary through UI | PASS | IDs retained in `raw-results.json` |
| Validation | Whitespace-only name | PASS | Inline rejection |
| Validation | 264-character name | PASS | Inline rejection |
| Validation | Exact duplicate name | FAIL | Duplicate accepted |
| Durability | Rapid double-submit | FAIL | Count 2 → 4 |
| Durability | Reload during create | INCONCLUSIVE | Reload aborted in-flight requests and the post-reload locator did not yield a trustworthy count |
| Navigation | Browser Back after create | PASS | No crash; returned to facilities route |
| #473 | Fresh-context valid `?facility=` resolution | FAIL | Query removed; facility unresolved |
| Facility switch | List screen | INCONCLUSIVE | Direct scoped navigation exercised; a standalone selector switch was not independently captured |
| Facility switch | Detail screen open | FAIL | Modal overlay blocks switcher |
| Facility switch | Form screen open | FAIL | Modal overlay blocks switcher |
| Same-org scope | Facility Two deep link to Facility One run | PASS | `run` removed, record hidden, safe toast |
| Cross-org scope | Second org deep link to first-org facility/run | PASS | No names, codes, counts, or data leaked |
| Archive | Preview positive dependency counts | PASS | 1 reactor and 1 production run |
| Archive | Confirm application/sample categories | FAIL | Zero-count categories hidden |
| Archive | Cancel | PASS | Facility remained active |
| Sign-out | Simulated 503 with two tabs | PASS | Both tabs retained protected dashboard |
| Sign-out | Confirmed success with two tabs | PASS | Both tabs reached `/login` |
| Instrumentation | Screenshots | PASS | Seven required/diagnostic PNGs, with account identifier redacted |
| Instrumentation | Video | PASS | `video/qa-a-auth-facility-pass.webm` |

## Constraints and omissions

- Facility and reactor codes are server-generated; their UI forms expose no code input. The requested custom code prefix therefore could not be applied without bypassing the normal UI, which this run did not do. The custom production identifier used the required prefix.
- Supplier/customer/formulation pages are organization-scoped and did not show a facility gate.
- Issue #456's distance-based party matching and #453's local certifier environment were not fully exercised because the journey did not create the prerequisite business chain/environment.
- No database reset, migration, broad teardown, product edit, issue filing, or cleanup was performed.
