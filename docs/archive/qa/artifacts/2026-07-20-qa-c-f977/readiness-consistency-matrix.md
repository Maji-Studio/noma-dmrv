# Readiness consistency matrix

| Surface | Observed setup/state | Expected shared meaning/remediation | Result |
|---|---|---|---|
| Dashboard/navigation | QA-C organization and facility exist; no Isometric project mapping | Operational certification routes hidden; Settings may remain | **Verified** — only Certification Settings appeared in navigation |
| Facility link modal | Newly created QA-C facility, no available project selected | Cannot link or expose submissions without a project | **Verified** — project required; default template unavailable until selection |
| Certification Settings | Facility has no Isometric project link | Explicit fail-closed configuration gate | **Verified** — stated submissions are blocked; estimate configuration unavailable; credentials `Not configured`; environment labeled Sandbox |
| Direct removal URL | Same unmapped facility | Redirect/gate to Settings without leaking removal content | **Partially verified** — ended at Settings, but first flashed the false `Select a facility` state (P3) |
| Production-run list | Running run plus failed readings import | Incomplete badge counts distinct gaps | **Verified** — `Incomplete (2)` agreed with missing Complete status and readings import |
| Dashboard vs credit batch vs removal | Missing application evidence | Same gap identity and actionable remediation | **Blocked** — no credit batch before server stop |
| Applications list | Complete fields, missing application evidence | `Incomplete`, evidence-specific explanation | **Blocked** — #246 not exercised |
| Evidence added/removed | All mounted surfaces | Refresh without reload; stale readiness retires | **Blocked** |
| GHG statements | Zero removals / missing mapping | Honest empty/configuration gate; never submitted with zero removals | **Blocked** |

The configuration gate was correctly fail-closed. Cross-surface equivalence for application evidence remains unverified.
