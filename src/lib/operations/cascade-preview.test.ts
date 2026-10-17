import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { cascadeChanged } from "@/lib/party-domain-errors";
import type { Operation } from "./runner";
const run = vi.hoisted(() => vi.fn());
vi.mock("./runner", () => ({ runOperation: run }));
import { runWithCascadePreview } from "./cascade-preview";
const ctx = { organizationId: "org" } as OrgContext;
const cascade = { orders: [{ id: "order", code: "ORD-0001", facilityId: "f1" }], cascadeFingerprint: "fresh" };
const operation: Operation<z.ZodType, { cascade: typeof cascade }> = { id: "delete_customer", input: z.object({}), supportsDryRun: true, execute: vi.fn() };
beforeEach(() => run.mockReset());
it("returns a fresh dry run without a key, audit or stale fingerprint, preserving the issue", async () => {
  run.mockRejectedValueOnce(cascadeChanged()).mockResolvedValueOnce({ data: { cascade } });
  await expect(runWithCascadePreview(operation, ctx, { customerId: "customer", cascadeFingerprint: "old" }, {
    idempotency: { credentialId: "credential", key: "key" },
  })).rejects.toMatchObject({ code: "cascade_changed", issues: [{ path: ["cascadeFingerprint"] }], preview: cascade });
  expect(run.mock.calls[1][2]).toEqual({ customerId: "customer" });
  expect(run.mock.calls[1][3]).toEqual({ pool: undefined, dryRun: true, deadlineMs: expect.any(Number) });
});
it("omits the preview if the fallback fails", async () => {
  const error = cascadeChanged();
  run.mockRejectedValueOnce(error).mockRejectedValueOnce(new Error("failed"));
  await expect(runWithCascadePreview(operation, ctx, {})).rejects.toBe(error);
  expect(error).not.toHaveProperty("preview");
});
it("does not preview a successful replay", async () => {
  const result = { replayed: true, data: { cascade } };
  run.mockResolvedValueOnce(result);
  expect(await runWithCascadePreview(operation, ctx, {})).toBe(result);
  expect(run).toHaveBeenCalledTimes(1);
});
it("does not rerun a version refusal", async () => {
  const error = new DomainError("stale_version", "Stale version");
  run.mockRejectedValueOnce(error);
  await expect(runWithCascadePreview(operation, ctx, {})).rejects.toBe(error);
  expect(run).toHaveBeenCalledTimes(1);
});
it("does not extend an expired deadline", async () => {
  const error = cascadeChanged();
  run.mockRejectedValueOnce(error);
  await expect(runWithCascadePreview(operation, ctx, {}, { deadlineMs: 0 })).rejects.toBe(error);
  expect(run).toHaveBeenCalledTimes(1);
});
