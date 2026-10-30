# Isometric docs verification, 2026-10-30

Evidence for the docs cleanup at staging baseline `5eb7aa111`. All registry
calls in this pass were reads. No Application, Datapoint, Source, template or
submission was created, changed or deleted.

## Access and limits

The configured local tool bridge refused connection. Official production MCP
initialization returned 401; sandbox MCP initialization and `tools/call` for
`how_to` returned 401 with the existing Certify sandbox credentials. MCP OAuth
remains unavailable and needs administrator review. Certify REST/GraphQL with
local sandbox credentials worked, so API behavior was checked directly. Public
registry pages supplied the protocol fallback; this is not MCP verification.
The prior investigation reported that the MCP GraphQL account saw production
only. That account view and the project UI protocol/Standard version were not
rechecked. The pin is unchanged.

## Sandbox API observations

Project `prj_1K9YJ33RKSBX9FFF` was visible in `GET /mrv/v0/projects`.
`GET /mrv/v0/biochar_applications?first=5` returned two records; both omitted
`source_ids`. Exact GET of one Application also omitted that property.
GraphQL returned both event IDs and one Source ID per event; the REST ID and
GraphQL event ID matched. This confirms readback availability, not acceptance
of a newly written Source list or the full Removal submit path.

The GraphQL selection was `project(id: ...).biocharSpreadEvents(first: 50)`
with `nodes { id biocharSpreadEventSources { source { id } } }`.
The project had two events, so these cases were not truncated:

| Request variation | Result |
|---|---|
| No filter | Both event IDs |
| `filter: { idIn: [existingId] }`, inline | Both event IDs |
| `filter: { idIn: [fabricatedId] }`, inline | Both event IDs |
| `filter: { idIn: $ids }`, existing-ID variable | Both event IDs |
| `filter: { idIn: $ids }`, fabricated-ID variable | Both event IDs |
| `filter: { storageLocationId: matchingLocationId }` | Only the matching event |
| Root `node(id: ...)` | HTTP 200 with unknown-field GraphQL error |
| `__schema { queryType { name } }` | HTTP 200 with introspection-disabled errors |
| Omit `X-Client-Secret`, keep Bearer | HTTP 200, Project and both event IDs |
| Omit Bearer, keep `X-Client-Secret` | HTTP 200, `ObjectNotFoundError` |

The missing-secret result differs from the historical 2026-10-19 report. It is
limited to this account, query and observation date; keep both headers in the
application client. HTTP status alone is insufficient to interpret GraphQL.

Template GET returned two legacy storage components and one current
`biochar_sequestration_1000_year_f_durable_max` component with monitored
`inorganic_carbon_contents`, `product_mass`, `s_fraction` and
`total_carbon_contents`. Existence does not prove facility selection, corrected
measurement grain or successful submission/supersession.

The full-list Datapoint PATCH semantics and incident-specific 429 visibility
were not reprobed because that would require mutation or historical logs.
Their original investigation provenance is retained in
[registry behavior](../isometric/registry-behavior.md).

## Public source cross-check

The audit read the pinned primary pages on 2026-10-30. Exact patch pages were
accessible for all sources below except Transportation, whose minor page was
used. Registry text does not independently establish the project's PDD choices.

| Source | Check and correction |
|---|---|
| [Biochar v1.1.1](https://registry.isometric.com/protocol/biochar/1.1/1.1.1?tag=1.1.1) | §§9.1.2, 9.2.4 and 9.2.4.1 support the recorded monitoring cadence, accuracy, calibration, temperature comparison and retention thresholds |
| [Agricultural Soils v1.1.0](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1/1.1.0) | §§3.3 and 4.1.1 distinguish at least three Samples per production batch and at least 500 R₀ measurements per Sample |
| [Feedstock v1.2.3](https://registry.isometric.com/module/biomass-feedstock-accounting/1.2/1.2.3) | §§2 and 2.3 make EC15 conditional for non-forestry feedstocks; EC14's zero counterfactual applies to government-managed/funded wildfire mitigation or restoration with evidence |
| [Energy v1.2.0](https://registry.isometric.com/module/energy-use-accounting/1.2/1.2.0) | §§5.1, 5.3 and 5.6 support the recorded annual-use threshold, conjunctive procurement criteria and hourly meter reporting |
| [Transportation v1.1](https://registry.isometric.com/module/transportation/1.1) | §§3.1, 5 and 6 support the preferred energy method, justified fallback, round-trip default and transport records; exact patch retrieval failed |
| [Embodied v1.0.3](https://registry.isometric.com/module/embodied-emissions/1.0/1.0.3?tag=1.0.3) | §3.2 requires review at crediting-period renewal and correction of changed/noncompliant allocation assumptions; the old years 1/3/5 schedule was unsupported |

The check is scoped to retained shortlist claims, not an exhaustive extraction
of every requirement or a new compliance approval. Application protocol support,
project applicability and registry-side calculations retain their open checks.

## Reconciliation after the readback fix

PR [#1514](https://github.com/Maji-Studio/noma-dmrv/pull/1514) merged on 2026-10-30.
The cleanup was rebased onto staging `e77794b07`, preserving the peer's history
entry in the archive and consolidating its implementation notes into the owning
guides. Code inspection confirmed exact-ID matching, the registered external
Storage Location parameter, cursor validation and the 10-page/50-node bound.
The old unconditional missing-secret HTTP-401 statement was replaced by the
scoped direct-probe results above. No full staging submission retest is claimed.
