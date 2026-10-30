# Isometric knowledge base

Use this index to find protocol interpretations, implementation boundaries and
registry gotchas. These docs are non-authoritative. Call the official Isometric
MCP `how_to` and verify registry sources before changing credit logic or making
a credit claim. [Versions](./versions.json) is the sole protocol/module pin.

## Find the right owner

| Task | Read |
|---|---|
| Debug evidence links, filters, PATCH or reconciliation | [Registry behavior](./registry-behavior.md) first |
| Change a protocol interpretation | [Versions](./versions.json), [requirements shortlist](./requirements-shortlist.md), [schema mapping](./schema-mapping.md) |
| Check submission gaps and conditional gates | [P0 checklist](./p0-compliance-checklist.md), [condition registry](./condition-registry.md) |
| Understand local versus registry ownership | [Implementation guide](./simple-implementation-guide.md) |
| Change submission, evidence or retry behavior | [Integration contract](./integration-plan.md), [API index](./openapi-index.md) |
| Change/select a template | [Sandbox template guide](./sandbox-template-authoring.md) |
| Resolve an undecided behavior | [Isometric open questions](../open-questions-isometric.md) |
| Refresh sources or generated types | [Update playbook](./update-playbook.md) |
| Find past decisions or investigations | [Change history](./changes.md), [ADRs](../adr/) |

The pinned interpretation is the 2026-07-24 project observation: Biochar v1.1,
Agricultural Soils v1.1 and the accounting modules in `versions.json`.
GHG Accounting and Soil Environments are outside this pinned set. Historical
ADRs/plans may refer to another version; read their applicability notes.

## Implementation entry points

- HTTP client, generated types and semantic catalog: `src/lib/isometric/`.
- Submission orchestration: `src/fn/certification/`.
- Provider-neutral persistence: `src/db/schema/certification.ts`.
- Organization-scoped encrypted credentials: `src/data-access/certifier-credentials.ts`.
- Canonical accounting and roll-ups: `src/data-access/credit-batch-accounting.ts`.
- Evidence classification: `src/lib/certification/removal-source-bindings.ts`.

Prefer these owners over copying signatures or mapping tables into prose.
Use [status terms](./simple-implementation-guide.md#status-vocabulary) precisely;
local code, isolated sandbox probes and full submission verification are distinct.

## Verification provenance

- Protocol pin observed 2026-07-24; original requirements cross-check 2026-08-04.
  Later source-specific checks keep their dates in the owning document.
- Code cleanup checked against staging `5eb7aa111` on 2026-10-30.
- Direct sandbox reads reproduced the filter/readback behavior on 2026-10-30;
  public registry pages supplied a scoped source cross-check. The
  [verification record](../archive/2026-10-30-isometric-verification.md) distinguishes
  exact patch checks, the Transportation minor-page fallback and historical facts.
- Authenticated MCP access still needs administrator review. The peer readback
  fix and full evidence-bearing staging submission retest remain outstanding.

The [2026-07-24 gap-check](../archive/2026-07-24-isometric-gap-check-v1-1.md)
is historical evidence, not an exhaustive current assessment. Production Data
research is preserved in the [API research](../archive/2026-08-04-facility-production-data-api.md),
[follow-up](../archive/2026-08-04-production-data-follow-up-research.md),
[repo seams](../archive/2026-08-04-production-data-follow-up-repo-seams.md) and
[support questions](../archive/2026-08-04-production-data-follow-up-support-questions.md).
