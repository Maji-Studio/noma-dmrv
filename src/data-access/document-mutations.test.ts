import { beforeEach, expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
const mocks = vi.hoisted(() => ({ read: vi.fn(), lock: vi.fn(), writable: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("./document-write-scope", async (original) => ({ ...await original<typeof import("./document-write-scope")>(),
  readDocumentForWrite: mocks.read, lockDocumentOwner: mocks.lock, assertDocumentOwnerWritable: mocks.writable,
}));
import { setDocumentVisibilityInTransaction } from "./document-mutations";
const ctx: OrgContext = { organizationId: "org", userId: "user", orgRole: null, isPlatformAdmin: true };
const documentId = "12345678-1234-4234-8234-123456789abc";
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue({ id: documentId, entityType: "sample", entityId: "sample", version: 1 }); });
it("lets a Platform Admin without membership change visibility", async () => {
  const saved = { id: documentId, visibility: "public", version: 2 };
  const tx = { update: () => ({ set: () => ({ where: () => ({ returning: async () => [saved] }) }) }) } as unknown as DbTransaction;
  expect(await setDocumentVisibilityInTransaction(ctx, tx, { documentId, visibility: "public" })).toEqual(saved);
  expect(mocks.writable).toHaveBeenCalled();
});
it("refuses an ordinary member with plain copy before reading or writing", async () => {
  await expect(setDocumentVisibilityInTransaction({ ...ctx, orgRole: "member", isPlatformAdmin: false }, {} as DbTransaction, { documentId, visibility: "public" })).rejects.toMatchObject({
    code: "forbidden", message: "Only organization owners and admins can change file visibility.",
  });
  expect(mocks.read).not.toHaveBeenCalled();
});
