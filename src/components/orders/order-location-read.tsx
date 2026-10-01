"use client";

/**
 * The order form's delivery location block, for the read view: the saved
 * location's address, delivery route and map, inside Customer details where
 * the form shows them.
 */
import { useCustomerLocations } from "@/hooks/use-customers";
import { useFacility } from "@/hooks/use-facilities";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { CustomerLocationDetails } from "./customer-location-details";

export function OrderLocationRead({
  customerId,
  customerLocationId,
  facilityId,
}: {
  customerId: string;
  customerLocationId: string;
  facilityId: string;
}) {
  const { data: locations, isLoading } = useCustomerLocations(customerId, !!customerId);
  const { data: facility } = useFacility(facilityId, !!facilityId);
  // Loading is not absence: hold the block's place until the locations settle.
  if (isLoading) {
    return (
      <div className="space-y-8" aria-label="Loading delivery location">
        <Skeleton className="h-16 w-1/2" />
        <Skeleton className="h-12 w-2/3" />
      </div>
    );
  }
  const location = locations?.find((candidate) => candidate.id === customerLocationId);
  if (!location) return null;
  return <CustomerLocationDetails location={location} facility={facility ?? undefined} />;
}
