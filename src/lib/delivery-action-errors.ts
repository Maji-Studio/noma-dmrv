import type { DomainIssue } from "./domain-errors";
import { isActionError } from "./action-error";

export function deliveryActionIssues(error: unknown): DomainIssue[] | undefined {
  return isActionError(error) ? error.issues : undefined;
}

/** Use field errors only when the entire refusal is visible in this form. */
export function deliveryActionFieldIssues<T extends string>(error: unknown, renderedFields: readonly T[]) {
  const issues = deliveryActionIssues(error);
  if (!issues?.length) return undefined;
  const mapped = issues.map((issue) => ({
    field: issue.path[0] === "sources" ? "deliveredWetMassKg" : issue.path.join("."),
    message: issue.message,
  }));
  if (!mapped.every((issue) => renderedFields.includes(issue.field as T))) return undefined;
  return mapped as { field: T; message: string }[];
}
