import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { StorageError, type InspectedObject } from "./types";

/** Stop on the first byte beyond the cap; never retain the oversized chunk. */
export async function readBoundedStream(stream: Readable, maxBytes: number, contentType: string, signal?: AbortSignal): Promise<InspectedObject> {
  const abort = () => stream.destroy(Object.assign(new Error("Storage read aborted"), { name: "AbortError" }));
  signal?.addEventListener("abort", abort, { once: true });
  const chunks: Buffer[] = [];
  const hash = createHash("sha256");
  let sizeBytes = 0;
  try {
    if (signal?.aborted) abort();
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += bytes.length;
      if (sizeBytes > maxBytes) throw new StorageError("Stored object exceeds the size limit", "object_too_large");
      chunks.push(bytes);
      hash.update(bytes);
    }
    signal?.throwIfAborted();
    return { bytes: Buffer.concat(chunks, sizeBytes), sizeBytes, sha256: hash.digest("hex"), contentType };
  } finally {
    signal?.removeEventListener("abort", abort);
    stream.destroy();
  }
}
