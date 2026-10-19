import { expect, it, vi } from "vitest";
import { applications, documents, storageObjectDeletions } from "@/db/schema";
import { cleanupApplicationFixture } from "./fixture-applications";
import type { DeliveryEvalFixture } from "./fixture-delivery";

const state = vi.hoisted(() => ({ deleted: [] as unknown[] }));
vi.mock("@/db", () => ({
  db: { transaction: async (callback: (tx: unknown) => Promise<void>) => callback({
    delete: (table: unknown) => ({ where: async () => { state.deleted.push(table); } }),
  }) },
}));
vi.mock("@/lib/operations/deliveries", () => ({}));
vi.mock("@/lib/operations/runner", () => ({}));
vi.mock("./fixture-delivery", () => ({
  cleanupDeliveryFixture: async () => {
    expect(state.deleted).toContain(documents);
    expect(state.deleted).toContain(storageObjectDeletions);
  },
}));

it("removes document rows and deletion jobs before applications and the parent fixture", async () => {
  state.deleted = [];
  await cleanupApplicationFixture({ ctx: { organizationId: "eval-org" } } as DeliveryEvalFixture);
  expect(state.deleted.indexOf(storageObjectDeletions)).toBeGreaterThanOrEqual(0);
  expect(state.deleted.indexOf(documents)).toBeGreaterThan(state.deleted.indexOf(storageObjectDeletions));
  expect(state.deleted.indexOf(applications)).toBeGreaterThan(state.deleted.indexOf(documents));
});
