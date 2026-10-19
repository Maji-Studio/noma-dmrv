import type { DomainIssue } from "./domain-errors";
import type { ActionResult } from "@/types/actions";
import { throwActionError } from "./stale-version";

/** Preserve the shared stale/conflict error classes and the delivery field issues. */
export function throwDeliveryActionError(result: Extract<ActionResult<unknown>, { success: false }>): never {
  try { throwActionError(result); }
  catch (error) { throw Object.assign(error as Error, { issues: result.issues }); }
}

export function deliveryActionIssues(error: unknown): DomainIssue[] | undefined {
  return error instanceof Error && "issues" in error ? error.issues as DomainIssue[] | undefined : undefined;
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
