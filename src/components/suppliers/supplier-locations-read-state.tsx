import { Button } from "@/components/ui";
import { Notice } from "@/components/ui/notice";

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
      <Notice
        tone="warning"
        action={
          <Button
            variant="weak"
            size="small"
            busy={isRetrying}
            onClick={onRetry}
          >
            Retry
          </Button>
        }
      >
        Supplier locations unavailable. Retry to load saved locations.
      </Notice>
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
