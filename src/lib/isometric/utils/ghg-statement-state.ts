import type { GhgStatement } from "../ghg-statements";

export type GhgSubmitMode =
  | "submit"
  | "resubmit"
  | "blocked-awaiting"
  | "blocked-verified";

export function chooseGhgSubmitMode(remote: GhgStatement): GhgSubmitMode {
  if (remote.status === "DRAFT") return "submit";
  if (
    remote.status === "FAILED_VERIFICATION" ||
    remote.pending_total_co2e_removed_kg !== null
  ) {
    return "resubmit";
  }
  if (remote.status === "AWAITING_VERIFICATION") return "blocked-awaiting";
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
