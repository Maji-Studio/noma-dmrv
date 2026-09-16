import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({ env: {
  ISOMETRIC_CLIENT_SECRET: "audit-placeholder",
  ISOMETRIC_ACCESS_TOKEN: "audit-placeholder",
  ISOMETRIC_ENVIRONMENT: "sandbox",
} }));
vi.mock("@/lib/log", () => ({ logger: { child: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn() }) } }));
import { getIsometricClientFromEnv } from "@/lib/isometric/client";

const BEYOND_REQUEST_TIMEOUT_MS = 60_000;
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("baseline response-body timeout observation", () => {
  it("F05: successful headers clear the timer before a stalled body finishes", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    let finishBody: (text: string) => void = () => {};
    let settled = false;
    const body = new Promise<string>((resolve) => { finishBody = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      signal = options.signal;
      return { ok: true, status: 200, text: () => body };
    }));
    const pending = getIsometricClientFromEnv().get("/projects").finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(BEYOND_REQUEST_TIMEOUT_MS);
    expect(vi.getTimerCount()).toBe(0);
    expect(signal?.aborted).toBe(false);
    expect(settled).toBe(false);
    finishBody("{}");
    await pending;
  });
});
