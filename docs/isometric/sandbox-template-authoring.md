# Sandbox GHG Entry template guide

Read this before selecting or changing a Removal template. The live template,
reviewed component contracts and committed mappings determine compatibility.
This guide describes code checked on 2026-10-30; it does not approve factors or
claim complete submission verification. Direct sandbox read probes are in
[registry behavior](./registry-behavior.md).

## Inspect before authoring

The sandbox project is pinned in [versions.json](./versions.json). Use sandbox
credentials; the historical MCP account view is not evidence of sandbox access.
Template editing is an operator action in Certify, outside the app's API writes.
Inspect without mutating:

```bash
pnpm tsx scripts/isometric-smoke.ts inspect-template prj_1K9YJ33RKSBX9FFF
```

Read these owners rather than copying their tables into docs:

| Contract | Owner |
|---|---|
| Input meaning, transforms and Source targets | `src/lib/isometric/semantic-binding-catalog.ts` |
| Tier support and storage shapes | `src/lib/isometric/storage-blueprints.ts` |
| Reviewed component-ID contracts | `src/lib/isometric/template-observations/line-sources.ts` |
| Contract-aware automatic-source selection | `src/lib/isometric/datapoint-mapping.ts` |
| Document classification onto exact targets | `src/lib/certification/removal-source-bindings.ts` |

## Template invariants

A usable Removal template belongs to the mapped project and has exactly one
supported storage component compatible with the facility's durability tier.
Every monitored input needs a supported automatic source, durability binding or
emissions-entry shape. Every fixed input needs a justified registry Datapoint.
Compilation checks units, quantity kinds, shapes, reviewed contracts and scope
before writing to the registry.

Contracts are keyed by **component ID**. Proposed assignments grant no authority
until reviewed; surviving IDs carry their contracts forward. Display names,
including diesel and Safety margin labels, do not select sources. Ambiguous
owners and missing/invalid contracts require review. See
[ADR 0032](../adr/0032-per-batch-emissions-entries-bound-to-template-lines.md).

Establishment/end-of-life inputs remain project-owned. Operating inputs need
records, emissions entries or a Removal-confirmed zero. No period-input stubs
are allowed. A coverage warning for an entry-only line is not permission to
submit that line empty.

## Storage support

The sampled 1,000-year code path uses
`biochar_sequestration_1000_year_f_durable_max` under `co2-stored`:

| Input | Shape | Quantity kind | noma value |
|---|---|---|---|
| `total_carbon_contents` | list | `mass_fraction_dry_basis` | Same-Sample total-carbon replicates |
| `inorganic_carbon_contents` | list | `mass_fraction_dry_basis` | Directly measured inorganic-carbon replicates |
| `product_mass` | scalar | `mass` | Standalone product-mass Datapoint |
| `s_fraction` | list | `dimensionless_ratio` | Same-Sample reflectance fractions |

Each sampled batch needs at least three complete paired replicates. Create one
remote measurement-sample submission per physical Sample, retaining its stable
identity and sampling instant. Never replace these with one mean/standard
deviation request or repeat batch mass on each Sample. A current four-input component was observed on the sandbox project, but the
registry pairing key, corrected remote grain, component applicability and mapped
facility template still need confirmation. Production stays blocked. Track the exact outstanding
checks in [open questions](../open-questions-isometric.md).

The deprecated `biochar_sequestration_1000_year` is historical read/reconciliation
support only; do not select it for a new mapping. The 200-year sampled/unsampled
keys are recognized but gated pending confirmed units and bindings. Unsampled
1,000-year is unsupported. Recognizing a key does not enable submission.
`carbon_rich_substance_sequestration` remains legacy compatibility only.

## Fixed inputs and evidence

Create/select factors and bind their justification Sources in Isometric.
Noma submits operating quantities and never stores a competing fixed-factor
inventory. Retired DEFRA/IPCC example values are not project-approved defaults.
Do not restore a `fixed_constants` table.

Source plans are exact-input and snapshot/hash-covered. Delivery proof,
Application evidence health, Datapoint attribution and Application Source links
are distinct checks. See [integration contract](./integration-plan.md#immutable-versions-and-evidence).

## Validate a change

1. Inspect the saved template with the command above.
2. Update `tests/fixtures/isometric-coverage.json` if its selected contract changes.
3. Run the live compatibility check:

   ```bash
   pnpm isometric:coverage-check -- --source=fixture
   ```

4. For configured facilities, also run with `--source=db`.
5. Review/select the template in the facility mapping, then compile a Removal
   and inspect its inputs and Source plan before submission.

Fixture mode still fetches live templates. Coverage success establishes mapping
compatibility only; it does not prove batch readiness or protocol compliance.
Unmapped inputs, unbound fixed values, forbidden scope, unsupported storage and
unsettled contracts fail. Entry-only lines can warn during coverage and still
require entries during submission.
