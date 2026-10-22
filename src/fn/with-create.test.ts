import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import type { OrgContext } from "@/lib/auth/server";
import type { Operation } from "@/lib/operations/runner";
import { SafeError } from "@/lib/errors";
import { createIntentOptionsSchema } from "@/schemas/create-intent";
import { parseCreateIntentKey, withCreate } from "./with-create";

const { auth, run, log, rateLimit } = vi.hoisted(() => ({
  auth: vi.fn(), run: vi.fn(), log: vi.fn(), rateLimit: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: auth }));
vi.mock("@/lib/operations/runner", () => ({ runOperationInProcess: run }));
vi.mock("@/lib/log", () => ({ logger: { error: log }, sanitizeErrorMessage: () => "error" }));
vi.mock("@/lib/rate-limit/in-memory", () => ({ checkRateLimit: rateLimit }));

const ID = "11111111-1111-4111-8111-111111111111";
const ctx: OrgContext = { userId: ID, organizationId: ID, orgRole: "admin", isPlatformAdmin: false };
const inputSchema = z.object({ value: z.string() });
const operation: Operation<typeof inputSchema, { id: string }> = {
  id: "test_create", input: inputSchema, supportsDryRun: false, execute: async () => ({ id: ID }),
};
const input = { value: "draft" };

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue(ctx);
  run.mockResolvedValue({ id: ID });
  rateLimit.mockReturnValue({ allowed: true });
});

it("validates payload before parsing intent or running the write", async () => {
  const parse = vi.spyOn(createIntentOptionsSchema, "parse");
  const result = await withCreate(async (_ctx, create) => {
    const validated = inputSchema.parse({ value: null });
    return create(operation, validated);
  }, { intentKey: "invalid" });
  expect(result).toMatchObject({ success: false, code: "validation_failed", issues: [{ path: ["value"] }] });
  expect(parse).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

it("does not parse an unused intent", async () => {
  const parse = vi.spyOn(createIntentOptionsSchema, "parse");
  expect(await withCreate(async () => "no write", { intentKey: "invalid" }))
    .toEqual({ success: true, data: "no write" });
  expect(parse).not.toHaveBeenCalled();
});

it.each([{ intentKey: ID }, undefined, {}])("forwards parsed intent unchanged: %j", async (intent) => {
  const parse = vi.spyOn(createIntentOptionsSchema, "parse");
  expect(await withCreate(async (context, create) => {
    expect(context).toBe(ctx);
    return create(operation, input);
  }, intent)).toEqual({ success: true, data: { id: ID } });
  expect(parse).toHaveBeenCalledExactlyOnceWith(intent);
  expect(run).toHaveBeenCalledExactlyOnceWith(operation, ctx, input, parse.mock.results[0].value);
});

it("rejects malformed intent before calling the runner", async () => {
  expect(await withCreate((_ctx, create) => create(operation, input), { intentKey: "invalid" }))
    .toMatchObject({ success: false, code: "validation_failed" });
  expect(run).not.toHaveBeenCalled();
});

it("refuses a second create even while the first is pending", async () => {
  expect(await withCreate(async (_ctx, create) => {
    const first = create(operation, input);
    await expect(create(operation, input)).rejects.toThrow("only one operation");
    return first;
  }, undefined)).toEqual({ success: true, data: { id: ID } });
  expect(run).toHaveBeenCalledTimes(1);
});

it.each([{ intentKey: ID }, undefined])("reads create.key lazily and parses only once: %j", async (intent) => {
  const parse = vi.spyOn(createIntentOptionsSchema, "parse");
  expect(await withCreate(async (_ctx, create) => {
    inputSchema.parse(input);
    expect(parse).not.toHaveBeenCalled();
    expect(create.key).toBe(intent?.intentKey);
    return create.key;
  }, intent)).toEqual({ success: true, data: intent?.intentKey });
  expect(parse).toHaveBeenCalledExactlyOnceWith(intent);
  expect(run).not.toHaveBeenCalled();
});

it("validates malformed create.key on its first read", async () => {
  expect(await withCreate(async (_ctx, create) => create.key, { intentKey: "invalid" }))
    .toMatchObject({ success: false, code: "validation_failed" });
});

it("forwards fallbackMessage and log to withAction", async () => {
  const result = await withCreate(async () => { throw new Error("internal"); }, undefined, {
    fallbackMessage: "Create failed", log: { message: "create failed", context: { op: "test:create" } },
  });
  expect(result).toEqual({ success: false, error: "Create failed" });
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ op: "test:create" }), "create failed");
});

it("forwards mapError and preserves its result", async () => {
  const error = new SafeError("Already exists");
  const failure = { success: false as const, error: error.message, field: "value" };
  const mapError = vi.fn(() => failure);
  expect(await withCreate(async () => { throw error; }, undefined, { mapError })).toBe(failure);
  expect(mapError).toHaveBeenCalledExactlyOnceWith(error);
  expect(log).not.toHaveBeenCalled();
});

it("forwards rateLimit before invoking the callback", async () => {
  rateLimit.mockReturnValue({ allowed: false, retryAfterSeconds: 1 });
  const callback = vi.fn();
  const limit = { key: "test:create", max: 1, windowMs: 1000 };
  expect(await withCreate(callback, undefined, { rateLimit: limit })).toMatchObject({ success: false });
  expect(rateLimit).toHaveBeenCalledExactlyOnceWith({ ...limit, key: `test:create:${ID}` });
  expect(callback).not.toHaveBeenCalled();
});

it("shares the parsed intent between key reads and the runner", async () => {
  const parse = vi.spyOn(createIntentOptionsSchema, "parse");
  await withCreate(async (_ctx, create) => {
    expect(create.key).toBe(ID);
    return create(operation, input);
  }, { intentKey: ID });
  expect(parse).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0][3]).toBe(parse.mock.results[0].value);
});

it("forwards zodErrorPrefix to withAction", async () => {
  const result = await withCreate(async () => inputSchema.parse({}), undefined, {
    zodErrorPrefix: "Invalid create",
  });
  expect(result).toMatchObject({ success: false, error: expect.stringContaining("Invalid create") });
});

it("parses a create key outside an organization through the same parser", () => {
  const parse = vi.spyOn(createIntentOptionsSchema, "parse");
  expect(parseCreateIntentKey({ intentKey: ID })).toBe(ID);
  expect(parseCreateIntentKey(undefined)).toBeUndefined();
  expect(() => parseCreateIntentKey({ intentKey: "invalid" })).toThrow();
  expect(parse).toHaveBeenCalledTimes(3);
  parse.mockRestore();
});
