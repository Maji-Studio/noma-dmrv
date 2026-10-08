import { API_BODY_MAX_BYTES, API_IDEMPOTENCY_KEY_MAX_LENGTH } from "@/config/api-rest";
import { ApiHttpError } from "./http-error";

export async function readJsonBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new ApiHttpError(415, "unsupported_media_type", "Use Content-Type: application/json.");
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
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new ApiHttpError(400, "malformed_json", "Send a valid JSON body.");
  }
}

export function readIdempotencyKey(request: Request, required: boolean): string | undefined {
  const key = request.headers.get("idempotency-key");
  if (key === null) {
    if (required) throw new ApiHttpError(400, "idempotency_key_required", "Send an Idempotency-Key for this create.");
    return undefined;
  }
  if (!key.length || key.length > API_IDEMPOTENCY_KEY_MAX_LENGTH || !/^[\x21-\x7e]+$/.test(key)) {
    throw new ApiHttpError(400, "idempotency_key_invalid", "Use 1 to 255 visible ASCII characters for Idempotency-Key.");
  }
  return key;
}
