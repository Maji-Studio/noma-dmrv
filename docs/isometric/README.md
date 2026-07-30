# Isometric Requirements KB

> **Non-authoritative.** These files interpret the Isometric sources pinned in
> [`versions.json`](./versions.json). Verify the linked registry material before
> changing credit logic or making a credit claim.

## Current scope

This knowledge base describes the Certify project observed and re-pinned on
2026-07-24:

- Biochar Production and Storage Protocol v1.1
- Biochar Storage in Agricultural Soils v1.1
- Biomass Feedstock Accounting v1.2
- Energy Use Accounting v1.2
- Transportation Emissions Accounting v1.1
- Embodied Emissions Accounting v1.0

The GHG Accounting module and Biochar Storage in Soil Environments module are
not part of this pinned v1.1 interpretation set. Historical ADRs and archived
plans may cite them; their current-applicability notes take precedence.

## Current documents

| File | Purpose |
|---|---|
| [`versions.json`](./versions.json) | Single protocol and module version pin |
| [`requirements-shortlist.md`](./requirements-shortlist.md) | Source-linked requirement shortlist for product and engineering work |
| [`schema-mapping.md`](./schema-mapping.md) | Current code/schema coverage and verified gaps |
| [`p0-compliance-checklist.md`](./p0-compliance-checklist.md) | Submission-critical implementation checklist |
| [`simple-implementation-guide.md`](./simple-implementation-guide.md) | Plain-language guide to what exists, what is derived, and what is missing |
| [`condition-registry.md`](./condition-registry.md) | Conditional-field trigger map |
| [`integration-plan.md`](./integration-plan.md) | Current Certify integration contract |
| [`openapi-index.md`](./openapi-index.md) | Committed Certify type surface and proven call sites |
| [`sandbox-template-authoring.md`](./sandbox-template-authoring.md) | Current sandbox template contract and validation workflow |
| [`changes.md`](./changes.md) | Dated implementation and interpretation changes |
| [`update-playbook.md`](./update-playbook.md) | Version and API refresh procedure |

The 2026-07-24 adversarial source review is preserved at
[`docs/archive/2026-07-24-isometric-gap-check-v1-1.md`](../archive/2026-07-24-isometric-gap-check-v1-1.md).
It is evidence for the current gap classifications, not a claim that its
candidate list is exhaustive.

## Implementation map

- Certify HTTP client and generated types: `src/lib/isometric/`
- Removal and GHG Statement orchestration: `src/fn/certification/`
- Provider-neutral persistence: `src/db/schema/certification.ts`
- Per-organization encrypted credentials:
  `src/data-access/certifier-credentials.ts`
- Credit-batch lineage, roll-ups, and stored-CO2e preview:
  `src/data-access/credit-batch-accounting.ts`
- Exact evidence-to-registry-input rules:
  `src/lib/certification/removal-source-bindings.ts`
- Certification workspace UI: `src/components/certification/`

Application code must use `getIsometricClientForOrg()`. Environment credentials
remain only an escape hatch for scripts and dedicated health checks.

## Reading order

For a compliance change, read `versions.json`, the shortlist, schema mapping,
P0 checklist, and relevant current code/tests. For an integration change, read
the integration contract, OpenAPI index, relevant ADRs, and
[`docs/open-questions-isometric.md`](../open-questions-isometric.md).

Do not copy historical migration instructions or proposal data models into a
current implementation claim. Use `implemented`, `partial`, `missing`, and
`registry-owned` precisely.

## Freshness

- Version pin observed: 2026-07-24
- Requirements and integration cross-check: 2026-07-29
- Authority: registry URLs recorded in `versions.json`
