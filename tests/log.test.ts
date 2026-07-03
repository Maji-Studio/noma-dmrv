/**
 * Unit tests for the in-house structured logger.
 *
 * Focus: the redaction backstop (no PII / secrets in log lines — CLAUDE.md) and
 * the pino-compatible call API (msg-only, obj+msg, child bindings). Level
 * filtering is fixed at import time from env and not exercised here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger, sanitizeErrorMessage } from "@/lib/log";

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

describe("sanitizeErrorMessage", () => {
  it("redacts the params section of a DrizzleQueryError message (newline form)", () => {
    // Real drizzle-orm format: `Failed query: <sql>\nparams: <values>`.
    const out = sanitizeErrorMessage(
      new Error(
        'Failed query: update "suppliers" set "contact_name" = $1\nparams: ["Fake Name","+15550100000"]',
      ),
    );
    expect(out).toContain('update "suppliers"');
    expect(out).toContain("params: [REDACTED]");
    expect(out).not.toContain("Fake Name");
    expect(out).not.toContain("+15550100000");
  });

  it("redacts the inline `-- params:` form some drivers emit", () => {
    const out = sanitizeErrorMessage(
      'insert into "customers" values ($1) -- params: ["12 Fake Street"]',
    );
    expect(out).toContain('insert into "customers"');
    expect(out).toContain("params: [REDACTED]");
    expect(out).not.toContain("Fake Street");
  });

  it("scrubs email-shaped text and truncates long messages", () => {
    const out = sanitizeErrorMessage(
      `notify fake@example.com about: ${"x".repeat(300)}`,
    );
    expect(out).not.toContain("fake@example.com");
    expect(out.length).toBeLessThanOrEqual(201); // 200 chars + ellipsis
  });
});
