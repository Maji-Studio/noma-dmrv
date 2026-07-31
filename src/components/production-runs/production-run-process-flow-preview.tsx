import { formatMassKg } from "@/lib/format-utils";

export function ProcessFlowPreview({
  sourceBinName,
  feedstockKg,
  feedstockDryKg,
  reactorName,
  biocharKg,
  biocharDryKg,
  destinationBinName,
}: {
  sourceBinName: string | null;
  feedstockKg: number | null;
  feedstockDryKg: number | null;
  reactorName: string | null;
  biocharKg: number | null;
  biocharDryKg: number | null;
  destinationBinName: string | null;
}) {
  const hasSource = !!sourceBinName;
  const hasFeedstock = feedstockKg !== null && feedstockKg > 0;
  const hasReactor = !!reactorName;
  const hasBiochar = biocharKg !== null && biocharKg > 0;
  const hasDestination = !!destinationBinName;

  if (!hasSource && !hasReactor && !hasDestination) return null;

  const useDry = feedstockDryKg !== null && biocharDryKg !== null;
  const yieldPercent =
    hasFeedstock && hasBiochar
      ? useDry
        ? feedstockDryKg > 0
          ? ((biocharDryKg! / feedstockDryKg!) * 100).toFixed(1)
          : null
        : feedstockKg > 0
          ? ((biocharKg / feedstockKg) * 100).toFixed(1)
          : null
      : null;

  // Pick one basis for the whole equation. If either dry value is unresolved,
  // show both sides on their authoritative wet basis and name the dry gap.
  const feedstockMassKg = useDry ? feedstockDryKg : feedstockKg;
  const feedstockMassLabel = useDry ? "Dry feedstock" : "Wet feedstock";
  const biocharMassKg = useDry ? biocharDryKg : biocharKg;
  const biocharMassLabel = useDry ? "Dry biochar" : "Wet biochar";

  return (
    <div className="grid grid-cols-1 items-stretch gap-6 text-left sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-8">
      <div
        role="group"
        aria-label="Process input"
        className={`border px-12 py-10 flex flex-col justify-center transition-colors ${
          hasSource
            ? "border-[var(--color-border-primary)] bg-[var(--color-background-medium)]"
            : "border-dashed border-[var(--color-border-tertiary)] bg-transparent"
        }`}
      >
        {hasSource ? (
          <>
            <p className="body-caption text-[var(--color-text-tertiary)]">
              Input ·{" "}
              <span className="text-[var(--color-text-secondary)]">
                {sourceBinName}
              </span>
            </p>
            {hasFeedstock && feedstockMassKg !== null && (
              <p className="body-small text-[var(--color-text-primary)] mt-6">
                {feedstockMassLabel}:{" "}
                <span className="font-medium">
                  {formatMassKg(feedstockMassKg)}
                </span>
              </p>
            )}
            {!useDry && hasFeedstock && feedstockDryKg === null && (
              <p className="body-caption text-[var(--color-text-tertiary)] mt-2">
                Feedstock dry mass not recorded.
              </p>
            )}
          </>
        ) : (
          <>
            <span className="body-caption text-[var(--color-text-tertiary)]">
              Input
            </span>
            <span className="body-small text-[var(--color-text-tertiary)] mt-2">
              Select bin
            </span>
          </>
        )}
      </div>

      <FlowPreviewArrow />

      <div
        role="group"
        aria-label="Reactor"
        className={`border px-12 py-10 flex flex-col justify-center transition-colors ${
          hasReactor
            ? "border-[var(--color-border-primary)] bg-[var(--color-background-medium)]"
            : "border-dashed border-[var(--color-border-tertiary)] bg-transparent"
        }`}
      >
        <span className="body-caption text-[var(--color-text-tertiary)]">
          Reactor
        </span>
        {hasReactor ? (
          <span className="body-small font-medium text-[var(--color-text-primary)] mt-2">
            {reactorName}
          </span>
        ) : (
          <span className="body-small text-[var(--color-text-tertiary)]">
            Select reactor
          </span>
        )}
        {yieldPercent && (
          <span className="body-small text-[var(--color-text-secondary)] mt-6">
            {useDry ? "Dry" : "Wet"} yield:{" "}
            <span className="font-medium">{yieldPercent}%</span>
          </span>
        )}
      </div>

      <FlowPreviewArrow />

      <div
        role="group"
        aria-label="Process output"
        className={`border px-12 py-10 flex flex-col justify-center transition-colors ${
          hasDestination
            ? "border-[var(--color-border-primary)] bg-[var(--color-background-medium)]"
            : "border-dashed border-[var(--color-border-tertiary)] bg-transparent"
        }`}
      >
        {hasDestination ? (
          <>
            <p className="body-caption text-[var(--color-text-tertiary)]">
              Output ·{" "}
              <span className="text-[var(--color-text-secondary)]">
                {destinationBinName}
              </span>
            </p>
            {hasBiochar && biocharMassKg !== null && (
              <p className="body-small text-[var(--color-text-primary)] mt-6">
                {biocharMassLabel}:{" "}
                <span className="font-medium">
                  {formatMassKg(biocharMassKg)}
                </span>
              </p>
            )}
            {!useDry && hasBiochar && biocharDryKg === null && (
              <p className="body-caption text-[var(--color-text-tertiary)] mt-2">
                Biochar dry mass not recorded.
              </p>
            )}
          </>
        ) : (
          <>
            <span className="body-caption text-[var(--color-text-tertiary)]">
              Output
            </span>
            <span className="body-small text-[var(--color-text-tertiary)] mt-2">
              Select bin
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function FlowPreviewArrow() {
  return (
    <div
      aria-hidden="true"
      className="flex items-center justify-center py-2 sm:px-2 sm:py-0"
    >
      <svg
        width="24"
        height="16"
        viewBox="0 0 24 16"
        fill="none"
        className="rotate-90 text-[var(--color-text-tertiary)] sm:rotate-0"
      >
        <path
          d="M0 8H18M18 8L13 3M18 8L13 13"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
