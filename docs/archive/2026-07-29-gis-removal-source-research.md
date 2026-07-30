# GIS boundary as an Isometric supporting Source: research

Date: 2026-07-29

> Non-authoritative interpretation of the linked Isometric sources. Confirm the
> Certify project's protocol version before changing certification rules.

## Outcome (recorded 2026-07-29, after implementation)

The verdict below was **not** adopted as written. What shipped keeps and hardens
the exclusion: `classifyRemovalSourceCandidate` returns `null` for an
application `gis_boundary`, now as an explicit forward guard. The reasoning is
the third bullet under the verdict, which this research also supports: a GIS
boundary is not proof of `product_mass`, and binding it to a GHG-entry Datapoint
would misattribute it.

Deferred, not rejected: attaching the boundary GeoJSON as a Source on the
biochar application itself, which needs `POST /biochar_applications` and its
`source_ids`. Revisit when Noma can submit biochar applications.

Read the verdict below as the starting research position, not as a live
instruction.

## Verdict

**The GIS boundary is valid supporting evidence and a GeoJSON file is an
Isometric-supported Source. Noma's complete exclusion of `gis_boundary` from
Removal supporting-source discovery is therefore incorrect.**

There is one important attachment distinction:

- Under the project's pinned Biochar Protocol v1.1, the boundary proves the
  application/storage area and belongs in the PDD evidence set.
- Certify supports uploading that `.geojson` as a Source and attaching Source
  IDs to datapoints. Its more semantically precise home is the biochar
  application, whose create request has `source_ids`.
- A GIS boundary should not automatically be described as proof of the
  `product_mass` datapoint. Weight/application-rate records support that
  quantity. If noma cannot yet submit biochar applications, it should either
  bind the GIS Source to an actual boundary/application input exposed by the
  project's template, or stop enforcing the unsupported rule that every GHG
  Entry must have at least one currently recognized file.

Thus the staging message is misleading in the reported case: noma has boundary
evidence, but its narrower classifier means "no file matched one of noma's
hard-coded GHG-input mappings," not "no supporting evidence is available."

## A. What evidence proves application boundary and storage

[`docs/isometric/versions.json`](../isometric/versions.json) records project
`prj_1K9YJ33RKSBX9FFF` on Biochar Protocol **v1.1**, which uses Biochar Storage
in Agricultural Soils **v1.1**.

Agricultural Soils v1.1 §4.2 requires project-area boundaries in the PDD. It
expressly permits clearly demarcated maps, boundary GPS coordinates, application
site GPS coordinates, or geotagged and dated photos/videos. It also says the
application rate paired with the project boundaries must be used to confirm
total applied mass.
[Isometric, Biochar Storage in Agricultural Soils v1.1 §4.2](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1)

Biochar Protocol v1.1 separately requires application-mass records such as
weigh-scale tickets or equivalent records to be retained for verification. That
is mass evidence, not a reason to disregard valid boundary evidence.
[Isometric, Biochar Production and Storage v1.1 §§8.3.1.1–8.3.1.2](https://registry.isometric.com/protocol/biochar/1.1)

## B. What may or must be a Certify Source

Isometric's upload guide says Sources support project MRV datapoints and gives a
three-step flow: create a Source, upload its file, then place its ID in a
datapoint's `source_ids`. Crucially, the supported evidence formats explicitly
include **GeoJSON** (`.geojson`, `application/geo+json`).
[Isometric Certify, Uploading sources](https://docs.isometric.com/api-reference/certify/uploading-sources)

The Source create operation is a document-upload abstraction: it requires a
file name, content type, content length, display name, project ID, and supplier
reference, then returns a signed upload URL.
[Isometric Certify, POST Source](https://docs.isometric.com/api-reference/certify/post-source)

The official biochar-application request includes `source_ids` alongside the
application date, average application rate, storage-site ID, production-batch
ID, and truck arrival/departure masses. `source_ids` defaults to `[]` and is not
in the schema's required list. Therefore:

1. a GIS Source **may** be attached to the biochar application;
2. Isometric's API does **not** make a non-empty Source list a prerequisite for
   creating that application; and
3. the API does not establish noma's universal "at least one supporting file
   per Removal" gate.

[Isometric Certify, POST Biochar Application](https://docs.isometric.com/api-reference/certify/post-biochar-application);
repository OpenAPI snapshot
[`src/lib/isometric/generated/mrv.openapi.json`](../../src/lib/isometric/generated/mrv.openapi.json)
(notably lines 629–640 and 938–946).

Storage locations are a different resource. The create API accepts a single
latitude/longitude point and has no polygon or geometry field. A GeoJSON
application boundary should therefore not be collapsed into the storage
location's point representation.
[Isometric Certify, POST Storage Location](https://docs.isometric.com/api-reference/certify/post-storage-location)

## C. What noma currently maps

Noma already treats GIS as application evidence:

- `applications.gisBoundary` stores normalized GeoJSON in JSONB
  ([`src/db/schema/application.ts`](../../src/db/schema/application.ts), line
  56).
- An uploaded original is retained as a `gis_boundary` document
  ([`src/components/applications/application-evidence-panel.tsx`](../../src/components/applications/application-evidence-panel.tsx),
  lines 321–329).
- The upload policy accepts `.geojson` MIME types
  ([`src/schemas/documents.ts`](../../src/schemas/documents.ts), lines 72–77 and
  106).

But Removal Source classification recognizes an application document only when
it is typed/classified as boundary **logbook quantity evidence**
(weighbridge/inventory/affidavit). It has no `gis_boundary` rule
([`src/lib/certification/removal-source-bindings.ts`](../../src/lib/certification/removal-source-bindings.ts),
lines 209–265). Candidate discovery calls that classifier and discards every
non-match
([`src/fn/certification/sources.ts`](../../src/fn/certification/sources.ts),
lines 842–913); the Overview evidence count repeats the same exclusion
([`src/fn/certification/evidence-mirror-summary.ts`](../../src/fn/certification/evidence-mirror-summary.ts),
lines 44–105).

For any persisted Removal, noma then enables `sourceBindingRequired`
([`src/lib/certification/readiness-facts.ts`](../../src/lib/certification/readiness-facts.ts),
lines 36–38), reports zero recognized candidates as "No supporting evidence
file is available"
([`src/lib/certification/readiness.ts`](../../src/lib/certification/readiness.ts),
lines 218–221), and independently blocks compilation when the candidate list is
empty
([`src/fn/certification/removal-submission-build.ts`](../../src/fn/certification/removal-submission-build.ts),
lines 275–301).

That exact chain explains staging: the GIS data exists and may even have an
uploaded original, but it is filtered out before the supporting-source count.

## Recommended correction

1. Count an uploaded `gis_boundary` document as a legitimate supporting Source
   and mirror it using Isometric's supported GeoJSON content type.
2. Keep its semantic role distinct from Inventory/product-mass evidence.
3. Attach it to the corresponding biochar application's `source_ids` when noma
   implements `POST /biochar_applications`; until then, bind it only to a real
   boundary/application template input if one exists.
4. For pasted GeoJSON, materialize the normalized boundary as a `.geojson` file
   before Source creation, because Certify Sources require an uploaded file.
5. Remove or narrow the unconditional non-empty Source gate unless Isometric or
   the project's configured template explicitly requires a non-empty Source at
   that submission stage.
6. Replace the generic error with the application code, accepted evidence
   types, and a direct link to the record that needs attention.

## Verification caveat

The Isometric MCP `how_to` tool was not available in this session. Findings were
checked against the official Registry, official Certify API documentation, the
repository's generated first-party OpenAPI snapshot, and current noma source.
