import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WALKTHROUGH_FIELD_LIMITS, WALKTHROUGH_MAX_BODY_BYTES, WALKTHROUGH_RATE_LIMIT } from "@/config/walkthrough";
import { clientIpBucketKey } from "@/lib/api/client-ip";

const mocks = vi.hoisted(() => ({
  env: {
    NODE_ENV: "test",
    NEXT_PUBLIC_APP_URL: "https://app.example.test",
    RESEND_API_KEY: "synthetic" as string | undefined,
    RESEND_FROM_EMAIL: "sender@example.test" as string | undefined,
    WALKTHROUGH_TO: "inbox@example.test" as string | undefined,
  },
  consume: vi.fn(), send: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
}));
vi.mock("@/config/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/env")>()),
  env: mocks.env,
}));
vi.mock("@/data-access/api-rate-limits", () => ({ consumeRateLimit: mocks.consume }));
vi.mock("@/lib/email/send", () => ({ sendEmail: mocks.send }));
vi.mock("@/lib/log", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

import { OPTIONS, POST } from "./route";

const ORIGIN = "https://noma.maji.studio";
const URL = "https://app.example.test/api/walkthrough";
const INPUT = {
  name: "Private <Visitor> & \"Name\"",
  email: "visitor@example.test",
  company: "Private <Company> & 'Partners'",
  size: "10 < 20",
  message: "Private <script>alert('hello')</script> & details",
  website: "",
};
const ADMITTED = { allowed: true, limit: 5, remaining: 4, resetSeconds: 720, retryAfterSeconds: 0 };

function request(body: unknown = INPUT, origin: string | null = ORIGIN) {
  return rawRequest(JSON.stringify(body), origin);
}

function rawRequest(body: string, origin: string | null = ORIGIN, extraHeaders: Record<string, string> = {}) {
  return new Request(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(origin === null ? {} : { Origin: origin }), ...extraHeaders },
    body,
  });
}

async function expectJson(response: Response, status: number, body: object, origin = ORIGIN) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  expect(response.headers.get("Vary")).toBe("Origin");
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("X-Request-Id")).toBeTruthy();
  expect(await response.json()).toEqual(body);
}

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(mocks.env, {
    NODE_ENV: "test", RESEND_API_KEY: "synthetic", RESEND_FROM_EMAIL: "sender@example.test",
    WALKTHROUGH_TO: "inbox@example.test",
  });
  mocks.consume.mockResolvedValue(ADMITTED);
  mocks.send.mockResolvedValue({ sent: true, id: "email-123" });
});

afterEach(() => {
  const logs = JSON.stringify([mocks.info.mock.calls, mocks.warn.mock.calls, mocks.error.mock.calls]);
  for (const value of [INPUT.name, INPUT.email, INPUT.company, INPUT.message, "inbox@example.test"]) {
    expect(logs).not.toContain(value);
  }
});

it.each([
  "https://noma.maji.studio", "https://staging.noma.maji.studio",
  "https://noma-site-abc123-maji-studio.vercel.app",
  "https://noma-site-git-feature-branch-maji-studio.vercel.app",
])("allows production site origin %s", async origin => {
  mocks.env.NODE_ENV = "production";
  await expectJson(await POST(request(INPUT, origin)), 200, { ok: true }, origin);
  expect(mocks.send).toHaveBeenCalledOnce();
});

it.each(["http://localhost:3120", "http://127.0.0.1:3120"])("allows local origin %s only outside production", async origin => {
  await expectJson(await POST(request(INPUT, origin)), 200, { ok: true }, origin);
  mocks.env.NODE_ENV = "production";
  const response = await POST(request(INPUT, origin));
  expect(response.status).toBe(403);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  expect(mocks.consume).toHaveBeenCalledOnce();
});

it.each([
  null, "null", "https://attacker.example.test", "https://noma.maji.studio.attacker.test",
  "http://noma.maji.studio", "https://noma-site-abc-maji-studio.vercel.app.attacker.test",
  "https://other-project-abc-maji-studio.vercel.app", "https://noma-site-ABC-maji-studio.vercel.app",
  "http://localhost:3121",
])("refuses missing or disallowed origin %s before admission for both methods", async origin => {
  for (const handler of [POST, OPTIONS]) {
    const response = await handler(request(INPUT, origin));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect([...response.headers.keys()].filter(key => key.startsWith("access-control-"))).toEqual([]);
  }
  expect(mocks.consume).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});

it("answers preflight without admission or mail", async () => {
  const response = await OPTIONS(new Request(URL, { method: "OPTIONS", headers: {
    Origin: ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type",
  } }));
  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  expect(response.headers.get("Vary")).toBe("Origin");
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
  expect(response.headers.get("Access-Control-Max-Age")).toBe("600");
  expect(mocks.consume).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});

it("charges the configured hashed-IP bucket even for invalid JSON", async () => {
  const received = rawRequest("not JSON");
  await expectJson(await POST(received), 400, { error: "invalid", fields: [] });
  expect(mocks.consume).toHaveBeenCalledExactlyOnceWith({
    key: `walkthrough:${clientIpBucketKey(received.headers)}`, ...WALKTHROUGH_RATE_LIMIT,
  });
  expect(mocks.send).not.toHaveBeenCalled();
});

it("rate-limits before inspecting the body", async () => {
  mocks.consume.mockResolvedValue({ ...ADMITTED, allowed: false, remaining: 0, retryAfterSeconds: 720 });
  const received = rawRequest("not JSON");
  const response = await POST(received);
  await expectJson(response, 429, { error: "rate_limited" });
  expect(response.headers.get("Retry-After")).toBe("720");
  expect(received.bodyUsed).toBe(false);
  expect(mocks.send).not.toHaveBeenCalled();
});

it.each([undefined, "1"])("caps actual UTF-8 body bytes with Content-Length %s", async length => {
  const received = rawRequest("é".repeat(WALKTHROUGH_MAX_BODY_BYTES), ORIGIN,
    length === undefined ? {} : { "Content-Length": length });
  await expectJson(await POST(received), 413, { error: "too_large" });
  expect(mocks.consume).toHaveBeenCalledOnce();
  expect(mocks.send).not.toHaveBeenCalled();
});

it("refuses an oversized declared length before reading the body", async () => {
  const received = rawRequest(JSON.stringify(INPUT), ORIGIN, { "Content-Length": String(WALKTHROUGH_MAX_BODY_BYTES + 1) });
  await expectJson(await POST(received), 413, { error: "too_large" });
  expect(received.bodyUsed).toBe(false);
  expect(mocks.send).not.toHaveBeenCalled();
});

it("cancels a streaming body as soon as it exceeds the byte cap", async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(WALKTHROUGH_MAX_BODY_BYTES)); },
    cancel,
  });
  const init: RequestInit & { duplex: "half" } = {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: stream, duplex: "half",
  };
  await expectJson(await POST(new Request(URL, init)), 413, { error: "too_large" });
  expect(cancel).toHaveBeenCalledOnce();
  expect(mocks.send).not.toHaveBeenCalled();
});

it("accepts a body exactly at the byte cap", async () => {
  const raw = JSON.stringify(INPUT);
  const padding = WALKTHROUGH_MAX_BODY_BYTES - new TextEncoder().encode(raw).byteLength;
  await expectJson(await POST(rawRequest(raw + " ".repeat(padding))), 200, { ok: true });
});

it.each([
  { body: null, fields: [] },
  { body: [], fields: [] },
  { body: { ...INPUT, name: "  ", email: "private-invalid-address", company: "", size: " " }, fields: ["name", "email", "company", "size"] },
  { body: { ...INPUT, message: null }, fields: ["message"] },
  { body: { ...INPUT, website: true }, fields: ["website"] },
])("returns field names only for an invalid body: $fields", async ({ body, fields }) => {
  await expectJson(await POST(request(body)), 400, { error: "invalid", fields });
  expect(mocks.consume).toHaveBeenCalledOnce();
  expect(mocks.send).not.toHaveBeenCalled();
});

it.each(["name", "company", "size", "message"] as const)("enforces the %s field cap", async field => {
  await expectJson(await POST(request({ ...INPUT, [field]: "x".repeat(WALKTHROUGH_FIELD_LIMITS[field] + 1) })),
    400, { error: "invalid", fields: [field] });
  expect(mocks.send).not.toHaveBeenCalled();
});

it("silently accepts a honeypot without needing mail configuration", async () => {
  mocks.env.WALKTHROUGH_TO = undefined;
  await expectJson(await POST(request({ ...INPUT, website: "https://bot.example.test" })), 200, { ok: true });
  expect(mocks.consume).toHaveBeenCalledOnce();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.warn).not.toHaveBeenCalled();
});

it.each(["RESEND_API_KEY", "RESEND_FROM_EMAIL", "WALKTHROUGH_TO"] as const)("fails safely without %s", async key => {
  mocks.env[key] = undefined;
  await expectJson(await POST(request()), 503, { error: "unavailable" });
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.warn).toHaveBeenCalledWith({ requestId: expect.any(String), outcome: "not_configured" }, "walkthrough request");
});

it("fails closed if admission fails, without reading or logging the raw error", async () => {
  mocks.consume.mockRejectedValue(new Error(INPUT.email));
  const received = request();
  await expectJson(await POST(received), 503, { error: "unavailable" });
  expect(received.bodyUsed).toBe(false);
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.warn).toHaveBeenCalledOnce();
});

it("returns send_failed on a provider refusal", async () => {
  mocks.send.mockResolvedValue({ sent: false, reason: "provider-error" });
  await expectJson(await POST(request()), 502, { error: "send_failed" });
});

it("returns send_failed for an unexpected sender exception without exposing PII", async () => {
  mocks.send.mockRejectedValue(new Error(INPUT.email));
  await expectJson(await POST(request()), 502, { error: "send_failed" });
});

it("handles an unconfigured result from the shared sender", async () => {
  mocks.send.mockResolvedValue({ sent: false, reason: "not-configured" });
  await expectJson(await POST(request()), 503, { error: "unavailable" });
  expect(mocks.warn).toHaveBeenCalledOnce();
});

it("sends one escaped HTML email and its text twin to the inbox with the visitor as reply-to", async () => {
  const response = await POST(request());
  await expectJson(response, 200, { ok: true });
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith({
    type: "walkthrough-request", to: "inbox@example.test", replyTo: INPUT.email,
    subject: `Walkthrough request: ${INPUT.company}`, html: expect.any(String), text: expect.any(String),
  });
  const email = mocks.send.mock.calls[0][0];
  for (const escaped of [
    "Private &lt;Visitor&gt; &amp; &quot;Name&quot;", "visitor@example.test",
    "Private &lt;Company&gt; &amp; &#39;Partners&#39;", "10 &lt; 20",
    "Private &lt;script&gt;alert(&#39;hello&#39;)&lt;/script&gt; &amp; details",
  ]) expect(email.html).toContain(escaped);
  expect(email.html).not.toContain("<script>");
  for (const value of [INPUT.name, INPUT.email, INPUT.company, INPUT.size, INPUT.message]) expect(email.text).toContain(value);
  expect(mocks.info).toHaveBeenCalledWith({
    requestId: response.headers.get("X-Request-Id"), outcome: "sent", emailId: "email-123",
  }, "walkthrough request");
});

it("trims fields, omits empty messages and removes CR/LF from the subject", async () => {
  await expectJson(await POST(request({
    ...INPUT, name: "  Visitor  ", company: "  Company\r\nBcc: nope  ", size: "  Small  ",
    message: " \n ", website: undefined,
  })), 200, { ok: true });
  const email = mocks.send.mock.calls[0][0];
  expect(email.subject).toBe("Walkthrough request: CompanyBcc: nope");
  expect(email.text).toContain("Name: Visitor\n");
  expect(email.text).toContain("Size: Small\n");
  expect(email.text).toContain("Message: Not provided");
  expect(email.text).not.toContain("Website");
});
