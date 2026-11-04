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
      issueKey: "submission-deliveryEvidence",
      fixTarget: "deliveryEvidence",
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
    const message = deliveryProofMessage("DL-26-001");
    expect(check).toMatchObject({
      issueKey: "submission-deliveryEvidence",
      fixTarget: "deliveryEvidence",
      detail: message.message,
      readOnlyDetail: message.fact,
      affectedRecords: [{ id: "delivery-0", code: "DL-26-001", missing: [message.fact] }],
    });
    expect(check.copy).toEqual({
      detail: "Delivery DL-26-001 has no proof of delivery.",
      instruction: deliveryProofMessage("DL-26-001").instruction,
    });
  });

  it("keeps proofs and distances in two counted rows with their own instruction", () => {
    const blockers = buildSubmissionLineageBlockers(lineages, [], {}, ["biochar"]);
    const checks = unmet(blockers);
    expect(checks).toHaveLength(2);
    const proof = deliveryProofMessage("DL-26-001");
    const distance = deliveryDistanceMessage("DL-26-001");
    for (const { target, fact, message, messageFor } of [
      { target: "deliveryEvidence", fact: "11 deliveries have no proof of delivery.", message: proof, messageFor: deliveryProofMessage },
      { target: "deliveryDistances", fact: "11 deliveries have no positive transport distance.", message: distance, messageFor: deliveryDistanceMessage },
    ] as const) {
      const check = checks.find((check) => check.fixTarget === target)!;
      expect(check.issueKey).toBe(`submission-${target}`);
      expect(check.copy).toEqual({ detail: fact, instruction: message.instruction });
      expect(check.detail).toBe(`${fact} ${message.instruction}`);
      expect(check.readOnlyDetail).toBe(fact);
      expect(check.affectedRecords).toEqual(lineages.map(({ delivery }) => ({
        id: delivery.id, code: delivery.code, missing: [messageFor(delivery.code).fact],
      })));
      expect(new URL(batchHealthFixLinkFor(check, "facility", "batch").href, "https://noma.test")
        .searchParams.get("ids")?.split(",")).toEqual(lineages.map(({ delivery }) => delivery.id));
    }
  });

  it.each([
    { kind: "deliveryProof", fixTarget: "deliveryEvidence", message: deliveryProofMessage("DL-1"), fact: "2 deliveries have no proof of delivery." },
    { kind: "deliveryDistance", fixTarget: "deliveryDistances", message: deliveryDistanceMessage("DL-1"), fact: "2 deliveries have no positive transport distance." },
  ] as const)("uses the count fact and unchanged instruction for $kind", ({ kind, fixTarget, message, fact }) => {
    const blockers = ["one", "two"].map((id) => ({
      kind, fixTarget, instruction: message.instruction!, detail: message.message,
      fact: message.fact, record: { id, code: id },
    }));
    const checks = unmet(blockers);
    expect(checks).toHaveLength(1);
    expect(checks[0].copy).toEqual({ detail: fact, instruction: message.instruction });
  });

  it.each([
    { kind: "feedstockTransport", fixTarget: "feedstocks", messageFor: feedstockTransportMessage },
    { kind: "applicationDestination", fixTarget: "orders", messageFor: applicationDestinationMessage },
  ] as const)("retains each $kind record's full detail without a count fact", ({ kind, fixTarget, messageFor }) => {
    const blockers = ["one", "two"].map((id) => {
      const message = messageFor(id);
      return {
        kind, fixTarget, instruction: message.instruction!, detail: message.message,
        fact: message.fact, record: { id, code: id },
      };
    });
    // Each record contributes its original check before destination merging.
    for (const blocker of blockers) {
      const checks = unmet([blocker]);
      expect(checks).toHaveLength(1);
      expect(checks[0]).toMatchObject({
        issueKey: `submission-${fixTarget}`, fixTarget,
        detail: blocker.detail, readOnlyDetail: blocker.fact,
        affectedRecords: [{ ...blocker.record, missing: [blocker.detail] }],
      });
      expect(checks[0].copy).toBeUndefined();
    }
    const checks = unmet(blockers);
    expect(checks).toHaveLength(1);
    expect(checks[0].copy).toBeUndefined();
    expect(checks[0].detail).toBe(blockers.map((blocker) => blocker.detail).join(" · "));
    expect(checks[0].readOnlyDetail).toBe(blockers.map((blocker) => blocker.fact).join(" · "));
    expect(checks[0].affectedRecords).toEqual(blockers.map((blocker) => ({
      ...blocker.record, missing: [blocker.detail],
    })));
  });

  it("keeps first-seen groups and separates the same kind at different targets", () => {
    const blockers: SubmissionLineageBlocker[] = ["orders", "deliveries", "orders"].map((fixTarget, index) => {
      const message = applicationDestinationMessage(`AP-${index}`);
      return {
        kind: "applicationDestination", fixTarget: fixTarget as "orders" | "deliveries",
        instruction: message.instruction!, fact: message.fact, detail: message.message,
        record: { id: `record-${index}`, code: `AP-${index}` },
      };
    });
    const checks = unmet(blockers);
    expect(checks).toHaveLength(2);
    expect(checks.map((check) => check.fixTarget)).toEqual(["orders", "deliveries"]);
    expect(checks.map((check) => check.issueKey)).toEqual([
      "submission-orders+submission-orders", "submission-deliveries",
    ]);
    expect(checks.map((check) => check.detail)).toEqual([
      `${blockers[0].detail} · ${blockers[2].detail}`, blockers[1].detail,
    ]);
    expect(checks.map((check) => check.copy)).toEqual([undefined, undefined]);
    expect(checks.map((check) => check.affectedRecords?.map((record) => record.id)))
      .toEqual([["record-0", "record-2"], ["record-1"]]);
  });
});
