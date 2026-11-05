import { describe, expect, it } from "vitest";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import { SUBMISSION_EXTERNAL_MUTATIONS, SUBMISSION_METADATA_KEYS } from "./submission-metadata";
import { canTransferProductionReservation, type ProductionReservation } from "./production-reservation-policy";

const NOW = Date.parse("2026-06-01T12:00:00Z");
const reservation = (patch: Partial<ProductionReservation> = {}): ProductionReservation => ({
  provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: "removal",
  status: "draft", lockedAt: new Date(NOW), metadata: {}, ...patch,
});

describe("production reservation transfer policy shared with allocation", () => {
  it("protects live, submitted, unknown and foreign-kind reservations", () => {
    for (const row of [undefined, reservation(), reservation({ status: "submitted" }), reservation({ provider: "other" })]) {
      expect(canTransferProductionReservation(row, NOW)).toBe(false);
    }
  });
  it("allows mutation-free expired and definitively rejected attempts to transfer", () => {
    for (const row of [reservation({ lockedAt: new Date(NOW - LOCK_TTL_MS) }), reservation({ status: "rejected" }), reservation({ status: "superseded" })]) {
      expect(canTransferProductionReservation(row, NOW)).toBe(true);
    }
  });
  it("retains possible external mutations even after expiry or rejection", () => {
    for (const mutation of [SUBMISSION_EXTERNAL_MUTATIONS.possible, SUBMISSION_EXTERNAL_MUTATIONS.confirmed]) {
      expect(canTransferProductionReservation(reservation({ status: "rejected", lockedAt: null,
        metadata: { [SUBMISSION_METADATA_KEYS.externalMutation]: mutation } }), NOW)).toBe(false);
    }
  });
});
