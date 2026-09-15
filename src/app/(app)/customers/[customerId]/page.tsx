/**
 * Customer Detail Page
 * Displays customer details with nested locations management
 */
import { CustomerDetail } from "@/components/customers";
import { findCustomerWithRelations } from "@/data-access/customer-detail";
import { customerKeys } from "@/hooks/customer-query-keys";
import { requireOrgContext } from "@/lib/auth/server";
import { createServerHydrationState } from "@/lib/react-query/server-hydration";
import { HydrationBoundary } from "@tanstack/react-query";
import { notFound } from "next/navigation";
import { z } from "zod";

interface CustomerDetailPageProps {
  params: Promise<{ customerId: string }>;
}

export default async function CustomerDetailPage({
  params,
}: CustomerDetailPageProps) {
  const { customerId } = await params;

  if (!z.uuid().safeParse(customerId).success) {
    notFound();
  }

  const ctx = await requireOrgContext();
  const customer = await findCustomerWithRelations(ctx, customerId);

  if (!customer) {
    notFound();
  }

  const hydrationState = createServerHydrationState([
    {
      queryKey: customerKeys.detailWithRelations(customerId),
      data: customer,
    },
  ]);

  return (
    <HydrationBoundary state={hydrationState}>
      <CustomerDetail customerId={customerId} />
    </HydrationBoundary>
  );
}
