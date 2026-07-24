import { EntityNotFound } from "@/components/navigation";

export default function CreditBatchNotFound() {
  return (
    <EntityNotFound
      title="Credit batch not found"
      description="This credit batch does not exist or is not available in your organization."
      backHref="/credit-batches"
      backLabel="Back to credit batches"
    />
  );
}
