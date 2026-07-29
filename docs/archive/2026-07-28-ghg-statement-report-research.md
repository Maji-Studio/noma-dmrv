# GHG Statement report requirements and noma workflow

Date: 2026-07-28  
Scope: Isometric Certify GHG Statement submission and resubmission, with a
recommended noma product workflow. This is research, not an implementation
decision.

## Executive answer

Isometric requires a `ghg_statement_report_url` when a supplier submits or
resubmits a GHG Statement. Its public API describes this only as a URL that
"should be accessible to the verifier"; it declares no URL format, MIME type,
file extension, or size constraint. The current supplier guide is more useful:
it says the statement data should have a **written report for the reporting
period**, stored in a **shared drive visible to the assigned verifier and the
Isometric team**, and that the supplier enters that link when submitting.

Therefore:

- A report is required, but **PDF is not an Isometric API or published user-guide
  requirement**. PDF is currently a noma UI/product convention.
- **Anonymous public access is not required.** An access-controlled shared-drive
  link is the official recommendation, provided both the assigned verifier and
  Isometric can open it.
- Isometric publishes no report MIME, byte-size, filename, or retention limit in
  the submit contract.
- The report should remain accessible for the verification and amendment audit
  trail. That is an operational inference, not a published duration: Isometric
  says historical statement versions are kept, but does not publish how long the
  linked report must remain hosted.
- The report is separate from the GHG Statement's structured carbon accounting
  and from Datapoint Sources. It supplies narrative context, supporting
  information, and justification; Sources remain the evidence attached to
  carbon-accounting Datapoints.
- Isometric does **not** generate the supplier's GHG Statement report. A June
  2026 feature generates a different artifact: a pre-populated **verification
  report template for VVBs**, downloadable as Word for the verifier to finish.
- noma currently neither builds nor hosts a report. It accepts an operator URL,
  labels it a PDF, journals a `documents` row pointing to it, and passes the URL
  to Isometric.

Primary Isometric sources:

- [GHG Statements supplier guide](https://docs.isometric.com/user-guides/certify/ghg-statement)
- [POST GHG Statement Submit API reference](https://docs.isometric.com/api-reference/certify/post-ghg-statement-submit)
- [Isometric Standard v1.7](https://registry.isometric.com/standard/1.7/1.7.0)
- [Biochar Production and Storage v1.1.1](https://registry.isometric.com/protocol/biochar/1.1/1.1.1?tag=1.1.1)
- [GHG Accounting v1.1](https://registry.isometric.com/module/ghg-accounting/1.1)
- [Sensitivity analysis guide](https://docs.isometric.com/user-guides/certify/sensitivity-analysis)
- [Certify data visibility](https://docs.isometric.com/user-guides/certify/data-visibility)
- [Isometric product changelog](https://isometric.com/changelog)

## Research method and authority limits

Repository policy asks agents to use Isometric's MCP for protocol/compliance
questions. A tool search on 2026-07-28 returned no callable Isometric connector;
the available results were unrelated GitHub/OpenAI tools. A background-research
slot was also unavailable. This note therefore uses only first-party Isometric
web documentation, the Isometric OpenAPI snapshot generated into this
repository, and noma's current source code.

The project's pinned protocol is Biochar Production and Storage v1.1.1 and the
observed Certify project Standard version is v1.7; see
[`docs/isometric/versions.json`](../isometric/versions.json). Where this note
proposes a report outline, it is clearly marked as a product recommendation
rather than an undocumented Isometric template.

## What the API actually requires

The official submit endpoint accepts either:

```json
{
  "ghg_statement_report_url": "<string>"
}
```

or, for resubmission:

```json
{
  "ghg_statement_report_url": "<string>",
  "summary_of_changes": "<string>"
}
```

Both fields are required in their respective shapes. The only published
description for `ghg_statement_report_url` is that the URL should be accessible
to the verifier. The schema is a plain string: there is no `format: uri`, MIME
type, extension, content-length, or size field. The same contract is present in
noma's generated OpenAPI snapshot:
[`SubmitGhgStatementRequest`](../../src/lib/isometric/generated/mrv.openapi.json#L6037)
and
[`ResubmitGhgStatementRequest`](../../src/lib/isometric/generated/mrv.openapi.json#L5528).

This means the following distinctions matter:

| Question | Published Isometric requirement | Recommended noma posture |
|---|---|---|
| Is a report link required? | Yes, for submit and resubmit. | Fail closed without a reviewed report artifact/link. |
| Must it be PDF? | Not documented. The guide says “written report.” | PDF is a sensible immutable delivery format, but label it a noma choice until Isometric confirms a project template/format. |
| Must it use HTTPS? | Not declared in the API schema. | Keep noma's HTTPS-only rule. It is the safe baseline for verifier access. |
| Must it be anonymous/public? | No. The guide explicitly recommends a shared drive visible to the verifier and Isometric. | Support controlled access. Do not make confidential reports public merely to satisfy the URL field. |
| Must Isometric's API server fetch it? | Not documented. | Do not assume server-side fetch or use a short-lived presigned URL. Ensure human verifier access. |
| MIME/content type/size? | Not documented. | If noma generates a PDF, validate `application/pdf` and impose a noma-owned cap; do not represent those as Isometric limits. |
| How long must the link live? | No published duration. | Preserve each submitted version and keep its URL usable through verification and the audit lifecycle. |

The supplier guide's shared-drive instruction is strong evidence that an
authenticated Google Drive/SharePoint-style link is acceptable in principle.
Access must actually be granted to the assigned VVB and Isometric; “anyone in
the supplier organization” is insufficient.

## What belongs in the report

### Published requirements

Isometric does not publish a fixed supplier-report template or an exhaustive
section list in the public API/user guide. It does establish these content
responsibilities:

1. The report is a written report for the reporting period accompanying the
   structured statement data. The GHG Accounting guidance describes a GHG
   Statement Report as qualitative information relating to the statement.
2. The complete cradle-to-grave system boundary, associated project emissions,
   and leakages must be represented across the GHG Statement and corresponding
   report. Standard v1.7 §2.5.1 and §2.5.10 require emissions, removals, and
   leakages to be presented together in net tCO2e and call out transport, energy,
   and embodied-emissions accounting.
3. The Biochar Protocol v1.1.1 §7.1 requires the boundary to cover project
   establishment, operations, and closure/end-of-life, including biochar
   production, processing, characterization, transport, and spreading. It also
   requires miscellaneous emissions to be identified and exclusions to be
   justified with evidence.
4. Uncertainty must be documented. Standard v1.7 §2.5.7 requires the parameter
   list, reproducible sensitivity-analysis method, uncertainty information, and
   a source or justification for relevant input uncertainty. Certify's current
   workflow performs the sensitivity analysis on the draft statement; it is
   required for the project's first verification and then optional, with
   justifications required for sensitive inputs.
5. The verifier must be able to inspect supporting evidence. Isometric's data
   visibility guide says all source files included in a submitted statement are
   visible to the assigned verifier. The Biochar Protocol v1.1.1 §6.6 identifies
   measurements, calibration/supporting documents, emission factors, scientific
   literature, and permits as underlying evidence/data.

These sources do **not** say every raw file must be embedded in the report. The
clean model is:

```text
GHG Statement / GHG Entries  = structured calculations and quantities in Certify
Datapoint Sources            = raw evidence and citations attached in Certify
GHG Statement report         = reporting-period narrative, context, reconciliation,
                               exceptions, and justification
```

### Candidate noma report outline

This is the smallest defensible outline noma could pre-fill. It must be checked
against the project-specific template or instructions from the Isometric
Registry Operations Manager and assigned VVB before implementation.

1. **Document control**
   - project, supplier, facility, Isometric project ID, GHG Statement ID
   - reporting-period start/end, report version, preparation/approval date
   - applicable Standard, protocol, and module versions
2. **Period and statement scope**
   - included GHG Entry/Removal IDs and noma Removal/credit-batch references
   - included facilities and material operations
   - changes from the validated PDD/LCA and from the preceding period
3. **Net GHG summary**
   - stored CO2e, counterfactual, project/operational emissions, leakages
   - gross and conservative net removal, uncertainty discount, buffer allocation
   - reconciliation to the live Isometric statement
4. **System boundary and methodology**
   - establishment, operations, and end-of-life coverage
   - production, processing, characterization, transport, spreading, energy use,
     embodied emissions, and any reporting-period/project components
   - materiality, GWP basis, allocation/attribution method, and exclusions
5. **Operational and material-flow summary**
   - production runs, feedstock, produced/delivered/applied biochar, samples, and
     storage pathway for the period
6. **Data quality and evidence index**
   - measurement methods and QA/QC
   - evidence/source references by calculation category
   - assumptions, estimates, proxies, low/medium-quality data, and why better
     data was unavailable
7. **Uncertainty and sensitivity**
   - Certify sensitivity-analysis status and date
   - sensitive parameters, uncertainty sources/justifications, method, and
     conservative treatment
8. **Exceptions and incidents**
   - process upsets, spills/losses, corrections, missing data, deviations, and
     their accounting treatment
9. **Monitoring, durability, and risk**
   - relevant monitoring coverage and period-specific exceptions
   - durability tier and supporting measurement/ledger references
   - risk-of-reversal/buffer context where it changed or needs explanation
10. **Declarations and approvals**
    - operator review, completeness statement, report approver, and
      confidentiality markings

Quantities should be sourced from Isometric wherever its API exposes the
authoritative value. Where the API does not expose a full statement breakdown,
noma may render its frozen Removal compilation snapshots only after checking
membership and totals against the live Isometric statement. A generated report
must never silently read mutable operational rows after the relevant Removal was
submitted.

## Isometric does not generate the supplier report

The supplier guide assigns preparation and hosting to the supplier. The submit
API takes an externally hosted URL and exposes no report-create or report-upload
endpoint.

The June 26, 2026 Isometric changelog entry can be misread: its “verification
report template” is for **verifiers/VVBs**, is pre-populated from Certify, and is
downloadable as a Word document for the VVB to finish. It is the verifier's
verification report, not the supplier's GHG Statement report and not a
replacement for `ghg_statement_report_url`.

## Current noma behavior and gaps

Current behavior:

- [`submitGhgStatementDialogSchema`](../../src/schemas/certification.ts#L142)
  accepts any syntactically valid HTTPS URL. It does not fetch the target,
  inspect content type, or prove access.
- The dialog calls it a “published PDF report” and uses a `.pdf` placeholder:
  [`ghg-statement-submit-dialog.tsx`](../../src/components/certification/ghg-statement-submit-dialog.tsx#L109).
  That is stronger than Isometric's public contract.
- Before calling Isometric, the action creates a local document row:
  [`ghg-statements.ts`](../../src/fn/certification/ghg-statements.ts#L645).
- [`attachReportDocument`](../../src/data-access/certification.ts#L876)
  stores only the external `fileUrl`, unconditionally labels the document type
  `pdf`, and derives the filename from the URL. It neither generates nor uploads
  bytes.
- The submit/resubmit action passes the URL directly to Isometric:
  [`ghg-statements.ts`](../../src/fn/certification/ghg-statements.ts#L661).
- External report links viewed through noma's document route are host-allowlisted.
  The default list excludes ordinary shared-drive hosts even though Isometric's
  guide recommends a shared drive:
  [`redirect-allowlist.ts`](../../src/lib/documents/redirect-allowlist.ts#L30).

Consequences:

- An arbitrary HTTPS HTML page or inaccessible document can be recorded locally
  as a PDF and submitted.
- A failed/retried provider submission can create additional local report rows
  because attachment happens before the provider call.
- A valid shared-drive URL may work for Isometric yet fail when opened through
  noma's redirect route.
- The operator has no structured assistance for the qualitative content and no
  report-to-statement reconciliation.

## Smallest sensible noma implementation

Do not begin with a one-click fully automatic submit. The report contains
qualitative judgments and exceptions that noma cannot infer safely.

### First: confirm the project template

Ask the project's Isometric Registry Operations Manager/VVB for:

- the current supplier GHG Statement report template/example;
- whether PDF is required or merely preferred;
- required shared-drive permissions and expected access lifetime;
- confidentiality/publication expectations;
- whether sensitivity output should be copied into the report or referenced from
  Certify;
- any project-specific biochar sections.

The public docs are insufficient to hard-code an exact compliant template.

### Then: generated, reviewed, versioned report

1. Add a **Prepare report** step on the local GHG Statement after live membership
   reconciliation.
2. Pre-fill stable facts from the statement, submitted Removal snapshots,
   evidence inventories, and live Isometric IDs/totals.
3. Require operator-entered/reviewed fields for period changes, exclusions,
   incidents, data-quality justifications, and confidentiality.
4. Block final generation on unresolved membership/total drift and missing
   required narrative.
5. Render a deterministic, versioned PDF, store it in noma's private object
   storage, and record its content hash plus source snapshot/version metadata.
6. Present a review/download step. An admin explicitly approves the immutable
   report version before submission.
7. Make the approved version reachable at a stable HTTPS URL:
   - if the report has no confidential content, noma's existing public-document
     route can provide a stable application URL while minting fresh storage URLs;
   - if it is confidential, use controlled sharing or retain the
     operator-provided shared-drive path. Do not solve verifier access by
     publishing confidential content anonymously.
8. Submit that approved URL to Isometric. Attach/reuse the document
   idempotently only when the provider call succeeds or reconciliation proves it
   applied.
9. On amendment, create a new immutable report version and require
   `summary_of_changes`; never overwrite or delete the version referenced by an
   earlier statement submission.

The existing storage layer already supports server-generated PDFs, private
objects, stable app document URLs, and public document visibility; see
[`docs/storage.md`](../storage.md#reads-always-go-through-the-app). The main new
work is a report model/template, frozen input assembly, review/approval state,
and a deliberate external-sharing policy.

## Open questions requiring Isometric/project confirmation

1. Is there a current supplier template not published in the public docs?
2. Does this project's verifier require PDF, permit an editable Google
   Doc/Word file, or expect both?
3. What exact users/groups must be granted access, and for how long after
   verification/credit issuance?
4. Is the supplier report itself eventually public, verifier-only, or
   project-configurable?
5. Which sensitivity-analysis outputs must appear in the written report versus
   remain referenced in Certify?
6. Does the VVB expect full calculation tables in the report, or only a
   reconciliation summary with links to Certify's GHG Entries and Sources?
7. Are there project-specific sections for the Sifuri Halisi Biochar Project
   beyond Standard v1.7 and Biochar Protocol v1.1.1?
