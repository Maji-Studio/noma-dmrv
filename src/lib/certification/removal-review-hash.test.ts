import { describe, expect, it } from "vitest";
import { payloadHash } from "@/lib/isometric/utils/payload-hash";
import { reviewPayloadHash } from "./removal-review-hash";

/**
 * A compiled semantic payload before any supporting file has reached the
 * registry: no Source IDs yet, and the binding plan carries empty ones.
 */
function pendingPayload(): Record<string, unknown> {
  return {
    removalId: "rem-1",
    sourceIds: [],
    sourceBindingPlan: [
      { documentId: "doc-1", sourceId: "", nomaRole: "inventory" },
    ],
    candidateSources: [{ documentId: "doc-1", binding: "inventory" }],
    inputs: [{ inputKey: "biochar_mass", value: 1000 }],
  };
}

/** The same payload after submission copied that file and got an ID back. */
function materializedPayload(): Record<string, unknown> {
  return {
    ...pendingPayload(),
    sourceIds: ["src-1"],
    sourceBindingPlan: [
      { documentId: "doc-1", sourceId: "src-1", nomaRole: "inventory" },
    ],
  };
}

describe("reviewPayloadHash", () => {
  // The bug this exists to prevent: a submission that copies a file and then
  // fails leaves that Source ID persisted. If the reviewed fingerprint moved,
  // the operator's retry is rejected as "changed after review" before it can
  // finish the remaining copies, so retrying can never succeed.
  it("is stable when Source IDs materialize", () => {
    expect(reviewPayloadHash(materializedPayload())).toBe(
      reviewPayloadHash(pendingPayload()),
    );
  });

  it("is stable when Biochar Application Source IDs materialize", () => {
    const pending = {
      ...pendingPayload(),
      biocharApplicationIntents: [
        { applicationId: "app-1", sourceIds: [] },
      ],
    };
    const materialized = {
      ...pending,
      biocharApplicationIntents: [
        { applicationId: "app-1", sourceIds: ["src-photo"] },
      ],
    };

    expect(reviewPayloadHash(materialized)).toBe(reviewPayloadHash(pending));
    expect(payloadHash(materialized)).not.toBe(payloadHash(pending));
  });

  it("differs from the full payload hash, which must still track Source IDs", () => {
    expect(payloadHash(materializedPayload())).not.toBe(
      payloadHash(pendingPayload()),
    );
  });

  // The other half: stripping IDs must not blind the check to a real change in
  // the evidence the operator actually reviewed.
  it("moves when a supporting file is removed", () => {
    const fewer = { ...pendingPayload(), candidateSources: [] };
    expect(reviewPayloadHash(fewer)).not.toBe(
      reviewPayloadHash(pendingPayload()),
    );
  });

  it("moves when a supporting file is rebound to another role", () => {
    const rebound = {
      ...pendingPayload(),
      candidateSources: [{ documentId: "doc-1", binding: "lab_report" }],
    };
    expect(reviewPayloadHash(rebound)).not.toBe(
      reviewPayloadHash(pendingPayload()),
    );
  });

  it("moves when non-evidence submission data drifts", () => {
    const drifted = {
      ...pendingPayload(),
      inputs: [{ inputKey: "biochar_mass", value: 2000 }],
    };
    expect(reviewPayloadHash(drifted)).not.toBe(
      reviewPayloadHash(pendingPayload()),
    );
  });

  it("keeps unknown nested sourceIds fields hashed", () => {
    const original = {
      ...pendingPayload(),
      futureRegistryContract: { sourceIds: ["reviewed-value"] },
    };
    const drifted = {
      ...original,
      futureRegistryContract: { sourceIds: ["changed-value"] },
    };

    expect(reviewPayloadHash(drifted)).not.toBe(reviewPayloadHash(original));
  });

  it("keeps every non-Source-ID binding field hashed", () => {
    const reroled = {
      ...pendingPayload(),
      sourceBindingPlan: [
        { documentId: "doc-1", sourceId: "", nomaRole: "lab_report" },
      ],
    };
    expect(reviewPayloadHash(reroled)).not.toBe(
      reviewPayloadHash(pendingPayload()),
    );
  });

  it("stays stable when deterministic generated ledgers materialize during submit", () => {
    const withGeneratedLedgers = {
      ...pendingPayload(),
      candidateSources: [
        ...(pendingPayload().candidateSources as unknown[]),
        {
          documentId: "doc-transport-ledger",
          binding: { nomaRole: "transport_evidence_ledger" },
        },
        {
          documentId: "doc-durability-ledger",
          binding: { nomaRole: "durability_evidence_ledger" },
        },
      ],
      sourceBindingPlan: [
        ...(pendingPayload().sourceBindingPlan as unknown[]),
        {
          documentId: "doc-transport-ledger",
          sourceId: "src-transport-ledger",
          nomaRole: "transport_evidence_ledger",
        },
        {
          documentId: "doc-durability-ledger",
          sourceId: "src-durability-ledger",
          nomaRole: "durability_evidence_ledger",
        },
      ],
    };

    expect(reviewPayloadHash(withGeneratedLedgers)).toBe(
      reviewPayloadHash(pendingPayload()),
    );
    expect(payloadHash(withGeneratedLedgers)).not.toBe(
      payloadHash(pendingPayload()),
    );
  });

  it("tolerates a payload with no Source fields at all", () => {
    const bare = { removalId: "rem-1" };
    expect(() => reviewPayloadHash(bare)).not.toThrow();
    expect(reviewPayloadHash(bare)).toBe(payloadHash(bare));
  });
});
