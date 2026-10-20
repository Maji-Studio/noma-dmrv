/** PROTOTYPE (#1276) variant B: the dedicated Removal template setup page. Not for merge. */
import { Suspense } from "react";
import { VariantBPage } from "@/components/certification/template-setup-proto/variant-b";

export default async function RemovalTemplateSetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const step = typeof params.step === "string" ? params.step : null;
  return (
    <Suspense>
      <VariantBPage initialStep={step} />
    </Suspense>
  );
}
