import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECORD_USED_BY_KINDS } from "@/lib/record-used-by-chain";

const mocks = vi.hoisted(() => ({ getRecordUsedByChain: vi.fn() }));
vi.mock("@/data-access/record-used-by-chain", () => mocks);

import { readRecordUsedByChain } from "./record-used-by-chain";

const CTX = { userId: "user-1", organizationId: "org-1", orgRole: "member" as const, isPlatformAdmin: false };
const UPPER_ID = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";

beforeEach(() => mocks.getRecordUsedByChain.mockReset().mockResolvedValue(null));

describe("readRecordUsedByChain", () => {
  it.each(RECORD_USED_BY_KINDS)("reads %s with the caller's context and a canonical id", async kind => {
    const chain = { self: { kind, id: UPPER_ID.toLowerCase() }, upstream: [], downstream: [], edges: [], creditBatches: [] };
    mocks.getRecordUsedByChain.mockResolvedValue(chain);
    await expect(readRecordUsedByChain(CTX, { kind, id: UPPER_ID })).resolves.toBe(chain);
    expect(mocks.getRecordUsedByChain).toHaveBeenCalledWith(CTX, kind, UPPER_ID.toLowerCase());
  });

  it("preserves null for an unknown or foreign record", async () => {
    await expect(readRecordUsedByChain(CTX, { kind: "order", id: UPPER_ID })).resolves.toBeNull();
  });

  it.each([
    undefined,
    { kind: "supplier", id: UPPER_ID },
    { kind: "order", id: "not-an-id" },
    { kind: "order" },
  ])("rejects invalid input %j before data access", async input => {
    await expect(readRecordUsedByChain(CTX, input)).rejects.toThrow();
    expect(mocks.getRecordUsedByChain).not.toHaveBeenCalled();
  });
});
