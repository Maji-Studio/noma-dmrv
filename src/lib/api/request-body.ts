import { API_BODY_MAX_BYTES, API_IDEMPOTENCY_KEY_MAX_LENGTH } from "@/config/api-rest";
import { NUL_CHARACTER_MESSAGE } from "@/db/errors";
import { DomainError } from "@/lib/domain-errors";
import { ApiHttpError } from "./http-error";

export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]+$/;

const NUL_CHARACTER = "\u0000";

type JsonPath = { part: string | number; parent?: JsonPath };

/** JSON from a bounded body cannot contain cycles. Linked paths keep deep walks linear. */
export function rejectNulStrings(body: unknown): void {
  const pending: { value: unknown; path?: JsonPath }[] = [{ value: body }];
  while (pending.length) {
    const { value, path } = pending.pop()!;
    if ((typeof path?.part === "string" && path.part.includes(NUL_CHARACTER))
      || (typeof value === "string" && value.includes(NUL_CHARACTER))) {
      const parts: (string | number)[] = [];
      for (let segment = path; segment; segment = segment.parent) parts.push(segment.part);
      throw new DomainError("validation_failed", NUL_CHARACTER_MESSAGE, {
        issues: [{ path: parts.reverse(), code: "custom", message: NUL_CHARACTER_MESSAGE }],
      });
    }
    if (value === null || typeof value !== "object") continue;
    // Reverse the stack insertion order to visit each property's key and value in order.
    for (const [key, child] of Object.entries(value).reverse()) {
      pending.push({ value: child, path: { part: Array.isArray(value) ? Number(key) : key, parent: path } });
    }
  }
}

/** Read at most the shared JSON body limit, including requests without a length. */
export async function readBoundedBody(request: Request): Promise<Buffer<ArrayBuffer>> {
  if (Number(request.headers.get("content-length")) > API_BODY_MAX_BYTES) {
    await request.body?.cancel();
    throw new ApiHttpError(413, "payload_too_large", "The JSON body exceeds the size limit.");
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > API_BODY_MAX_BYTES) {
          await reader.cancel();
          throw new ApiHttpError(413, "payload_too_large", "The JSON body exceeds the size limit.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  return Buffer.concat(chunks);
}

function requireJsonMediaType(request: Request): void {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new ApiHttpError(415, "unsupported_media_type", "Use Content-Type: application/json.");
  }
}

function parseJsonBytes(bytes: Uint8Array): unknown {
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiHttpError(400, "malformed_json", "Send a valid JSON body.");
  }
  rejectNulStrings(body);
  return body;
}

export async function readJsonBody(request: Request): Promise<unknown> {
  requireJsonMediaType(request);
  return parseJsonBytes(await readBoundedBody(request));
}

/** A non-null stream can be empty. Inspect bounded bytes rather than framing headers. */
export async function readOptionalJsonBody(request: Request): Promise<unknown> {
  const bytes = await readBoundedBody(request);
  if (bytes.byteLength === 0) return undefined;
  requireJsonMediaType(request);
  return parseJsonBytes(bytes);
}

export function readIdempotencyKey(request: Request, required: boolean): string | undefined {
  const key = request.headers.get("idempotency-key");
  if (key === null) {
    if (required) throw new ApiHttpError(400, "idempotency_key_required", "Send an Idempotency-Key for this create.");
    return undefined;
  }
  if (!key.length || key.length > API_IDEMPOTENCY_KEY_MAX_LENGTH || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new ApiHttpError(400, "idempotency_key_invalid", `Use 1 to ${API_IDEMPOTENCY_KEY_MAX_LENGTH} visible ASCII characters for Idempotency-Key.`);
  }
  return key;
}
