/**
 * Emissions of one credit batch: its Removal template lines, where each
 * figure comes from, and the manual entries (epic #1058). Protected by the
 * requireAuth guard in the (app) layout; the batch is read through the
 * facility-scoped lines action, which refuses another organization's batch.
 */
import { notFound } from "next/navigation";
import { z } from "zod";
import { BatchEmissionsPage } from "@/components/emissions/batch-emissions-page";
import { emissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";

interface BatchEmissionsRouteProps {
  params: Promise<{ creditBatchId: string }>;
}

export default async function BatchEmissionsRoute({ params }: BatchEmissionsRouteProps) {
  const { creditBatchId } = await params;
  if (!z.uuid().safeParse(creditBatchId).success) notFound();
  return <BatchEmissionsPage creditBatchId={creditBatchId.toLowerCase()} entriesEnabled={emissionsEntriesEnabled()} />;
}
