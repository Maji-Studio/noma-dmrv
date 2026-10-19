import { expect, it } from "vitest";
import { formulationRepresentationSchema, representFormulation } from "./formulations";

const id = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const now = new Date("2026-10-06T12:00:00Z");

it("projects recipe lines as ids and ratios, with description and archive state, and strips extra fields", () => {
  const data = representFormulation({
    id, code: "BCF-01", name: "Raw biochar", version: 2, biocharRatio: 0.5, createdAt: now, updatedAt: now,
    lines: [{ id, feedstockTypeId: id, ratio: 0.5 }, { id: "ea31ace1-5b30-4443-adb4-26b43bfa5599", feedstockTypeId: id, ratio: null }],
    organizationId: "foreign", description: "Blend guidance", archivedAt: now,
  } as never);
  expect(data).toMatchObject({ archivedAt: now.toISOString(), description: "Blend guidance", biocharRatio: 0.5, lines: [{ id, feedstockTypeId: id, ratio: 0.5 }, { ratio: null }] });
  expect(Object.keys(data).sort()).toEqual(Object.keys(formulationRepresentationSchema.shape).sort());
  expect(data).not.toHaveProperty("organizationId");
});

it("represents Pure biochar as a formulation without lines", () => {
  expect(representFormulation({ id, code: "PURE", name: "Pure biochar", version: 1, description: null, archivedAt: null, biocharRatio: 1, createdAt: now, updatedAt: now, lines: [] }).lines).toEqual([]);
});

it("uses representation revision 2 for formulation ETags", async () => {
  const { FORMULATION_REPRESENTATION_REVISION } = await import("@/config/api-rest");
  expect(FORMULATION_REPRESENTATION_REVISION).toBe(2);
});
