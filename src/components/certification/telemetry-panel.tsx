/**
 * TelemetryPanel - Phase 5 Slice A (ADR 0006).
 *
 * Renders a "Submit Telemetry" button + status badge on the Removal
 * detail page. The button drives the full
 * `POST /file-uploads -> PUT bytes -> POST /data-upload-submissions`
 * pipeline inside one short-lived server action (the signed upload URL
 * TTL is 5 minutes; splitting steps across user interactions is
 * brittle). The status badge surfaces the latest GET poll of
 * `data-upload-submissions/{id}`.
 *
 * The "Submit" button is disabled until the operator pastes the
 * Isometric facility ID (fcl_...) into the facility mapping - Isometric
 * exposes no POST /facilities endpoint, so it's manual one-time setup.
 */
"use client";

import {
  ArrowsClockwiseIcon,
  CloudArrowUpIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { StatusBadge, type StatusValue } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import {
  useSubmitTelemetry,
  useTelemetrySubmissionState,
} from "@/hooks/use-telemetry-submission";
import { Section } from "./panel-layout";

interface TelemetryPanelProps {
  removalId: string;
}

export function TelemetryPanel({ removalId }: TelemetryPanelProps) {
  const state = useTelemetrySubmissionState(removalId);
  const submit = useSubmitTelemetry(removalId);
  const toast = useToast();

  const onSubmit = async () => {
    try {
      const result = await submit.mutateAsync({});
      if (result.status === "failed") {
        toast.error(
          result.errorMessage ??
            "Isometric rejected the telemetry submission. Open the registry to inspect.",
        );
      } else {
        toast.success(
          `Telemetry submitted (${result.dataUploadSubmissionId}). Status: ${result.status}.`,
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Telemetry submission failed.",
      );
    }
  };

  return (
    <Section>
      <div className="flex flex-col gap-12">
        <header className="flex items-center justify-between gap-12">
          <h3 className="title-chapter-title">Reactor telemetry</h3>
          <TelemetryStatusBadge state={state.data} loading={state.isLoading} />
        </header>
        <p className="body-caption text-[var(--color-text-tertiary)]">
          Publish reactor temperature + pressure readings as Isometric
          DataUploadSubmissions. Aggregated into 60-second clock-aligned
          buckets - one file per Removal-window.
        </p>
        <div className="flex items-center gap-12">
          <Button
            variant="primary"
            onClick={onSubmit}
            disabled={submit.isPending}
          >
            <CloudArrowUpIcon size={14} weight="bold" />
            {submit.isPending ? "Submitting..." : "Submit telemetry"}
          </Button>
          <Button
            variant="noOutline"
            onClick={() => state.refetch()}
            disabled={state.isFetching}
          >
            <ArrowsClockwiseIcon size={14} />
            Refresh status
          </Button>
        </div>
        <TelemetryError state={state.data} />
      </div>
    </Section>
  );
}

type TelemetryState = ReturnType<typeof useTelemetrySubmissionState>["data"];

function TelemetryStatusBadge({
  state,
  loading,
}: {
  state: TelemetryState;
  loading: boolean;
}) {
  if (loading) return <StatusBadge status="draft" label="Loading..." />;
  if (!state) return <StatusBadge status="draft" label="Not submitted" />;
  const remote = state.latestStatus?.status;
  const local = state.submission.status;
  if (remote === "completed") {
    return <StatusBadge status="verified" label="Completed" />;
  }
  if (remote === "failed") {
    return <StatusBadge status="rejected" label="Failed" />;
  }
  if (remote === "pending") {
    return <StatusBadge status="running" label="Processing" />;
  }
  // Fall back to the local row status when the remote status was not
  // resolved (network blip, externalId not set).
  const map = mapLocalStatus(local);
  return <StatusBadge status={map.value} label={map.label} />;
}

function mapLocalStatus(
  s: NonNullable<TelemetryState>["submission"]["status"],
): { value: StatusValue; label: string } {
  switch (s) {
    case "draft":
      return { value: "draft", label: "Draft" };
    case "submitted":
      return { value: "issued", label: "Submitted" };
    case "accepted":
      return { value: "verified", label: "Accepted" };
    case "rejected":
      return { value: "rejected", label: "Rejected" };
    case "superseded":
      return { value: "draft", label: "Superseded" };
    default:
      return { value: "draft", label: s };
  }
}

function TelemetryError({ state }: { state: TelemetryState }) {
  const message = state?.latestStatus?.error_message;
  if (!message) return null;
  return (
    <div className="flex items-start gap-8 border-l-2 border-[var(--color-signal-orange)] bg-[var(--color-signal-orange-light)] p-12">
      <WarningCircleIcon
        size={16}
        weight="bold"
        className="text-[var(--color-signal-orange)] shrink-0"
      />
      <div className="flex flex-col gap-4">
        <span className="body-small-bold">Isometric error</span>
        <span className="body-caption text-[var(--color-text-secondary)]">
          {message}
        </span>
      </div>
    </div>
  );
}
