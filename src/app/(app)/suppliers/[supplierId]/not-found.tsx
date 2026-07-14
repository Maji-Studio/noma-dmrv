import { EntityNotFound } from "@/components/navigation";

export default function SupplierNotFound() {
  return (
    <EntityNotFound
      title="Supplier not found"
      description="This supplier does not exist or is not available in your organization."
      backHref="/suppliers"
      backLabel="Back to suppliers"
    />
  );
}
