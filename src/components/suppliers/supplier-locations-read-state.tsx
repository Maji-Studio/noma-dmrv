import { Button } from "@/components/ui";

interface SupplierLocationsReadStateProps {
  isPending: boolean;
  isError: boolean;
  isRetrying: boolean;
  onRetry: () => void;
}

export function SupplierLocationsReadState({
  isPending,
  isError,
  isRetrying,
  onRetry,
}: SupplierLocationsReadStateProps) {
  if (isError) {
    return (
      <div
        className="flex flex-col gap-10 border border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] px-12 py-10 sm:flex-row sm:items-center sm:justify-between"
        role="alert"
      >
        <span className="body-caption text-[var(--color-text-secondary)]">
          Supplier locations unavailable. Retry to load saved locations.
        </span>
        <Button
          variant="weak"
          size="small"
          busy={isRetrying}
          onClick={onRetry}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (isPending) {
    return (
      <span
        className="body-caption text-[var(--color-text-tertiary)]"
        aria-busy="true"
      >
        Loading supplier locations…
      </span>
    );
  }

  return null;
}
