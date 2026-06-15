import { describe, it } from "vitest";

/**
 * Negative authorization tests for document access — INTENTIONALLY UNIMPLEMENTED.
 *
 * Today document data-access (`src/data-access/documents.ts`) authorizes by
 * `requireAuth(userId)` only: `getDocumentById`, `updateDocument`,
 * `setDocumentVisibility`, and `assertCanManageDocumentEntity` prove the row /
 * owning entity *exists* but never scope it to a facility or permission boundary
 * for the caller. That is an accepted, documented gap while the app is
 * single-tenant (see docs/open-questions.md → "Document access is authorized by
 * UUID only"), NOT a bug to fix in isolation — every data-access function shares
 * the `requireAuth`-only pattern (0 uses of `requireProjectMember`).
 *
 * These `it.todo` cases pin the contract we must satisfy the moment any
 * non-fully-trusted account can exist (external auditor, customer, limited
 * reviewer) — i.e. when per-facility/entity scoping lands with the multi-tenancy
 * work (ADR 0010). Implement them against the scoped authorization helper then;
 * do not convert them to passing tests against the current `requireAuth`-only
 * behavior, which would lock in the gap.
 */
describe("document authorization (pending ADR-0010 facility/entity scoping)", () => {
  it.todo(
    "denies getDocumentById for a private document whose owning entity the caller cannot access",
  );

  it.todo(
    "denies the /api/documents/[id] presigned-download redirect for a private document outside the caller's scope",
  );

  it.todo(
    "denies setDocumentVisibility when the caller cannot access the document's owning (entityType, entityId)",
  );

  it.todo(
    "denies assertCanManageDocumentEntity for an entity the caller does not have access to",
  );
});
