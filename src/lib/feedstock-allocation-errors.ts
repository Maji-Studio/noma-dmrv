import { DomainError } from "./domain-errors";
import { recordFieldEqual, withLockedFieldIssues } from "./record-lock-fields";

const INTAKE_BASIS_FIELDS = ["deliveryDate", "storageLocationId", "massWetKg", "moistureContentPercent"] as const;

/** Translate run rebuild refusals to the intake operation that triggered them. */
export async function withIntakeAllocationIssues<T>(
  work: () => Promise<T>, previous: object, changes: object,
): Promise<T> {
  return withLockedFieldIssues(async () => {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "insufficient_stock") throw error;
      const before = new Map(Object.entries(previous));
      const after = new Map(Object.entries(changes));
      const field = INTAKE_BASIS_FIELDS.find(key => after.get(key) !== undefined &&
        !recordFieldEqual(key, before.get(key), after.get(key))) ?? "deliveryDate";
      throw new DomainError(error.code, error.message, {
        ...error, cause: error,
        issues: [{ ...error.issues[0], path: [field], code: error.code, message: error.message }],
      });
    }
  }, previous, changes);
}
