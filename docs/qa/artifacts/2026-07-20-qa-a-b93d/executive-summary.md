# QA-A executive summary

Run: `QA-A-20260720-b93d`  
Date: 2026-07-20  
Scope: authentication, organization switching, onboarding, and facility context

## Outcome

Release confidence is **low / no-go on the tested current HEAD**. The checked-out application cannot render `/login` because Tailwind scans a Markdown example into invalid CSS. Testing continued against an isolated archive of the same commit with only that documentation token neutralized; the shared database was not reset or migrated.

Beyond the boot blocker, tenant isolation and sign-out behavior were reassuring: same-organization cross-facility record links failed closed, a cross-organization deep link exposed no names, codes, counts, or record data, a simulated failed sign-out preserved protected content, and a confirmed sign-out cleared two tabs. However, issue #473 remains reproducible, and facility onboarding accepts exact duplicate names and creates duplicate rows under a rapid double-submit.

## Ranked result

- **P0:** current HEAD is unrenderable because a docs class example generates invalid Tailwind CSS.
- **P1:** fresh-session `?facility=` links lose facility and organization context (#473).
- **P1:** rapid double-submit persists two facilities.
- **P2:** exact duplicate facility names are accepted.
- **P2:** the modal detail/form sheet prevents facility switching while it is open.
- **P3:** archive preview models applications and samples but hides zero-count categories, so an operator cannot confirm their inclusion from the preview.

## Strong passes

- Seventeen principal facility-dependent routes showed one clear facility gate, no inactive create controls, and no crash before selection.
- Whitespace-only and 264-character facility names were rejected inline.
- Cross-facility and cross-organization record deep links failed closed.
- Archive cancellation left the facility unchanged.
- Failed and successful two-tab sign-out behavior matched the security requirement.

## Worst operator-experience gap

The worst gap is total application unavailability on the tested checkout. If the compile blocker is discounted as a local-development packaging defect, the next worst gap is a valid shared facility URL silently collapsing to a generic no-facility screen in a fresh session.

No product code was modified, no GitHub issue was created, and no cleanup was performed against the shared database.
