import type { RegistryObservationStatus } from "@/lib/certification/registry-observation";
import type { GhgStatement } from "@/lib/isometric";
import {
  chooseGhgSubmitMode,
  type GhgSubmitMode,
} from "@/lib/isometric/utils/ghg-statement-state";
import type { CheckStatus } from "./check-row";

export interface WorkflowStepModel {
  status: CheckStatus;
  detail?: string;
}

export type RollupQueryState =
  | { status: "loading" | "error" }
  | { status: RegistryObservationStatus; message: string };

export interface GhgStatementWorkflowState {
  mode: GhgSubmitMode;
  hasMembership: boolean;
  rollupReady: boolean;
  canGenerate: boolean;
  canSubmit: boolean;
  generationUnavailableReason: string | null;
  verifierStep: WorkflowStepModel;
}

export function deriveVerifierStep(
  remote: GhgStatement | null,
  remoteUnavailable: boolean,
  hasMembership: boolean,
  hasApprovedReport: boolean,
): WorkflowStepModel {
  if (!remote) {
    return remoteUnavailable
      ? {
          status: "warning",
          detail:
            "Live Isometric statement data is unavailable. Refresh and try again.",
        }
      : { status: "skipped" };
  }
  switch (remote.status) {
    case "AWAITING_VERIFICATION":
      return { status: "met", detail: "In verification. No action is needed." };
    case "VERIFIED":
      return chooseGhgSubmitMode(remote) === "resubmit"
        ? {
            status: "warning",
            detail:
              "Verified with pending changes. Resubmit to update the verifier.",
          }
        : { status: "met", detail: "Verified." };
    case "CREDITS_ISSUED":
      return { status: "met", detail: "Credits issued." };
    case "FAILED_VERIFICATION":
      return {
        status: "warning",
        detail: "Verification failed. Update the Removals, then resubmit.",
      };
    default:
      if (!hasMembership) {
        return {
          status: "warning",
          detail: "No GHG Entries are available to submit.",
        };
      }
      return hasApprovedReport
        ? {
            status: "active",
            detail: "Submit the approved report to the verifier.",
          }
        : {
            status: "active",
            detail: "Provide an external report URL to submit to the verifier.",
          };
  }
}

export function deriveGhgStatementWorkflowState({
  created,
  canManageReports,
  remote,
  linkedRemovalCount,
  hasApprovedReport,
  rollup,
}: {
  created: boolean;
  canManageReports: boolean;
  remote: GhgStatement | null;
  linkedRemovalCount: number;
  hasApprovedReport: boolean;
  rollup: RollupQueryState;
}): GhgStatementWorkflowState {
  const remoteUnavailable = created && remote === null;
  const hasMembership = remote
    ? remote.ghg_entry_ids.length > 0
    : linkedRemovalCount > 0;
  const mode = remote ? chooseGhgSubmitMode(remote) : "submit";
  const remoteTotalReady =
    remote?.pending_total_co2e_removed_kg != null &&
    Number.isFinite(remote.pending_total_co2e_removed_kg);
  const rollupReady = rollup.status === "available" && remoteTotalReady;

  let generationUnavailableReason: string | null = null;
  if (remoteUnavailable) {
    generationUnavailableReason =
      "Live Isometric statement data is unavailable. Refresh and try again.";
  } else if (!hasMembership) {
    generationUnavailableReason =
      "Submit a Removal in this reporting period before generating a report.";
  } else if (rollup.status === "loading") {
    generationUnavailableReason = "The registry roll-up is still loading.";
  } else if (rollup.status === "error") {
    generationUnavailableReason =
      "The registry roll-up could not be loaded. Refresh and try again.";
  } else if (
    rollup.status === "pending" ||
    rollup.status === "unavailable"
  ) {
    generationUnavailableReason = rollup.message;
  } else if (!remoteTotalReady) {
    generationUnavailableReason =
      "Wait for Isometric to finish calculating the GHG Statement total.";
  }

  return {
    mode,
    hasMembership,
    rollupReady,
    canGenerate: canManageReports && rollupReady,
    canSubmit:
      canManageReports &&
      created &&
      remote !== null &&
      (mode === "submit" || mode === "resubmit") &&
      hasMembership,
    generationUnavailableReason: canManageReports
      ? generationUnavailableReason
      : "An Owner or Admin generates and approves reports.",
    verifierStep: deriveVerifierStep(
      remote,
      remoteUnavailable,
      hasMembership,
      hasApprovedReport,
    ),
  };
}
