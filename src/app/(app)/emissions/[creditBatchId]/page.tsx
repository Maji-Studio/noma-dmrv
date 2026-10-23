/**
 * Emissions of one credit batch: its Removal template components, where each
 * figure comes from, and the manual entries (epic #1058). Protected by the
 * requireAuth guard in the (app) layout; the batch is read through the
 * facility-scoped lines action, which refuses another organization's batch.
 */
import { notFound } from "next/navigation";
import { z } from "zod";
import { BatchEmissionsPage } from "@/components/emissions";
import { TemplatePermissionProvider } from "@/components/emissions/template-permission";
import { requireOrgContext } from "@/lib/auth/server";

interface BatchEmissionsRouteProps {
  params: Promise<{ creditBatchId: string }>;
}

export default async function BatchEmissionsRoute({ params }: BatchEmissionsRouteProps) {
  const { creditBatchId } = await params;
  if (!z.uuid().safeParse(creditBatchId).success) notFound();
  const ctx = await requireOrgContext();
  return (
    <TemplatePermissionProvider canManage={ctx.isPlatformAdmin || ctx.orgRole === "admin"}>
      <BatchEmissionsPage creditBatchId={creditBatchId.toLowerCase()} />
    </TemplatePermissionProvider>
  );
}
