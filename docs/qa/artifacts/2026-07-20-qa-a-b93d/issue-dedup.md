# Issue deduplication

Current issues and merged changes from 2026-07-13 through 2026-07-19 were inspected before execution. No GitHub issue was created.

| Evidence | Existing issue / change | Dedup assessment |
|---|---|---|
| Fresh-session valid facility link loses context | #473 (OPEN) | **Exact duplicate / direct reproduction.** Attach this run's screenshot and IDs to #473 if desired. |
| Cross-facility production-run link fails closed with toast | #253 (OPEN) | **Regression pass for the production-run path.** The linked record did not open or become editable. |
| Cross-organization deep link exposes nothing | #372 (OPEN) | **Regression pass.** Current observed behavior is fail-closed. |
| Party matching/distance scope | #456 (OPEN) | **Not exercised deeply enough** to confirm or reject; no new finding recorded. |
| Local certifier facility mapping | #453 (OPEN) | **Not exercised** because the required certifier environment was unavailable in this journey. |
| Recursive computer-use failure | #476 (OPEN) | **Known tooling constraint respected.** The nested computer-use route was not recursively invoked; an isolated Playwright/Chrome profile was used. |
| Current-HEAD Tailwind compile blocker | No exact open issue found in inspected set | **Potentially new evidence**, not filed per instruction. Root is the Markdown arbitrary-class example. |
| Exact duplicate facility names | #378 (closed) is adjacent whitespace-validation work; #469 is adjacent durability work | **No exact duplicate found.** This is organization-scoped name ambiguity, not whitespace validation. |
| Rapid double-submit creates two rows | #229 and #469 are adjacent mutation/durability work | **No exact duplicate found.** Neither inspected issue precisely covers create idempotency for facilities. |
| Modal sheet blocks facility switch | #253 is related to context reconciliation | **Related, not duplicate.** The switch action cannot begin because navigation is inert. |
| Archive preview hides zero categories | Recent archive-impact work includes the dependency counts | **No exact open duplicate found.** Backend coverage is present; UI filters zeros. |
| Failed/successful two-tab sign-out | Recent sign-out changes | **Regression pass.** Protected content disappeared only after confirmed success. |

All named focus issues (#473, #456, #253, #372, #453, and #476) were open at inspection time.
