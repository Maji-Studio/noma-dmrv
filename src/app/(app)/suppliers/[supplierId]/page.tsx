/**
 * Supplier Detail Page
 * Displays supplier details with nested locations management
 */
import { SupplierDetail } from "@/components/suppliers";
import { getSupplierById } from "@/data-access/entities/suppliers";
import { requireOrgContext } from "@/lib/auth/server";
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
  const supplier = await getSupplierById(ctx, supplierId);

  if (!supplier) {
    notFound();
  }

  return <SupplierDetail supplierId={supplierId} />;
}
