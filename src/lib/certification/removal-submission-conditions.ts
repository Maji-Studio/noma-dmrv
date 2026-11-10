import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import { hasDurabilityMeasurementComponents } from "./submission-readiness";

export const EMPTY_REMOVAL_TEMPLATE_MESSAGE =
  "The Removal template has no fields to submit. Choose another template for this credit batch.";

export const DURABILITY_SUBMISSION_UNAVAILABLE_MESSAGE =
  "Durability submission is not available in the production registry yet. Wait for support to confirm availability before submitting this Removal.";

/** Shared preparation and readiness conditions, safe to evaluate on the client. */
export function isEmptyRemovalTemplate(template: IsometricGhgEntryTemplate | null): boolean {
  return template?.groups.length === 0;
}

export function isDurabilitySubmissionUnavailable(
  template: IsometricGhgEntryTemplate | null,
  measurementSamplesEnabled: boolean,
): boolean {
  return hasDurabilityMeasurementComponents(template) && !measurementSamplesEnabled;
}
