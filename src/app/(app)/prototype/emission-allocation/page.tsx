// PROTOTYPE (never merge): how should emissions allocation across credit batches and Removals read? Fixture data, no DB reads.
import { notFound } from "next/navigation";
import { AllocationPrototype } from "@/components/emissions/allocation-prototype/allocation-prototype";

export default async function EmissionAllocationPrototypePage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string; surface?: string; focus?: string; removals?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  return <AllocationPrototype {...params} />;
}
