import { expect, it } from "vitest";
import { saveMappingSchema } from "./certification";
import { setFacilityDefaultRemovalTemplateSchema, startRemovalTemplateSetupSchema } from "./removal-template-setup";

const facilityId = "00000000-0000-4000-8000-000000000001";

it("validates setup ids", () => {
  const input = { facilityId, removalTemplateId: "template" };
  expect(startRemovalTemplateSetupSchema.parse(input)).toEqual(input);
  expect(startRemovalTemplateSetupSchema.safeParse({ ...input, facilityId: "invalid" }).success).toBe(false);
  expect(startRemovalTemplateSetupSchema.safeParse({ ...input, removalTemplateId: " " }).success).toBe(false);
  expect(setFacilityDefaultRemovalTemplateSchema.parse(input)).toEqual(input);
});

it("strips the former default-template field from a mapping save", () => {
  expect(saveMappingSchema.parse({
    facilityId, externalProjectId: "project", protocolSlug: "biochar",
    externalFacilityId: "fcl_test", defaultRemovalTemplateId: "ignored",
  })).not.toHaveProperty("defaultRemovalTemplateId");
});
