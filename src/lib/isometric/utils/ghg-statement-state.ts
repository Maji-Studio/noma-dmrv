import { SafeError } from "@/lib/errors";
import type { GhgStatement } from "../ghg-statements";
import { getMetadataValue, SUBMISSION_METADATA_KEYS } from "./submission-metadata";

export type GhgSubmitMode =
  | "submit"
  | "resubmit"
  | "blocked-awaiting"
  | "blocked-verified";

export function chooseGhgSubmitMode(remote: GhgStatement): GhgSubmitMode {
  if (remote.status === "DRAFT") return "submit";
  if (remote.status === "AWAITING_VERIFICATION") return "blocked-awaiting";
  if (
    remote.status === "FAILED_VERIFICATION" ||
    (remote.pending_total_co2e_removed_kg !== null &&
      remote.pending_total_co2e_removed_kg > 0)
  ) {
    return "resubmit";
  }
  return "blocked-verified";
}

export function ghgSubmitFingerprintChanged(
  before: GhgStatement,
  after: GhgStatement,
): boolean {
  return (
    before.status !== after.status ||
    before.pending_total_co2e_removed_kg !==
      after.pending_total_co2e_removed_kg ||
    before.submitted_at !== after.submitted_at ||
    before.ghg_statement_report_url !== after.ghg_statement_report_url
  );
}

// Submit-mode decision when the live statement could not be fetched: fall back
// to the remote status mirrored onto the ledger row's metadata. Throws when the
// ledger has never seen a remote status either — better a loud refusal than a
// guessed submit/resubmit against the registry.
export function chooseGhgSubmitModeFromKnownState(
  remote: GhgStatement | null,
  submissionMetadata: unknown,
): GhgSubmitMode {
  if (remote) return chooseGhgSubmitMode(remote);

  const status = getMetadataValue(
    submissionMetadata,
    SUBMISSION_METADATA_KEYS.remoteStatus,
  );
  const pendingTotal = getMetadataValue(
    submissionMetadata,
    SUBMISSION_METADATA_KEYS.pendingTotalCo2eRemovedKg,
  );
  if (status === "DRAFT") return "submit";
  if (status === "AWAITING_VERIFICATION") return "blocked-awaiting";
  if (
    status === "FAILED_VERIFICATION" ||
    (typeof pendingTotal === "number" && pendingTotal > 0)
  ) {
    return "resubmit";
  }
  if (typeof status === "string") return "blocked-verified";

  throw new SafeError(
    "The GHG Statement status is missing. Refresh it from Isometric, then try again.",
  );
}

// True when the registry already shows the submit we were trying to make —
// used to distinguish a lost response from a genuine rejection.
export function ghgSubmitAppearsApplied(
  remote: GhgStatement,
  reportUrl: string,
): boolean {
  return (
    remote.ghg_statement_report_url === reportUrl &&
    (remote.status === "AWAITING_VERIFICATION" || remote.status === "VERIFIED")
  );
}

// The audit-event payload shared by every submit/resubmit sync event.
export function buildGhgSubmitRequestPayload(
  mode: "submit" | "resubmit",
  reportUrl: string,
  summaryProvided: boolean,
): Record<string, string | boolean> {
  if (mode === "resubmit") {
    return {
      ghg_statement_report_url: reportUrl,
      summary_of_changes_provided: summaryProvided,
    };
  }
  return { ghg_statement_report_url: reportUrl };
}
