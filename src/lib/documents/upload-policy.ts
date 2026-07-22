import { BYTES_PER_MB } from "@/lib/format-utils";

/**
 * Maximum size of the final file sent through the document upload pipeline.
 *
 * Keep this policy independent from any future preprocessing step (for example,
 * image reduction with Sharp): preprocessing should produce the final upload
 * artifact first, then this limit applies to those resulting bytes.
 */
export const DOCUMENT_UPLOAD_MAX_MB = 10;
export const DOCUMENT_UPLOAD_MAX_BYTES =
  DOCUMENT_UPLOAD_MAX_MB * BYTES_PER_MB;

export function clampDocumentUploadMaxMb(requestedMaxMb: number): number {
  return Math.min(requestedMaxMb, DOCUMENT_UPLOAD_MAX_MB);
}
