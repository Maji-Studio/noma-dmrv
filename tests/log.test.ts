/**
 * Unit tests for the in-house structured logger.
 *
 * Focus: the redaction backstop (no PII / secrets in log lines — CLAUDE.md) and
 * the pino-compatible call API (msg-only, obj+msg, child bindings). Level
 * filtering is fixed at import time from env and not exercised here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/log";

function lastLogRecord(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const call = spy.mock.calls.at(-1);
  if (!call) throw new Error("expected a log line");
  return JSON.parse(call[0] as string) as Record<string, unknown>;
}

describe("logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits structured JSON with level, time, and message", () => {
    logger.info({ removalId: "rmv_1" }, "removal submit started");
    const rec = lastLogRecord(logSpy);
    expect(rec.level).toBe("info");
    expect(rec.msg).toBe("removal submit started");
    expect(rec.removalId).toBe("rmv_1");
    expect(typeof rec.time).toBe("string");
  });

  it("supports the message-only call form", () => {
    logger.info("plain message");
    expect(lastLogRecord(logSpy).msg).toBe("plain message");
  });

  it("routes error/fatal to stderr (console.error)", () => {
    logger.error({ status: 500 }, "boom");
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(lastLogRecord(errSpy).status).toBe(500);
  });

  it("redacts secret/PII keys case-insensitively at any depth", () => {
    logger.info(
      {
        email: "a@b.com",
        Authorization: "Bearer xyz",
        headers: { "X-Client-Secret": "shh", op: "keep" },
        nested: [{ accessToken: "t" }],
        removalId: "rmv_1",
      },
      "with secrets",
    );
    const rec = lastLogRecord(logSpy);
    expect(rec.email).toBe("[REDACTED]");
    expect(rec.Authorization).toBe("[REDACTED]");
    expect((rec.headers as Record<string, unknown>)["X-Client-Secret"]).toBe(
      "[REDACTED]",
    );
    expect((rec.headers as Record<string, unknown>).op).toBe("keep");
    expect((rec.nested as Array<Record<string, unknown>>)[0].accessToken).toBe(
      "[REDACTED]",
    );
    expect(rec.removalId).toBe("rmv_1"); // non-secret IDs pass through
  });

  it("child() merges bindings into every record", () => {
    const child = logger.child({ op: "removal:submit", submissionAttemptId: "att_1" });
    child.warn({ extra: 1 }, "child line");
    const rec = lastLogRecord(logSpy);
    expect(rec.op).toBe("removal:submit");
    expect(rec.submissionAttemptId).toBe("att_1");
    expect(rec.extra).toBe(1);
  });
});
