// Deterministic supplier_reference_id for an Isometric Source mirrored from a
// noma `documents` row. One Source per noma document (enforced by the
// `(provider, document_id)` unique constraint on certifier_document_uploads),
// so the document UUID alone is enough — no version suffix needed.
//
// Isometric supplier_reference_id accepts up to 100 chars; `nm-src-{uuid}`
// is ~43, well under the cap, and the full UUID rules out collisions across
// the noma↔Isometric boundary.
export function buildSourceSupplierRef(documentId: string): string {
  return `nm-src-${documentId}`;
}
