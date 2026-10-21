import { expect, it } from "vitest";
import { saveMappingSchema } from "./certification";
import { applyRemovalTemplateSetupSchema } from "./removal-template-setup";

const facilityId = "00000000-0000-4000-8000-000000000001";

it("strips the former default-template field from a mapping save", () => {
  expect(saveMappingSchema.parse({
    facilityId, externalProjectId: "project", protocolSlug: "biochar",
    externalFacilityId: "fcl_test", defaultRemovalTemplateId: "ignored",
  })).not.toHaveProperty("defaultRemovalTemplateId");
});

it("validates setup answers, fingerprints and unique versioned batches", () => {
  const input = { facilityId: "00000000-0000-4000-8000-000000000001", removalTemplateId: "template",
    fingerprints: { semanticFingerprint: "semantic", fullFingerprint: "full" }, planFingerprint: "plan", answers: {}, overrides: {}, makeDefault: true,
    batches: [{ id: "00000000-0000-4000-8000-000000000002", expectedVersion: 1 }] };
  expect(applyRemovalTemplateSetupSchema.parse(input)).toEqual(input);
  expect(applyRemovalTemplateSetupSchema.safeParse({ ...input, facilityId: "invalid" }).success).toBe(false);
  expect(applyRemovalTemplateSetupSchema.safeParse({ ...input, removalTemplateId: " " }).success).toBe(false);
  expect(applyRemovalTemplateSetupSchema.safeParse({ ...input, batches: [...input.batches, ...input.batches] }).success).toBe(false);
  expect(applyRemovalTemplateSetupSchema.safeParse({ ...input, fingerprints: {} }).success).toBe(false);
  expect(applyRemovalTemplateSetupSchema.safeParse({ ...input, planFingerprint: undefined }).success).toBe(false);
  expect(applyRemovalTemplateSetupSchema.safeParse({ ...input, planFingerprint: "" }).success).toBe(false);
  expect(applyRemovalTemplateSetupSchema.safeParse({ ...input, batches: [{ ...input.batches[0], expectedVersion: 0 }] }).success).toBe(false);
});
