import { ulid } from "ulid";

const SAFE_KEY_RE = /^[A-Za-z0-9._/-]+$/;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

export interface BuildStorageKeyArgs {
  entityType: string;
  entityId: string;
  documentType: string;
  fileName: string;
}

export function extractExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return "";
  const ext = fileName.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,12}$/.test(ext) ? ext : "";
}

export function buildStorageKey({
  entityType,
  entityId,
  documentType,
  fileName,
}: BuildStorageKeyArgs): string {
  for (const [name, value] of [
    ["entityType", entityType],
    ["entityId", entityId],
    ["documentType", documentType],
  ] as const) {
    if (!SAFE_SEGMENT_RE.test(value) || value.includes("..")) {
      throw new Error(`Invalid storage key segment ${name}`);
    }
  }
  const ext = extractExtension(fileName);
  const id = ulid().toLowerCase();
  return ext
    ? `${entityType}/${entityId}/${documentType}/${id}.${ext}`
    : `${entityType}/${entityId}/${documentType}/${id}`;
}

export function ghgStatementReportKeyPrefix(organizationId: string, reportId: string): string {
  assertSegments([organizationId, reportId]);
  return `org/${organizationId}/ghgStatementReport/${reportId}/pdf/`;
}

export function isSafeStorageKey(key: string): boolean {
  if (!SAFE_KEY_RE.test(key)) return false;
  if (key.startsWith("/") || key.includes("//") || key.includes("..")) return false;
  return true;
}

function assertSegments(values: string[]): void {
  if (values.some((value) => !SAFE_SEGMENT_RE.test(value) || value.includes(".."))) {
    throw new Error("Invalid storage key segment");
  }
}

export function buildUploadKey(args: { organizationId: string; documentId: string }): string {
  assertSegments([args.organizationId, args.documentId]);
  return `org/${args.organizationId}/uploads/${args.documentId}/${ulid().toLowerCase()}`;
}

export function isUploadKey(key: string): boolean {
  return isSafeStorageKey(key) && /^org\/[^/]+\/uploads\/[^/]+\/[^/]+$/.test(key);
}

export function buildFinalStorageKey(args: BuildStorageKeyArgs & { organizationId: string; documentId: string; sha256: string }): string {
  assertSegments([args.organizationId, args.entityType, args.entityId, args.documentType, args.documentId]);
  if (!/^[a-f0-9]{64}$/.test(args.sha256)) throw new Error("Invalid storage checksum");
  const ext = extractExtension(args.fileName);
  return `org/${args.organizationId}/${args.entityType}/${args.entityId}/${args.documentType}/${args.documentId}-${args.sha256}${ext ? `.${ext}` : ""}`;
}
