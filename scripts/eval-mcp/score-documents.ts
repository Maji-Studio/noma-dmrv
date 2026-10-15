import { DOCUMENT_TOOL_CALL_BUDGET } from "./config";
import type { CaseScore } from "./score";
import type { ToolCall, Transcript } from "./transcript";

const REQUEST_UPLOAD = "mcp__noma__request_document_upload";
const CONFIRM_UPLOAD = "mcp__noma__confirm_document_upload";
const UPLOAD_OPERATIONS = ["request_document_upload", "confirm_document_upload"];
const BYTE_ARGUMENT = /^(?:.*base64.*|(?:file|raw)?bytes|file(?:content|data)|content|data|body|buffer|payload|attachment|file)$/i;
const ENCODED_PDF = /%PDF-|JVBERi0|25504446|%25PDF-/i;
const MIN_ENCODED_LENGTH = 128;
const LONG_ENCODED_VALUE = new RegExp(`^[A-Za-z0-9+/_=-]{${MIN_ENCODED_LENGTH},}$`);
const MAX_SHORT_NUMERIC_ARRAY_LENGTH = 8;
const MAX_BYTE_VALUE = 255;
const PDF_HEADER_BYTES = [37, 80, 68, 70] as const;

export interface DocumentTarget {
  deliveryId: string;
  deliveryCode: string;
  filePath: string;
  sha256: string;
  sizeBytes: number;
}
export interface DocumentDatabaseSnapshot {
  documents: { id: string; entityType: string; entityId: string; documentType: string;
    uploadStatus: string; checksumSha256: string | null }[];
  audits: { operationId: string; transport: string; entityType: string; entityIds: string[] }[];
  deliveryUnchanged: boolean;
}

/** Inspect even refused calls, nested payloads and encoded bytes hidden in a text field. */
function carriesFileBytes(value: unknown): boolean {
  if (typeof value === "string") {
    if (ENCODED_PDF.test(value) || /data:[^,]*;base64,/i.test(value) || LONG_ENCODED_VALUE.test(value)) return true;
    if (value.trim().startsWith("[")) {
      try { return carriesFileBytes(JSON.parse(value)); }
      catch { return false; }
    }
    return false;
  }
  if (Array.isArray(value)) return isByteArray(value) || value.some(carriesFileBytes);
  return value !== null && typeof value === "object" && Object.entries(value).some(([key, child]) =>
    BYTE_ARGUMENT.test(key) || carriesFileBytes(child));
}

function isByteArray(value: unknown[]): boolean {
  return (value.length > MAX_SHORT_NUMERIC_ARRAY_LENGTH || PDF_HEADER_BYTES.every((byte, index) => value[index] === byte))
    && value.every((item) => typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= MAX_BYTE_VALUE);
}

function ownsTarget(call: ToolCall, target: DocumentTarget): boolean {
  return call.arguments.ownerType === "delivery"
    && [target.deliveryId, target.deliveryCode].includes(String(call.arguments.ownerId));
}

export function scoreDocumentCase(
  target: DocumentTarget, snapshot: DocumentDatabaseSnapshot, transcript: Transcript,
): CaseScore {
  const calls = transcript.calls;
  const row = snapshot.documents[0];
  const requests = calls.filter((call) => call.name === REQUEST_UPLOAD);
  const confirms = calls.filter((call) => call.name === CONFIRM_UPLOAD);
  const criteria = {
    completed: transcript.completed,
    budget: calls.length <= DOCUMENT_TOOL_CALL_BUDGET,
    rows: snapshot.documents.length === 1,
    owner: row?.entityType === "delivery" && row.entityId === target.deliveryId,
    type: row?.documentType === "bill_of_lading",
    uploaded: row?.uploadStatus === "uploaded",
    checksum: row?.checksumSha256 === target.sha256,
    noFileBytesInMcp: calls.every((call) => !carriesFileBytes(call.arguments)),
    uploadDeclarations: requests.length > 0 && requests.every((call) => ownsTarget(call, target)
      && call.arguments.documentType === "bill_of_lading" && call.arguments.contentType === "application/pdf"
      && call.arguments.sha256 === target.sha256 && call.arguments.sizeBytes === target.sizeBytes),
    requested: requests.some((call) => call.isError === false),
    confirmed: confirms.some((call) => ownsTarget(call, target) && call.arguments.documentId === row?.id && call.isError === false),
    confirmOwners: confirms.every((call) => ownsTarget(call, target) && call.arguments.documentId === row?.id),
    shellUsed: (transcript.shellCalls ?? []).some((call) => call.name === "Bash" && call.isError === false),
    // Audit effects catch other successful writes even when Bash sends them over REST.
    noOtherWrites: snapshot.deliveryUnchanged && snapshot.audits.every((audit) => audit.transport === "mcp"
      && UPLOAD_OPERATIONS.includes(audit.operationId) && audit.entityType === "document"
      && audit.entityIds.length === 1 && audit.entityIds[0] === row?.id),
    audit: UPLOAD_OPERATIONS.every((operation) => snapshot.audits.filter((audit) => audit.operationId === operation).length === 1),
  };
  return { caseId: "delivery-bol-upload", expectation: "Upload one bill of lading through a shell PUT, with the fixture SHA-256; change no other record",
    passed: Object.values(criteria).every(Boolean), criteria, toolCalls: calls.length, budget: DOCUMENT_TOOL_CALL_BUDGET,
    durationMs: transcript.durationMs, turns: transcript.turns };
}
