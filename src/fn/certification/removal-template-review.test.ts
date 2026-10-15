import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { reviewLineContracts } from "@/data-access/removal-template-observations";
import { reviewRemovalTemplateLines, switchCreditBatchRemovalTemplate } from "./removal-template-review";

const ctx = vi.hoisted((): OrgContext => ({ userId: "review-user", organizationId: "review-org", orgRole: "owner", isPlatformAdmin: false }));
vi.mock("../with-action", async () => {
  const { mockWithAction } = await import("../../../tests/helpers/mock-with-action");
  return mockWithAction(ctx);
});
vi.mock("@/data-access/credit-batches", () => ({ getCreditBatchById: vi.fn() }));
vi.mock("@/data-access/removal-template-observations", () => ({ reviewLineContracts: vi.fn(), getPreviousTemplateObservation: vi.fn() }));
vi.mock("@/data-access/credit-batch-removal-template", () => ({ switchCreditBatchRemovalTemplate: vi.fn(), listPinnedRemovalTemplateIds: vi.fn() }));
const id = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  ctx.orgRole = "owner";
});
describe("Removal template action guards", () => {
  it("denies members before review or switch reads", async () => {
    ctx.orgRole = "member";
    expect((await reviewRemovalTemplateLines({ observationId: id, expectedVersion: 1, assignments: {} })).success).toBe(false);
    expect((await switchCreditBatchRemovalTemplate({ creditBatchId: id, removalTemplateId: "rvt-1", expectedVersion: 1 })).success).toBe(false);
    expect(reviewLineContracts).not.toHaveBeenCalled();
    expect(getCreditBatchById).not.toHaveBeenCalled();
  });
  it.each(["owner", "admin"] as const)("permits %s reviews with server-resolved scope", async (role) => {
    ctx.orgRole = role;
    vi.mocked(reviewLineContracts).mockResolvedValue({ id } as never);
    const input = { observationId: id, expectedVersion: 1, assignments: {} };
    expect(await reviewRemovalTemplateLines(input)).toEqual({ success: true, data: { id } });
    expect(reviewLineContracts).toHaveBeenCalledWith(ctx, input);
  });
  it("validates contracts and versions before persistence", async () => {
    expect((await reviewRemovalTemplateLines({ observationId: id, expectedVersion: 0, assignments: {} })).success).toBe(false);
    expect((await reviewRemovalTemplateLines({ observationId: id, expectedVersion: 1, assignments: { line: { scope: "operating", automaticSource: "invented" as never, entryPolicy: "additive" } } })).success).toBe(false);
    expect(reviewLineContracts).not.toHaveBeenCalled();
  });
});
