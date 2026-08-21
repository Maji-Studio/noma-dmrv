import { StorageError } from "./types";
import type { StoredObject } from "./types";

export const STORAGE_GET_OBJECT_TIMEOUT_MS = 30_000;
const BINARY_CONTENT_TYPE = "application/octet-stream";

export async function fetchStoredObject(url: string): Promise<StoredObject> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    STORAGE_GET_OBJECT_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new StorageError(
        `Stored object read failed with status ${response.status}`,
        "get_object_failed",
      );
    }
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType:
        response.headers.get("content-type") ?? BINARY_CONTENT_TYPE,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new StorageError(
        "Stored object read timed out",
        "get_object_timeout",
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
