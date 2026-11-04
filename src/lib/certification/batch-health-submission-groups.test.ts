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
  isCountedSubmissionBlocker,
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
    { kind: "feedstockTransport", fixTarget: "feedstocks", key: "transport", messageFor: feedstockTransportMessage, fact: "2 feedstocks have no usable transport leg.", singleFact: undefined },
    // One application still names its order: the link opens the orders list.
    { kind: "applicationDestination", fixTarget: "orders", key: "entityReadiness", messageFor: applicationDestinationMessage, fact: "2 orders have no customer location.", singleFact: (code: string) => `Order ${code} has no customer location.` },
  ] as const)("counts $kind and states one record's fact on its repair record", ({ kind, fixTarget, key, messageFor, fact, singleFact }) => {
    const blockers = ["one", "two"].map((id) => {
      const message = messageFor(kind === "feedstockTransport" ? `Feedstock FS-${id}` : `AP-${id}`);
      return {
        kind, fixTarget, instruction: message.instruction!, detail: message.message,
        fact: message.fact, record: { id, code: id },
      };
    });
    for (const blocker of blockers) {
      const [check] = unmet([blocker]);
      const one = singleFact ? singleFact(blocker.record.code) : blocker.fact;
      expect(check).toMatchObject({
        key, issueKey: `submission-${fixTarget}`, fixTarget,
        detail: `${one} ${blocker.instruction}`, readOnlyDetail: one,
        copy: { detail: one, instruction: blocker.instruction },
        affectedRecords: [{ ...blocker.record, missing: [blocker.fact] }],
      });
    }
    const checks = unmet(blockers);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      key, issueKey: `submission-${fixTarget}`, fixTarget,
      copy: { detail: fact, instruction: blockers[0].instruction },
      detail: `${fact} ${blockers[0].instruction}`, readOnlyDetail: fact,
    });
    expect(checks[0].affectedRecords).toEqual(blockers.map((blocker) => ({
      ...blocker.record, missing: [blocker.fact],
    })));
    const link = new URL(batchHealthFixLinkFor(checks[0], "facility", "batch").href, "https://noma.test");
    expect(link.pathname).toBe(fixTarget === "feedstocks" ? "/feedstock-intake" : "/orders");
    expect(link.searchParams.get("ids")).toBe("one,two");
    // Grouping changes the to-do projection only, never the original blockers.
    expect(blockers[0].detail).toContain(blockers[0].fact);
    expect(blockers[0].detail).toContain(blockers[0].instruction);
  });

  it("keeps feedstock, order and delivery-distance groups separate despite shared check keys", () => {
    const blockers: SubmissionLineageBlocker[] = ["one", "two"].flatMap((id) => [
      { kind: "feedstockTransport" as const, fixTarget: "feedstocks" as const, message: feedstockTransportMessage(`Feedstock FS-${id}`) },
      { kind: "deliveryDistance" as const, fixTarget: "deliveryDistances" as const, message: deliveryDistanceMessage(`DL-${id}`) },
      { kind: "applicationDestination" as const, fixTarget: "orders" as const, message: applicationDestinationMessage(`AP-${id}`) },
    ].map(({ kind, fixTarget, message }) => ({
      kind, fixTarget, fact: message.fact, detail: message.message, instruction: message.instruction!,
      record: { id: `${fixTarget}-${id}`, code: id },
    })));
    const checks = unmet(blockers);
    expect(checks).toHaveLength(3);
    expect(checks.map(({ key, fixTarget }) => ({ key, fixTarget }))).toEqual([
      { key: "transport", fixTarget: "feedstocks" },
      { key: "entityReadiness", fixTarget: "deliveryDistances" },
      { key: "entityReadiness", fixTarget: "orders" },
    ]);
    for (const check of checks) {
      expect(check.issueKey).toBe(`submission-${check.fixTarget}`);
      expect(check.affectedRecords?.map((record) => record.id))
        .toEqual([`${check.fixTarget}-one`, `${check.fixTarget}-two`]);
      expect(check.readOnlyDetail).toBe(check.copy?.detail);
      expect(check.readOnlyDetail).not.toContain(check.copy!.instruction);
    }
  });

  it("counts only order destinations and keeps delivery fallback facts per record", () => {
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
    expect(checks.map((check) => check.fixTarget)).toEqual(["deliveries", "orders"]);
    expect(checks.map((check) => check.issueKey)).toEqual([
      "submission-deliveries", "submission-orders",
    ]);
    expect(checks.map((check) => check.detail)).toEqual([
      blockers[1].detail, `2 orders have no customer location. ${blockers[0].instruction}`,
    ]);
    expect(checks[0].copy).toBeUndefined();
    expect(isCountedSubmissionBlocker(blockers[1])).toBe(false);
    expect(checks[0].readOnlyDetail).toBe(blockers[1].fact);
    expect(checks[1].copy).toEqual({ detail: "2 orders have no customer location.", instruction: blockers[0].instruction });
    expect(checks.map((check) => check.affectedRecords?.map((record) => record.id)))
      .toEqual([["record-1"], ["record-0", "record-2"]]);
  });

  it("counts one order for applications sharing an order while linking to it once", () => {
    const applications = lineages.slice(0, 2).map((lineage) => ({
      ...lineage,
      delivery: { ...lineage.delivery, proofOfDeliveryCount: 1, customerLocationId: null },
      order: { id: "order-1", code: "OR-1" },
    } as ChainOfCustodyData));
    const blockers = buildSubmissionLineageBlockers(applications, [], {}, []);
    const [check] = unmet(blockers);
    expect(blockers).toHaveLength(2);
    expect(check).toMatchObject({
      fixTarget: "orders", readOnlyDetail: "Order OR-1 has no customer location.",
      copy: { detail: "Order OR-1 has no customer location.", instruction: blockers[0].instruction },
      detail: `Order OR-1 has no customer location. ${blockers[0].instruction}`,
      affectedRecords: [{ id: "order-1", code: "OR-1", missing: blockers.map((blocker) => blocker.fact) }],
    });
    expect(batchHealthFixLinkFor(check, "facility").href).toBe("/orders?facility=facility&ids=order-1");
    expect(blockers.map((blocker) => blocker.fact)).toEqual([
      "Application AP-0 has no customer location.", "Application AP-1 has no customer location.",
    ]);
  });

  it("counts two distinct orders when applications share one of them", () => {
    const applications = lineages.slice(0, 3).map((lineage, index) => ({
      ...lineage,
      delivery: { ...lineage.delivery, proofOfDeliveryCount: 1, customerLocationId: null },
      order: index < 2 ? { id: "order-1", code: "OR-1" } : { id: "order-2", code: "OR-2" },
    } as ChainOfCustodyData));
    const blockers = buildSubmissionLineageBlockers(applications, [], {}, []);
    const [check] = unmet(blockers);
    expect(blockers).toHaveLength(3);
    expect(check).toMatchObject({
      fixTarget: "orders",
      readOnlyDetail: "2 orders have no customer location.",
      copy: { detail: "2 orders have no customer location.", instruction: blockers[0].instruction },
      detail: `2 orders have no customer location. ${blockers[0].instruction}`,
    });
    expect(check.affectedRecords?.map(({ id }) => id)).toEqual(["order-1", "order-2"]);
    expect(batchHealthFixLinkFor(check, "facility").href).toBe("/orders?facility=facility&ids=order-1%2Corder-2");
  });

  it("leaves delivery fallback blockers uncounted with every original record's copy", () => {
    const applications = lineages.slice(0, 2).map((lineage) => ({
      ...lineage,
      delivery: { ...lineage.delivery, proofOfDeliveryCount: 1, customerLocationId: null },
    }));
    const blockers = buildSubmissionLineageBlockers(applications, [], {}, []);
    expect(blockers).toHaveLength(2);
    for (const blocker of blockers) {
      expect(blocker.fixTarget).toBe("deliveries");
      expect(isCountedSubmissionBlocker(blocker)).toBe(false);
      const checks = unmet([blocker]);
      expect(checks).toHaveLength(1);
      expect(checks[0]).toMatchObject({
        fixTarget: "deliveries", detail: blocker.detail, readOnlyDetail: blocker.fact,
        affectedRecords: [{ ...blocker.record, missing: [blocker.detail] }],
      });
      expect(checks[0].copy).toBeUndefined();
    }
    // Preserve the existing destination merge, without replacing the coded facts with a count.
    const [merged] = unmet(blockers);
    expect(merged.detail).toBe(blockers.map((blocker) => blocker.detail).join(" · "));
    expect(merged.readOnlyDetail).toBe(blockers.map((blocker) => blocker.fact).join(" · "));
    expect(merged.affectedRecords).toEqual(blockers.map((blocker) => ({
      ...blocker.record, missing: [blocker.detail],
    })));
    expect(merged.copy).toBeUndefined();
  });

});
