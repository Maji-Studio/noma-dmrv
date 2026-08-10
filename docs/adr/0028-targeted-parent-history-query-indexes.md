# Targeted parent and history query indexes

> **Current status: Accepted and implemented** (reviewed 2026-08-10).

Several recurring tenant-scoped reads filter by a parent identifier and, for
history views, return newest records first. The previous indexes either covered
only `organization_id` or did not cover these reads. Query-plan checks against
representative data showed that five composite indexes remove avoidable scans
and sorts.

## Decision

- Index applications by organization, delivery, and application date.
- Index deliveries by organization, order, and delivery date.
- Index samples by organization, credit batch, and sampling time, limited to
  rows linked to a credit batch.
- Extend the production-run feedstock and biochar-product source-allocation
  indexes with `production_run_id`, retaining `organization_id` as the leading
  tenant key.
- Name each composite index for every indexed key so schema inspection exposes
  its intended coverage; abbreviate `organization_id` as `org` where the full
  name would exceed PostgreSQL's 63-byte identifier limit.

## Consequences

Parent-scoped reads can use the tenant and parent predicates together. History
reads can scan the date key backward without a separate sort. The partial sample
index avoids indexing unlinked samples that cannot satisfy credit-batch reads.

The set is intentionally narrow. Low-cardinality status indexes, duplicate
single-column parent indexes, and broader covering indexes were rejected because
no measured recurring query justified their write and storage cost. Index builds
use the repository's normal generated-migration flow; there is no production
database requiring concurrent deployment compatibility.
