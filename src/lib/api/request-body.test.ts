import { expect, it } from "vitest";
import { API_BODY_MAX_BYTES } from "@/config/api-rest";
import { readIdempotencyKey, readJsonBody } from "./request-body";

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
  for (const key of ["", "contains space", "x".repeat(256), "é"]) {
    expect(() => readIdempotencyKey(keyed(key), false)).toThrow(expect.objectContaining({ code: "idempotency_key_invalid" }));
  }
  expect(readIdempotencyKey(keyed("x".repeat(255)), true)).toHaveLength(255);
});
