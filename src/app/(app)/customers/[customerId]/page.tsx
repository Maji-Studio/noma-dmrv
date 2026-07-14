/**
 * Customer Detail Page
 * Displays customer details with nested locations management
 */
import { CustomerDetail } from "@/components/customers";
import { getCustomerById } from "@/data-access/entities/customers";
import { requireOrgContext } from "@/lib/auth/server";
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
  const customer = await getCustomerById(ctx, customerId);

  if (!customer) {
    notFound();
  }

  return <CustomerDetail customerId={customerId} />;
}
