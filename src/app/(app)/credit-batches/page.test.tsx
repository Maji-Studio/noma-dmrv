import { describe, expect, it, vi } from "vitest";
import CreditBatchesPage from "./page";

vi.mock("@/lib/auth/server", () => ({
  getOrgContext: vi.fn(async () => ({
    orgRole: "admin",
    isPlatformAdmin: false,
  })),
}));

describe("CreditBatchesPage", () => {
  it("passes hard-entry create intent into the client list", async () => {
    const element = await CreditBatchesPage({
      searchParams: Promise.resolve({
        facility: "facility-1",
        create: "true",
      }),
    });

    expect(element.props).toMatchObject({
      canManage: true,
      initialCreate: true,
    });
  });
});
