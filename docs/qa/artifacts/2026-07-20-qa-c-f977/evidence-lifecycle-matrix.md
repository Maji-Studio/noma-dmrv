# Evidence lifecycle matrix

| Lifecycle case | Expected behavior | Result | Notes |
|---|---|---|---|
| Valid CSV chosen before parent exists | Hold locally, then upload/attach after run creation | **Verified** | `qa-c-upload.csv` appeared as a 165 B attached readings document after `PR-26-001` was created |
| CSV import for open run | Fail closed with clear end-time remediation | **Partial / P2** | Import failed correctly; precise reason appeared only after `Re-import` |
| CSV re-import after completing run | Import rows idempotently and clear failed state | **Blocked** | Completion save coincided with server loss; persistence could not be confirmed |
| Upload-stage classification | Distinguish validation, presign, PUT, confirm, attachment, import | **Partial** | Client validation and final UI attachment verified; in-app tooling did not expose a full request ledger, so presign/PUT/confirm were not separately claimed |
| Valid PDF evidence upload | Attach and satisfy its active evidence role | **Not attempted** | Server stopped before application evidence |
| Complete application fields, no evidence | Badge and removal gate both incomplete | **Blocked** | Direct #246 target not reached |
| Add evidence | Every mounted list/detail/readiness surface updates without reload | **Blocked** | #246 residual cache seam remains unverified |
| Remove/replace unmirrored parent evidence | Retire stale documents and stale ready state atomically | **Blocked** | PR #478 merged; no browser proof |
| Delete mirrored Isometric evidence | Fail closed with explanation | **Blocked** | No registry mapping created |
| Derived durability ledger becomes inapplicable | Retire stale source before submission | **Blocked** | PR #435 merged; no browser proof |

No PDF was transmitted and no document was deleted. The CSV remained attached to the isolated QA-C production run.
