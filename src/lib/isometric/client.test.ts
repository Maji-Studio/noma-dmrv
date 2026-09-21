import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({
  env: {
    ISOMETRIC_CLIENT_SECRET: "test-secret",
    ISOMETRIC_ACCESS_TOKEN: "test-token",
    ISOMETRIC_ENVIRONMENT: "sandbox",
  },
}));
vi.mock("@/lib/log", () => ({
  logger: { child: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
import { getIsometricClientFromEnv, IsometricApiError } from "./client";

const DEADLINE_MS = 30_000;
const fetchMock = vi.fn<typeof fetch>();
const client = getIsometricClientFromEnv();

// Fetch resolves when headers arrive, but the stream rejects on abort just
// like a real fetch Response. No registry requests leave this test process.
function stalledResponse(status: number) {
  fetchMock.mockImplementation(async (_url, init) => {
    const signal = init!.signal!;
    return new Response(new ReadableStream({
      start(controller) {
        signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      },
    }), { status });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("registry response body deadline", () => {
  it.each([200, 400, 503])("times out a stalled %i body without replaying POST", async (status) => {
    stalledResponse(status);
    const external = new AbortController();
    const remove = vi.spyOn(external.signal, "removeEventListener");
    const outcome = client.post("/test", {}, { signal: external.signal }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(DEADLINE_MS - 1);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({ name: "IsometricApiError", code: "network", message: expect.stringContaining("timed out") });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([200, 400, 503])("propagates external abort during a %i body without retry", async (status) => {
    stalledResponse(status);
    const external = new AbortController();
    const reason = new Error("operator cancelled");
    const remove = vi.spyOn(external.signal, "removeEventListener");
    const outcome = client.get("/test", { signal: external.signal }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1);
    external.abort(reason);
    expect(await outcome).toBe(reason);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves a non-retryable HTTP status when its error body fails", async () => {
    fetchMock.mockImplementation(async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error("response stream failed")); },
    }), { status: 400 }));
    const outcome = client.get("/test").catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ code: "http", status: 400, body: "" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["GET", "POST"] as const)("does not replay accepted %s when its body fails", async (method) => {
    fetchMock.mockImplementation(async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error("response stream failed")); },
    }), { status: 200 }));
    const outcome = (method === "GET"
      ? client.get("/test")
      : client.post("/test", {}, { allowUnsafeRetries: true }))
      .catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ code: "network", status: 200 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not replay a timed-out PATCH", async () => {
    stalledResponse(200);
    const outcome = client.patch("/test", {}).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await outcome).toBeInstanceOf(IsometricApiError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retains bounded retries for idempotent reads with stalled bodies", async () => {
    stalledResponse(503);
    const outcome = client.get("/test").catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ code: "network" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([200, 204, 400, 503])("cleans up after a completed %i response", async (status) => {
    fetchMock.mockResolvedValue(new Response(status === 204 ? null : '{"result":"test"}', { status }));
    const external = new AbortController();
    const add = vi.spyOn(external.signal, "addEventListener");
    const remove = vi.spyOn(external.signal, "removeEventListener");
    const result = await client.post("/test", {}, { signal: external.signal }).catch((error: unknown) => error);
    if (status === 200) expect(result).toEqual({ result: "test" });
    else if (status === 204) expect(result).toBeUndefined();
    else expect(result).toMatchObject({ status, code: "http", body: { result: "test" } });
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up malformed JSON and preserves its HTTP error", async () => {
    fetchMock.mockResolvedValue(new Response("invalid", { status: 200 }));
    await expect(client.get("/test")).rejects.toMatchObject({ code: "http", status: 200, body: "invalid" });
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retains Retry-After reads and explicitly opted-in unsafe retries", async () => {
    fetchMock.mockResolvedValueOnce(new Response("busy", { status: 503, headers: { "retry-after": "1" } }))
      .mockResolvedValueOnce(new Response('{"ok":true}'));
    const outcome = client.post("/test", {}, { allowUnsafeRetries: true });
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])("cleans retry-wait listeners, cancelled=%s", async (cancelled) => {
    fetchMock.mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(new Response('{"ok":true}'));
    vi.mocked(Math.random).mockReturnValue(1);
    const external = new AbortController();
    const add = vi.spyOn(external.signal, "addEventListener");
    const remove = vi.spyOn(external.signal, "removeEventListener");
    const reason = new Error("cancelled during backoff");
    const outcome = client.get("/test", { signal: external.signal }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1);
    if (cancelled) external.abort(reason);
    else await vi.runAllTimersAsync();
    expect(await outcome).toEqual(cancelled ? reason : { ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(cancelled ? 1 : 2);
    for (const [event, listener] of add.mock.calls) {
      expect(remove).toHaveBeenCalledWith(event, listener);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up fetch failure and rejects an already aborted request", async () => {
    fetchMock.mockRejectedValue(new Error("network unavailable"));
    await expect(client.post("/test", {})).rejects.toMatchObject({ code: "network" });
    expect(vi.getTimerCount()).toBe(0);
    const external = new AbortController();
    const reason = new Error("cancelled before request");
    external.abort(reason);
    await expect(client.get("/test", { signal: external.signal })).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
