"use client";

/**
 * The order form's delivery location block, for the read view: the saved
 * location's address, delivery route and map, inside Customer details where
 * the form shows them.
 */
import { useCustomerLocations } from "@/hooks/use-customers";
import { useFacility } from "@/hooks/use-facilities";
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
  const { data: locations } = useCustomerLocations(customerId, !!customerId);
  const { data: facility } = useFacility(facilityId, !!facilityId);
  const location = locations?.find((candidate) => candidate.id === customerLocationId);
  if (!location) return null;
  return <CustomerLocationDetails location={location} facility={facility ?? undefined} />;
}
