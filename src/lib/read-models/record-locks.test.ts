import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECORD_LOCK_VIEW_MAX_IDS } from "@/lib/record-lock-view";

const mocks = vi.hoisted(() => ({
  getRecordLockViews: vi.fn(),
  getRemovalLockViews: vi.fn(),
  getStorageBinLockViews: vi.fn(),
}));
vi.mock("@/data-access/record-lock-views", () => mocks);

import { readRecordLocks } from "./record-locks";

const CTX = { userId: "user-1", organizationId: "org-1", orgRole: "member" as const, isPlatformAdmin: false };
const UPPER = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset().mockResolvedValue({});
});

describe("readRecordLocks", () => {
  it("lower-cases ids, so they compare with what PostgreSQL returns", async () => {
    await readRecordLocks(CTX, { entityType: "order", ids: [UPPER] });
    expect(mocks.getRecordLockViews).toHaveBeenCalledWith(CTX, "order", [UPPER.toLowerCase()]);
  });

  it("routes storage bins and Removals to their own reads", async () => {
    await readRecordLocks(CTX, { entityType: "storageLocation", ids: [UPPER] });
    await readRecordLocks(CTX, { entityType: "removal", ids: [UPPER] });
    expect(mocks.getStorageBinLockViews).toHaveBeenCalledWith(CTX, [UPPER.toLowerCase()]);
    expect(mocks.getRemovalLockViews).toHaveBeenCalledWith(CTX, [UPPER.toLowerCase()]);
  });

  it("refuses an unknown kind, a malformed id and an oversized page", async () => {
    await expect(readRecordLocks(CTX, { entityType: "supplier", ids: [] })).rejects.toThrow();
    await expect(readRecordLocks(CTX, { entityType: "order", ids: ["not-an-id"] })).rejects.toThrow();
    const tooMany = Array.from({ length: RECORD_LOCK_VIEW_MAX_IDS + 1 }, () => crypto.randomUUID());
    await expect(readRecordLocks(CTX, { entityType: "order", ids: tooMany })).rejects.toThrow();
  });
});
