/**
 * Supplier Detail Page
 * Displays supplier details with nested locations management
 */
import { SupplierDetail } from "@/components/suppliers";

interface SupplierDetailPageProps {
  params: Promise<{ supplierId: string }>;
}

export default async function SupplierDetailPage({
  params,
}: SupplierDetailPageProps) {
  const { supplierId } = await params;

  return <SupplierDetail supplierId={supplierId} />;
}
