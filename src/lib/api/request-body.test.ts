import { expect, it, vi } from "vitest";
import { API_BODY_MAX_BYTES, API_IDEMPOTENCY_KEY_MAX_LENGTH } from "@/config/api-rest";
import { readIdempotencyKey, readJsonBody, readOptionalJsonBody } from "./request-body";

const request = (body: string, contentType = "application/json") => new Request("https://example.test", {
  method: "POST", headers: { "content-type": contentType }, body,
});
it("accepts JSON with a charset", async () => {
  expect(await readJsonBody(request('{"massWetKg":0}', "Application/JSON; charset=utf-8"))).toEqual({ massWetKg: 0 });
});
it("refuses media type and malformed JSON", async () => {
  await expect(readJsonBody(request("{}", "text/plain"))).rejects.toMatchObject({ status: 415 });
  await expect(readJsonBody(request("{"))).rejects.toMatchObject({ status: 400, code: "malformed_json" });
});
it("caps streamed bytes without trusting Content-Length, and cancels the stream", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(API_BODY_MAX_BYTES / 2 + 1)); },
    cancel() { cancelled = true; },
  });
  const streamed = new Request("https://example.test", {
    method: "POST", headers: { "content-type": "application/json", "content-length": "1" }, body: stream, duplex: "half",
  } as RequestInit);
  await expect(readJsonBody(streamed)).rejects.toMatchObject({ status: 413 });
  expect(cancelled).toBe(true);
});
it("allows the exact body limit", async () => {
  expect(await readJsonBody(request('"' + "x".repeat(API_BODY_MAX_BYTES - 2) + '"'))).toHaveLength(API_BODY_MAX_BYTES - 2);
});
it("requires keys only when requested and validates visible ASCII length", () => {
  const keyed = (key?: string) => new Request("https://example.test", { headers: key === undefined ? {} : { "idempotency-key": key } });
  expect(readIdempotencyKey(keyed(), false)).toBeUndefined();
  expect(() => readIdempotencyKey(keyed(), true)).toThrow(expect.objectContaining({ code: "idempotency_key_required" }));
  for (const key of ["", "contains space", "x".repeat(API_IDEMPOTENCY_KEY_MAX_LENGTH + 1), "é"]) {
    expect(() => readIdempotencyKey(keyed(key), false)).toThrow(expect.objectContaining({ code: "idempotency_key_invalid" }));
  }
  expect(readIdempotencyKey(keyed("x".repeat(API_IDEMPOTENCY_KEY_MAX_LENGTH)), true)).toHaveLength(API_IDEMPOTENCY_KEY_MAX_LENGTH);
});


it("refuses an oversized declared length without reading and cancels the body", async () => {
  const pull = vi.fn();
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
  const oversized = new Request("https://example.test", {
    method: "POST", headers: { "content-type": "application/json", "content-length": String(API_BODY_MAX_BYTES + 1) },
    body: stream, duplex: "half",
  } as RequestInit);
  await expect(readJsonBody(oversized)).rejects.toMatchObject({ status: 413, code: "payload_too_large" });
  expect(pull).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledOnce();
});

it.each([undefined, "", new ReadableStream({ start(controller) { controller.close(); } })])(
  "treats zero bytes as an absent optional body regardless of media type (%s)", async (body) => {
    const framing: Record<string, string>[] = [{}, { "content-type": "text/plain", "content-length": "0" }, { "transfer-encoding": "chunked" }];
    for (const headers of framing) {
      // Each stream is read only once; clone the already empty stream for each framing case.
      const value = body instanceof ReadableStream ? new ReadableStream({ start(controller) { controller.close(); } }) : body;
      const empty = new Request("https://example.test", { method: "DELETE", headers, body: value, duplex: "half" } as RequestInit);
      expect(await readOptionalJsonBody(empty)).toBeUndefined();
    }
  },
);

it("validates actual non-empty bytes even when Content-Length claims zero", async () => {
  const body = new Request("https://example.test", {
    method: "DELETE", headers: { "content-length": "0" }, body: "{}",
  });
  await expect(readOptionalJsonBody(body)).rejects.toMatchObject({ status: 415, code: "unsupported_media_type" });
});

it("parses optional JSON and preserves null for the caller's validation", async () => {
  expect(await readOptionalJsonBody(request("{}"))).toEqual({});
  expect(await readOptionalJsonBody(request("null"))).toBeNull();
  for (const body of [" ", "{"]) {
    await expect(readOptionalJsonBody(request(body))).rejects.toMatchObject({ status: 400, code: "malformed_json" });
  }
  await expect(readOptionalJsonBody(request(" ", "text/plain"))).rejects.toMatchObject({ status: 415 });
});

it("bounds an optional stream without Content-Type and cancels on overflow", async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(API_BODY_MAX_BYTES + 1)); }, cancel,
  });
  const body = new Request("https://example.test", { method: "DELETE", body: stream, duplex: "half" } as RequestInit);
  await expect(readOptionalJsonBody(body)).rejects.toMatchObject({ status: 413, code: "payload_too_large" });
  expect(cancel).toHaveBeenCalledOnce();
});
