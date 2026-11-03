import { describe, expect, it } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { buildSubmissionLineageBlockers } from "@/fn/certification/certify-lineage-blockers";
import { deriveBatchHealth, type BatchHealthFacts } from "./batch-health";
import { batchHealthFixLinkFor } from "./batch-health-links";
import {
  applicationDestinationMessage,
  deliveryDistanceMessage,
  deliveryProofMessage,
  feedstockTransportMessage,
  type SubmissionLineageBlocker,
} from "./submission-readiness";

const BLOCKED_DELIVERY_COUNT = 11;
const healthy: BatchHealthFacts = {
  carbonMissingInputs: [], facilityEmissionsBlockers: [], feedstockTypeMappingGaps: [],
  entityReadinessGaps: [], hasSubmittableRuns: true, facilitySetupComplete: true, requiredTransport: [],
};
const lineages = Array.from({ length: BLOCKED_DELIVERY_COUNT }, (_, index) => ({
  application: { id: `app-${index}`, code: `AP-${index}` },
  delivery: {
    id: `delivery-${index}`, code: `DL-26-${String(index + 1).padStart(3, "0")}`,
    status: "delivered", proofOfDeliveryCount: 0, customerLocationId: "location",
    distanceKmOverride: null, recordedDistanceKm: null,
  },
} as unknown as ChainOfCustodyData));

function unmet(blockers: SubmissionLineageBlocker[]) {
  return deriveBatchHealth({ ...healthy, submissionLineageBlockers: blockers })
    .checks.filter((check) => check.status === "unmet");
}

describe("submission blocker groups", () => {
  it("groups eleven proofs into one fact and instruction, retaining every record", () => {
    const blockers = buildSubmissionLineageBlockers(lineages, [], {}, []);
    const checks = unmet(blockers);
    expect(checks).toHaveLength(1);
    const [check] = checks;
    const instruction = deliveryProofMessage("DL-26-001").instruction;
    expect(check).toMatchObject({
      issueKey: "submission-deliveryProof-deliveryEvidence",
      copy: { detail: "11 deliveries have no proof of delivery.", instruction },
      detail: `11 deliveries have no proof of delivery. ${instruction}`,
      readOnlyDetail: "11 deliveries have no proof of delivery.",
    });
    expect(check.affectedRecords).toEqual(blockers.map((blocker) => ({
      ...blocker.record, missing: [blocker.fact],
    })));
    expect(check.affectedRecords).toHaveLength(BLOCKED_DELIVERY_COUNT);
    expect(new URL(batchHealthFixLinkFor(check, "facility", "batch").href, "https://noma.test")
      .searchParams.get("ids")?.split(",")).toEqual(blockers.map((blocker) => blocker.record.id));
    // Submission gates and the wizard still receive each original coded sentence.
    expect(blockers[0].detail).toBe(`Delivery DL-26-001 has no proof of delivery. ${instruction}`);
  });

  it("keeps the coded fact for a single proof", () => {
    const [check] = unmet(buildSubmissionLineageBlockers(lineages.slice(0, 1), [], {}, []));
    expect(check.copy).toEqual({
      detail: "Delivery DL-26-001 has no proof of delivery.",
      instruction: deliveryProofMessage("DL-26-001").instruction,
    });
  });

  it("merges proofs and distances with both counts and one instruction per kind", () => {
    const blockers = buildSubmissionLineageBlockers(lineages, [], {}, ["biochar"]);
    const checks = unmet(blockers);
    expect(checks).toHaveLength(1);
    const [check] = checks;
    const proof = deliveryProofMessage("DL-26-001");
    const distance = deliveryDistanceMessage("DL-26-001");
    expect(check.copy).toEqual({
      detail: "11 deliveries have no proof of delivery. · 11 deliveries have no positive transport distance.",
      instruction: `${proof.instruction} · ${distance.instruction}`,
    });
    expect(check.detail).toBe(`11 deliveries have no proof of delivery. ${proof.instruction} · 11 deliveries have no positive transport distance. ${distance.instruction}`);
    expect(check.issueKey).toBe("submission-deliveryProof-deliveryEvidence+submission-deliveryDistance-deliveryDistances");
    expect(check.fixTarget).toBe("deliveries");
    expect(check.affectedRecords).toEqual(lineages.map(({ delivery }) => ({
      id: delivery.id, code: delivery.code,
      missing: [deliveryProofMessage(delivery.code).fact, deliveryDistanceMessage(delivery.code).fact],
    })));
  });

  it.each([
    { kind: "feedstockTransport", fixTarget: "feedstocks", message: feedstockTransportMessage("Feedstock FS-1"), fact: "2 feedstocks have no usable transport leg." },
    { kind: "deliveryProof", fixTarget: "deliveryEvidence", message: deliveryProofMessage("DL-1"), fact: "2 deliveries have no proof of delivery." },
    { kind: "applicationDestination", fixTarget: "orders", message: applicationDestinationMessage("AP-1"), fact: "2 applications have no customer location." },
    { kind: "deliveryDistance", fixTarget: "deliveryDistances", message: deliveryDistanceMessage("DL-1"), fact: "2 deliveries have no positive transport distance." },
  ] as const)("uses the count fact and unchanged instruction for $kind", ({ kind, fixTarget, message, fact }) => {
    const blockers = ["one", "two"].map((id) => ({
      kind, fixTarget, instruction: message.instruction!, detail: message.message,
      fact: message.fact, record: { id, code: id },
    }));
    expect(unmet(blockers)[0].copy).toEqual({ detail: fact, instruction: message.instruction });
  });

  it("keeps first-seen groups and separates the same kind at different targets", () => {
    const message = applicationDestinationMessage("AP-1");
    const blockers: SubmissionLineageBlocker[] = ["orders", "deliveries", "orders"].map((fixTarget, index) => ({
      kind: "applicationDestination", fixTarget: fixTarget as "orders" | "deliveries",
      instruction: message.instruction!, fact: message.fact, detail: message.message,
      record: { id: `record-${index}`, code: `RE-${index}` },
    }));
    const checks = unmet(blockers);
    expect(checks.map((check) => check.issueKey)).toEqual([
      "submission-applicationDestination-orders", "submission-applicationDestination-deliveries",
    ]);
    expect(checks.map((check) => check.copy?.detail)).toEqual([
      "2 applications have no customer location.", message.fact,
    ]);
  });
});
