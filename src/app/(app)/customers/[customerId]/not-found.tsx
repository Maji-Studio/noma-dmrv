import { EntityNotFound } from "@/components/navigation";

export default function CustomerNotFound() {
  return (
    <EntityNotFound
      title="Customer not found"
      description="This customer does not exist or is not available in your organization."
      backHref="/customers"
      backLabel="Back to customers"
    />
  );
}
