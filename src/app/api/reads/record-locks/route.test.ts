import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveOrgContext: vi.fn(),
  getRecordLockViews: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), child: () => mocksLogger() },
}));
function mocksLogger() {
  return mocks.logger;
}
vi.mock("@/lib/auth/server", () => ({ resolveOrgContext: mocks.resolveOrgContext }));
vi.mock("@/data-access/record-lock-views", () => ({
  getRecordLockViews: mocks.getRecordLockViews,
  getRemovalLockViews: vi.fn(),
  getStorageBinLockViews: vi.fn(),
}));
vi.mock("@/lib/log", () => ({ logger: mocks.logger }));

import { POST } from "./route";

const CTX = { userId: "user-1", organizationId: "org-1", orgRole: "member" as const, isPlatformAdmin: false };
const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const OPEN = { level: "open", heldBy: [], usedBy: [], freeFields: [], howToFree: null, returnedBy: [] };

function post(body: unknown): Request {
  return new Request("https://app.example/api/reads/record-locks", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  mocks.resolveOrgContext.mockReset().mockResolvedValue({ ok: true, ctx: CTX });
  mocks.getRecordLockViews.mockReset().mockResolvedValue({ [ORDER_ID]: OPEN });
});

describe("/api/reads/record-locks", () => {
  it("answers the lock views in the ActionResult envelope", async () => {
    const response = await POST(post({ entityType: "order", ids: [ORDER_ID] }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, data: { [ORDER_ID]: OPEN } });
  });

  it("answers 400 for a malformed id without reading", async () => {
    const response = await POST(post({ entityType: "order", ids: ["not-an-id"] }));
    expect(response.status).toBe(400);
    expect(mocks.getRecordLockViews).not.toHaveBeenCalled();
  });
});
