import {
  CheckCircleIcon,
  CircleIcon,
  CircleNotchIcon,
  MinusCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import {
  GHG_STATEMENT_PROGRESS_STEPS,
  REMOVAL_PROGRESS_STEPS,
  type SubmissionProgressStep,
  type SubmissionProgressUpdate,
} from "@/lib/certification/submission-progress";

const PROGRESS_ICON_SIZE = 20;

type ProgressKind = "removal" | "ghg_statement";
type DisplayState =
  | "active"
  | "complete"
  | "failed"
  | "reused"
  | "skipped"
  | "upcoming";

const STATE_LABELS: Record<DisplayState, string> = {
  active: "In progress",
  complete: "Complete",
  failed: "Failed",
  reused: "Already sent",
  skipped: "Not required",
  upcoming: "Waiting",
};

const STEP_COPY: Record<
  SubmissionProgressStep,
  { title: string; detail: string }
> = {
  "removal.checking_data": {
    title: "Checking submission data",
    detail:
      "Confirming the reviewed data and registry settings are still current.",
  },
  "removal.preparing_evidence": {
    title: "Preparing supporting evidence",
    detail:
      "Generating evidence summaries and copying selected files to Isometric.",
  },
  "removal.sending_inputs": {
    title: "Sending monitored inputs",
    detail: "Submitting the values used to calculate this Removal.",
  },
  "removal.sending_durability": {
    title: "Sending durability measurements",
    detail:
      "Attaching the durability evidence required by the Removal template.",
  },
  "removal.creating": {
    title: "Creating Removal in Isometric",
    detail: "Creating the registry record from the confirmed inputs.",
  },
  "removal.verifying_evidence": {
    title: "Checking evidence links",
    detail: "Checking that registry values link to their supporting evidence.",
  },
  "removal.complete": {
    title: "Submission complete",
    detail: "The Removal is ready to open in Isometric.",
  },
  "ghg_statement.checking": {
    title: "Checking statement and report",
    detail:
      "Confirming the statement contains Removals and the approved report is current.",
  },
  "ghg_statement.preparing_report": {
    title: "Preparing verifier document",
    detail:
      "Creating the controlled report link and recording the submitted document.",
  },
  "ghg_statement.sending": {
    title: "Sending to the verifier",
    detail: "Waiting for Isometric to accept the GHG Statement.",
  },
  "ghg_statement.confirming": {
    title: "Confirming registry response",
    detail: "Saving the verifier status and submitted report details in noma.",
  },
  "ghg_statement.complete": {
    title: "Submission complete",
    detail: "The GHG Statement is awaiting verification.",
  },
};

function stepSequence(kind: ProgressKind): readonly SubmissionProgressStep[] {
  return kind === "removal"
    ? REMOVAL_PROGRESS_STEPS
    : GHG_STATEMENT_PROGRESS_STEPS;
}

function latestUpdates(
  updates: SubmissionProgressUpdate[],
): Map<SubmissionProgressStep, SubmissionProgressUpdate> {
  return new Map(updates.map((update) => [update.step, update]));
}

function failedStep(
  steps: readonly SubmissionProgressStep[],
  latest: Map<SubmissionProgressStep, SubmissionProgressUpdate>,
): SubmissionProgressStep | null {
  if (latest.size === 0) return null;
  return (
    steps.find((step) => latest.get(step)?.state === "active") ??
    steps.find((step) => !latest.has(step)) ??
    steps[steps.length - 1]
  );
}

export function canRetrySubmissionProgress(
  kind: ProgressKind,
  updates: SubmissionProgressUpdate[],
): boolean {
  // This helper is called only for a terminal error returned by the server.
  // The claim/reconciliation layers decide whether the next request resumes,
  // returns an existing result, or stays blocked. Dialogs separately exclude
  // stalled streams because their original server request may still be live.
  void kind;
  void updates;
  return true;
}

function displayState(
  step: SubmissionProgressStep,
  update: SubmissionProgressUpdate | undefined,
  failed: SubmissionProgressStep | null,
): DisplayState {
  if (step === failed) return "failed";
  return update?.state ?? "upcoming";
}

function ProgressIcon({ state }: { state: DisplayState }) {
  if (state === "complete" || state === "reused") {
    return (
      <CheckCircleIcon
        size={PROGRESS_ICON_SIZE}
        weight="fill"
        aria-hidden
        className="shrink-0 text-[var(--st-ok)]"
      />
    );
  }
  if (state === "active") {
    return (
      <CircleNotchIcon
        size={PROGRESS_ICON_SIZE}
        weight="bold"
        aria-hidden
        className="shrink-0 animate-spin text-[var(--st-run)]"
      />
    );
  }
  if (state === "failed") {
    return (
      <XCircleIcon
        size={PROGRESS_ICON_SIZE}
        weight="fill"
        aria-hidden
        className="shrink-0 text-[var(--st-bad)]"
      />
    );
  }
  if (state === "skipped") {
    return (
      <MinusCircleIcon
        size={PROGRESS_ICON_SIZE}
        weight="fill"
        aria-hidden
        className="shrink-0 text-[var(--st-off)]"
      />
    );
  }
  return (
    <CircleIcon
      size={PROGRESS_ICON_SIZE}
      aria-hidden
      className="shrink-0 text-[var(--st-off)]"
    />
  );
}

export function SubmissionProgress({
  kind,
  updates,
  error = null,
  stalled = false,
}: {
  kind: ProgressKind;
  updates: SubmissionProgressUpdate[];
  error?: string | null;
  stalled?: boolean;
}) {
  const steps = stepSequence(kind);
  const latest = latestUpdates(updates);
  const failed = error && !stalled ? failedStep(steps, latest) : null;
  const active = steps.find((step) => latest.get(step)?.state === "active");
  const terminal = steps[steps.length - 1];
  const liveStep =
    failed ??
    active ??
    (latest.get(terminal)?.state === "complete" ? terminal : steps[0]);
  const liveCopy = STEP_COPY[liveStep].title;
  const statusCopy = stalled
    ? active
      ? `Progress updates stopped during ${liveCopy.toLowerCase()}.`
      : "Progress updates stopped."
    : error
    ? failed
      ? `${liveCopy} failed.`
      : "Submission failed before progress started."
    : liveCopy;

  return (
    <div className="flex flex-col gap-12">
      <span className="sr-only" role="status">
        {statusCopy}
      </span>
      <ol aria-label="Submission progress">
        {steps.map((step, index) => {
          const update = latest.get(step);
          const state = displayState(step, update, failed);
          const copy = STEP_COPY[step];
          const count =
            update?.total !== undefined && update.total > 0
              ? `${update.completed ?? 0} of ${update.total}`
              : state === "reused"
                ? "Already sent"
                : state === "skipped"
                  ? "Not required"
                  : null;
          return (
            <li key={step} className="flex gap-12">
              <span className="sr-only">{STATE_LABELS[state]}. </span>
              <div className="flex shrink-0 flex-col items-center">
                <ProgressIcon state={state} />
                {index < steps.length - 1 && (
                  <span
                    aria-hidden
                    className={`my-4 min-h-16 w-px grow ${
                      state === "complete" || state === "reused"
                        ? "bg-[var(--st-ok-border)]"
                        : "bg-[var(--color-border-tertiary)]"
                    }`}
                  />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2 pb-16">
                <div className="flex flex-wrap items-baseline gap-8">
                  <span
                    className={`body-small font-medium ${
                      state === "upcoming"
                        ? "text-[var(--color-text-tertiary)]"
                        : "text-[var(--color-text-primary)]"
                    }`}
                  >
                    {copy.title}
                  </span>
                  {count && (
                    <span className="body-caption text-[var(--color-text-tertiary)]">
                      {count}
                    </span>
                  )}
                </div>
                <span className="body-caption text-[var(--color-text-tertiary)]">
                  {state === "reused"
                    ? "This step was completed in an earlier submission attempt."
                    : state === "skipped"
                      ? "This step is not needed for this submission."
                      : copy.detail}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
