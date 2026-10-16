/**
 * PROTOTYPE route (throwaway branch `prototype/emissions-variants`): one
 * credit batch's template lines, three variants behind `?variant=A|B|C`.
 * Hidden in production builds.
 */
import { notFound } from "next/navigation";
import { EmissionsPrototype } from "@/components/emissions";

interface EmissionsBatchPrototypeRouteProps {
  params: Promise<{ creditBatchId: string }>;
}

export default async function EmissionsBatchPrototypeRoute({ params }: EmissionsBatchPrototypeRouteProps) {
  if (process.env.NODE_ENV === "production") notFound();
  const { creditBatchId } = await params;
  return <EmissionsPrototype creditBatchId={creditBatchId} />;
}
