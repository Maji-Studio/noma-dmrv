# Application logbook evidence: Isometric requirement check

Date: 2026-07-29; re-verified 2026-07-31

> Non-authoritative interpretation of the linked Isometric sources. Confirm the
> Certify project's current protocol version before changing certification rules.

## Verdict

**The current application-level advisory is over-enforced.** For the project's
recorded protocol version, an Application does not need an uploaded logbook
classified as **Weighbridge, Inventory, or Affidavit** in order to be complete or
submitted as part of a Removal.

Those three alternatives are literal Isometric language, but they come from
Biochar Storage in Soil Environments v1.2, requirement `G-Z1CS-0`. That module
is not the storage module used by Biochar Protocol v1.1. The binding
Agricultural Soils v1.1 module does not contain that enumerated logbook rule.

This does **not** mean that application mass evidence can be discarded.
Protocol v1.1 separately requires delivery weigh-scale tickets, or equivalent
records, to be retained for verification for at least five years. Retention for
verification is different from requiring a typed document on every Noma
Application before submission.

## 2026-07-31 re-verification of the upload-type control

The selector labelled **Record type for the next upload**, with the choices
**Weighbridge**, **Inventory**, and **Affidavit**, is not required by the
project's pinned Isometric rules or by the Certify API schema:

- Biochar Protocol v1.1, requirement sections **8.3.1.1** and **8.3.1.2**, asks
  for the applied mass to be measured from arrival/departure truck weights and
  requires weigh-scale tickets or equivalent records to be retained for five
  years. It permits a signed receipt, bill of lading, and/or delivery photo when
  truck scales are unavailable and agreed with Isometric before verification.
  It does not define a Weighbridge/Inventory/Affidavit enum.
  [Biochar Production and Storage v1.1, §§8.3.1.1–8.3.1.2](https://registry.isometric.com/protocol/biochar/1.1#measurement-of-mass-of-biochar-applied)
- Agricultural Soils v1.1 requirement section **4.2** asks for project
  boundaries and permits geotagged dated photos or video as an alternative way
  to evidence spreading. The module contains no `weighbridge`, `logbook`, or
  `affidavit` classification.
  [Biochar Storage in Agricultural Soils v1.1, §4.2](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1#proof-of-biochar-spreading)
- The exact three alternatives occur in the later Soil Environments v1.2
  requirement **G-Z1CS-0**, section **8.5.2**. They describe acceptable records
  in the boundary-mapping evidence branch; they are not a registry field or
  document-type enum, and that module is not bound by Biochar Protocol v1.1.
  [Biochar Storage in Soil Environments v1.2, §8.5.2 (`G-Z1CS-0`)](https://registry.isometric.com/module/biochar-storage-soil-environments/1.2#project-boundary-mapping-with-application-records)
- The first-party `POST /biochar_applications` request requires application
  date, average application rate, project, storage site, production batch,
  arrival/departure truck masses, and supplier reference. `source_ids` is
  optional (the examples use `[]`, and the generated request schema assigns an
  empty-array default), and the request contains no evidence-type or record-type
  field.
  [Certify API: POST biochar application](https://docs.isometric.com/api-reference/certify/post-biochar-application)
- The first-party `POST /sources` request likewise has no weighbridge,
  inventory, or affidavit category. Its Source `type` distinguishes only
  `DOCUMENT` from `WEBSITE`.
  [Certify API: POST Source](https://docs.isometric.com/api-reference/certify/post-source);
  [Certify API: GET Source](https://docs.isometric.com/api-reference/certify/get-source)

**Product conclusion:** remove the three-way upload-type selector and any
per-file requirement to classify an application mass record with that taxonomy.
Keep a neutral way to retain or attach mass evidence somewhere in the product,
because v1.1 still requires the underlying records for verification. The whole
dedicated Application-mass upload section can be removed only if the same
records can be retained in a general document/evidence surface; removing the
taxonomy does not make the underlying records dispensable.

## Why

1. [`docs/isometric/versions.json`](../isometric/versions.json) records the
   Certify project as baseline/current Biochar Protocol **v1.1**, observed
   2026-07-24. Isometric's versioning policy says a project's current protocol
   version determines the rules and module versions used for ongoing
   verification and issuance. It also says new module versions apply only after
   a project adopts the protocol version that incorporates them.
   [Isometric protocol versioning](https://docs.isometric.com/user-guides/registry/protocol-versioning)

2. Biochar Protocol v1.1 points to **Biochar Storage in Agricultural Soils
   v1.1** for this pathway; it does not use Biochar Storage in Soil Environments
   v1.2. [Biochar Production and Storage v1.1, §§6.1 and 10](https://registry.isometric.com/protocol/biochar/1.1)

3. Agricultural Soils v1.1 §4.2 requires project-area boundary evidence in the
   **PDD**. It allows a map, boundary/site GPS coordinates, or geotagged dated
   media. It does not enumerate a logbook, weighbridge, inventory record, or
   affidavit as the paired Application requirement.
   [Biochar Storage in Agricultural Soils v1.1, §4.2](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1)

4. The “project boundaries and logbook” branch, including dates and quantities
   evidenced by weighbridge **or** inventory records **or** affidavit, appears
   in Soil Environments v1.2 §8.5.2 (`G-Z1CS-0`). Even there, §8.5 makes that
   branch an alternative to the visual-evidence method, not an additional
   requirement.
   [Biochar Storage in Soil Environments v1.2, §§8.5–8.5.2](https://registry.isometric.com/module/biochar-storage-soil-environments/1.2)

5. Protocol v1.1 §8.3.1.2 separately requires the proponent to **maintain**
   delivery weigh-scale tickets or equivalent records, carbon analyses, and
   spill records. Application-mass records must be kept for verification for at
   least five years. This supports an evidence-retention workflow, but the
   protocol does not turn the named document taxonomy into an Application or
   Removal submission gate.
   [Biochar Production and Storage v1.1, §§8.3.1.1–8.3.1.2](https://registry.isometric.com/protocol/biochar/1.1)

6. The first-party Certify API request for a biochar application requires the
   application date, application rate, linked project/storage/production
   resources, arrival/departure truck masses, and supplier reference. Its
   `source_ids` field defaults to an empty array and is absent from the required
   list. This independently indicates that an uploaded Source is optional at
   biochar-application creation time.
   [Isometric Certify API: POST biochar application](https://docs.isometric.com/api-reference/certify/post-biochar-application);
   repository snapshot:
   [`src/lib/isometric/generated/mrv.openapi.json`](../../src/lib/isometric/generated/mrv.openapi.json)

## Requirement by lifecycle stage

| Stage | What is required | What is not justified |
|---|---|---|
| Project validation / PDD | Storage-area location and project boundaries; Agricultural Soils v1.1 §4.2 permits several evidence forms | A per-Application `G-Z1CS-0` boundary-plus-logbook rule |
| Noma Application / Certify biochar application data | Date, applied-mass inputs, rate, storage location, production linkage, and arrival/departure truck masses | A mandatory uploaded Source, or the exact Weighbridge / Inventory / Affidavit taxonomy |
| Ongoing records / verification | Retain weigh-scale tickets or equivalent application-mass records for at least five years and make them available for verification | Treating retained evidence as a prerequisite for creating every Application or posting a Removal |
| Later protocol adoption | Re-evaluate if the project's current protocol version changes to one incorporating Soil Environments | Assuming a newer certified module applies automatically |

## Product implication

Remove the **boundary logbook evidence (Weighbridge, Inventory, Affidavit)**
Application readiness advisory and do not use its absence by itself to block a
Removal. Re-specify application spreading proof for v1.1 as project boundary
evidence **or** geotagged, dated visual evidence, rather than the v1.2
three-stage/GIS-plus-logbook branches.

Do not make applied-mass evidence optional. Keep a separate product-mass
evidence requirement at the Removal/storage-batch datapoint, sourced from the
v1.1 delivery weigh tickets or an approved equivalent. Keep a neutral document
upload path available for those retained records, and keep or add checks for
the required application data, especially arrival and departure truck masses
and application rate. The Noma-only three-way classification is unnecessary.

## Verification caveat

The Isometric MCP `how_to` tool was not callable in either the original or the
2026-07-31 re-verification session: no Isometric MCP tool was exposed in the
session, and `codex mcp list` showed no registered Isometric server. The
conclusion was therefore checked directly against the official Registry pages,
official versioning documentation, the official Certify API documentation, and
the repository's generated first-party OpenAPI snapshot. Before shipping the
rule change, re-confirm in the Certify UI that project
`prj_1K9YJ33RKSBX9FFF` still has current protocol version **1.1**.
