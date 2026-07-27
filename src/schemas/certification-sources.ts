import { z } from "zod";

// Max bytes a Phase 3.5 mirror will attempt. The flow reads the full document
// via `arrayBuffer()` on the server before PUT-ing to Isometric; streaming
// larger files is a follow-up tracked in
// docs/open-questions.md `isometric/sources-stream-large-files`.
export const SOURCES_MAX_BYTES = 50_000_000;

export const mirrorDocumentToSourceSchema = z.object({
  removalId: z.string().uuid(),
  documentId: z.string().uuid(),
});
export type MirrorDocumentToSourceInput = z.infer<
  typeof mirrorDocumentToSourceSchema
>;

export const loadCandidateDocumentsForRemovalSchema = z.object({
  removalId: z.string().uuid(),
});
export type LoadCandidateDocumentsForRemovalInput = z.infer<
  typeof loadCandidateDocumentsForRemovalSchema
>;
