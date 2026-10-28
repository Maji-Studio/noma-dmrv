import Link from "next/link";

interface StockReconciliationLinkProps {
  facilityId?: string | null;
}

export function StockReconciliationLink({
  facilityId,
}: StockReconciliationLinkProps) {
  const href = facilityId
    ? `/storage-bins?facility=${encodeURIComponent(facilityId)}`
    : "/storage-bins";

  return (
    <p className="mt-8 body-caption">
      <Link
        href={href}
        className="font-medium text-[var(--color-interaction)] underline underline-offset-2"
      >
        Open bin reconciliation
      </Link>
    </p>
  );
}
