/**
 * Supplier Detail Page
 * Displays supplier details with nested locations management
 */
import { SupplierDetail } from "@/components/suppliers";
import { findSupplierDetail } from "@/data-access/supplier-detail";
import { supplierKeys } from "@/hooks/supplier-query-keys";
import { requireOrgContext } from "@/lib/auth/server";
import { createServerHydrationState } from "@/lib/react-query/server-hydration";
import { HydrationBoundary } from "@tanstack/react-query";
import { notFound } from "next/navigation";
import { z } from "zod";

interface SupplierDetailPageProps {
  params: Promise<{ supplierId: string }>;
}

export default async function SupplierDetailPage({
  params,
}: SupplierDetailPageProps) {
  const { supplierId } = await params;

  if (!z.uuid().safeParse(supplierId).success) {
    notFound();
  }

  const ctx = await requireOrgContext();
  const detail = await findSupplierDetail(ctx, supplierId);

  if (!detail) {
    notFound();
  }

  const hydrationState = createServerHydrationState([
    {
      queryKey: supplierKeys.detail(supplierId),
      data: detail.supplier,
    },
    {
      queryKey: supplierKeys.supplierLocations(supplierId),
      data: detail.locations,
    },
  ]);

  return (
    <HydrationBoundary state={hydrationState}>
      <SupplierDetail supplierId={supplierId} />
    </HydrationBoundary>
  );
}
