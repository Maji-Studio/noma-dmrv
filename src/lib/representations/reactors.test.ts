import { expect, it } from "vitest";
import { representReactor } from "./reactors";
it("maps reactor identifier to lookup name and exposes only lookup fields", () => {
  const id = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
  const now = new Date("2026-10-06T12:00:00Z");
  const row = { id, code: "R-1", identifier: "Auger", facilityId: id, version: 3, archivedAt: now, createdAt: now, updatedAt: now, specifications: { private: true }, organizationId: "org" };
  expect(representReactor(row)).toEqual({ id, code: "R-1", name: "Auger", facilityId: id, version: 3, archivedAt: now.toISOString(), createdAt: now.toISOString(), updatedAt: now.toISOString() });
});
