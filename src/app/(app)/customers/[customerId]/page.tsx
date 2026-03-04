/**
 * Customer Detail Page
 * Displays customer details with nested locations management
 */
import { CustomerDetail } from "@/components/customers";

interface CustomerDetailPageProps {
  params: Promise<{ customerId: string }>;
}

export default async function CustomerDetailPage({
  params,
}: CustomerDetailPageProps) {
  const { customerId } = await params;

  return <CustomerDetail customerId={customerId} />;
}
