import { describe, expect, it, vi } from "vitest";

vi.mock("./sources", () => ({
  collectCandidateDocumentIdsForRemoval: vi.fn(),
  resolveSourceIdsForRemoval: vi.fn(),
}));

import type { RemovalSubmissionContext } from "./certify-context-core";
import { payloadHash } from "@/lib/isometric";
import {
  buildRemovalSubmissionBuild,
  normalizeSequestrationTemplateForHash,
} from "./removal-submission-build";
import * as sources from "./sources";

describe("buildRemovalSubmissionBuild", () => {
  it("fingerprints live sequestration component and input structure deterministically", () => {
    const templateShape = {
      groups: [
        {
          key: "sequestration",
          components: [
            {
              id: "rtc_1",
              blueprint_key: "biochar_sequestration_1000_year",
              inputs: [
                {
                  input_key: "product_mass",
                  type: "monitored",
                  quantity_kind: "mass",
                  datapoint_id: null,
                },
                {
                  input_key: "carbon_contents",
                  type: "monitored",
                  quantity_kind: "mass_fraction_dry_basis",
                  datapoint_id: null,
                },
              ],
            },
          ],
        },
      ],
    };
    const template = templateShape as never;
    const reordered = {
      groups: [
        {
          ...templateShape.groups[0],
          components: [
            {
              ...templateShape.groups[0].components[0],
              inputs: [...templateShape.groups[0].components[0].inputs].reverse(),
            },
          ],
        },
      ],
    } as never;
    const changed = {
      groups: [
        {
          ...templateShape.groups[0],
          components: [
            {
              ...templateShape.groups[0].components[0],
              id: "rtc_2",
            },
          ],
        },
      ],
    } as never;

    const baseline = payloadHash(
      normalizeSequestrationTemplateForHash(template),
    );
    expect(
      payloadHash(normalizeSequestrationTemplateForHash(reordered)),
    ).toBe(baseline);
    expect(
      payloadHash(normalizeSequestrationTemplateForHash(changed)),
    ).not.toBe(baseline);
  });

  it("fails closed when entity certification readiness was not evaluated", async () => {
    const ctx = {} as RemovalSubmissionContext;

    await expect(
      buildRemovalSubmissionBuild({
        orgCtx: {} as never,
        removalId: "rem-test-missing-readiness",
        ctx,
        defaultTemplate: {} as never,
        blueprintsByKey: new Map(),
        externalProjectId: "prj-test-missing-readiness",
        allowPeriodInputStub: false,
        hasDurabilityComponents: false,
      }),
    ).rejects.toThrow(/readiness was not evaluated/i);

    expect(sources.collectCandidateDocumentIdsForRemoval).not.toHaveBeenCalled();
    expect(sources.resolveSourceIdsForRemoval).not.toHaveBeenCalled();
  });

  it("blocks entity certification gaps before preparing registry inputs", async () => {
    const ctx = {
      entityReadinessGaps: [
        "Application APP-TEST-001: Upload the application logbook",
      ],
    } as unknown as RemovalSubmissionContext;

    await expect(
      buildRemovalSubmissionBuild({
        orgCtx: {} as never,
        removalId: "rem-test-1",
        ctx,
        defaultTemplate: {} as never,
        blueprintsByKey: new Map(),
        externalProjectId: "prj-test-1",
        allowPeriodInputStub: false,
        hasDurabilityComponents: false,
      }),
    ).rejects.toThrow(/entity certification readiness/i);

    expect(sources.collectCandidateDocumentIdsForRemoval).not.toHaveBeenCalled();
    expect(sources.resolveSourceIdsForRemoval).not.toHaveBeenCalled();
  });
});
