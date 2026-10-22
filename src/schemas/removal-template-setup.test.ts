import { expect, it } from "vitest";
import { saveMappingSchema } from "./certification";
import { applyRemovalTemplateSetupSchema } from "./removal-template-setup";

const facilityId = "00000000-0000-4000-8000-000000000001";

it("strips the former default-template field from a mapping save", () => {
  expect(saveMappingSchema.parse({
    facilityId, externalProjectId: "project", protocolSlug: "biochar",
    externalFacilityId: "fcl_test", removalTemplateId: "ignored",
  })).not.toHaveProperty("removalTemplateId");
});

it("validates setup answers, fingerprints and unique versioned batches", () => {
  const input = { facilityId: "00000000-0000-4000-8000-000000000001", removalTemplateId: "template",
    fingerprints: { semanticFingerprint: "semantic", fullFingerprint: "full" }, planFingerprint: "plan", answers: {}, overrides: {},
    batchVersions: [{ id: "00000000-0000-4000-8000-000000000002", expectedVersion: 1, removalTemplateId: null }] };
  expect(applyRemovalTemplateSetupSchema.parse(input)).toEqual(input);
  expect(applyRemovalTemplateSetupSchema.safeParse({ ...input, facilityId: "invalid" }).success).toBe(false);
  expect(applyRemovalTemplateSetupSchema.safeParse({ ...input, removalTemplateId: " " }).success).toBe(false);
  expect(applyRemovalTemplateSetupSchema.safeParse({ ...input, batchVersions: [...input.batchVersions, ...input.batchVersions] }).success).toBe(false);
  expect(applyRemovalTemplateSetupSchema.safeParse({ ...input, fingerprints: {} }).success).toBe(false);
  expect(applyRemovalTemplateSetupSchema.safeParse({ ...input, planFingerprint: undefined }).success).toBe(false);
  expect(applyRemovalTemplateSetupSchema.safeParse({ ...input, planFingerprint: "" }).success).toBe(false);
  expect(applyRemovalTemplateSetupSchema.safeParse({ ...input, batchVersions: [{ ...input.batchVersions[0], expectedVersion: 0 }] }).success).toBe(false);
});

it("does not accept batch-selection or make-default controls as setup inputs", () => {
  const parsed = applyRemovalTemplateSetupSchema.parse({
    facilityId, removalTemplateId: "template", fingerprints: { semanticFingerprint: "semantic", fullFingerprint: "full" },
    planFingerprint: "plan", answers: {}, overrides: {}, batchVersions: [], makeDefault: false, batches: [],
  });
  expect(parsed).not.toHaveProperty("makeDefault");
  expect(parsed).not.toHaveProperty("batches");
});
