"use client";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useMatchingOutputBins } from "@/hooks/use-output-stock";
import { formatMassKg } from "@/lib/format-utils";
import { PackageIcon } from "@phosphor-icons/react/dist/ssr";

export function MatchingOutputBins({ facilityId, formulationId }: { facilityId: string; formulationId: string }) {
  const bins = useMatchingOutputBins(facilityId, formulationId);
  if (!formulationId) return null;
  return <section className="space-y-12" aria-label="Matching storage bins">
    <p className="body-small">Orders do not reserve stock. Choose the actual source bin when recording the completed delivery.</p>
    {bins.isLoading && <p role="status">Loading matching bins...</p>}
    {bins.error && <p role="alert">{bins.error.message}</p>}
    {bins.data?.length === 0 && <EmptyState icon={<PackageIcon size={32} />} title="No matching stock" description="You can save this order now and record its delivery when stock is available." padding="sm" />}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-12">
      {bins.data?.map(bin => <Card.Root role="article" key={bin.id} className="p-12 space-y-4">
        <h4 className="body-small font-semibold">{bin.name}</h4>
        <p className="body-medium">{formatMassKg(bin.dryMassKg)} dry biochar available</p>
        <p className="body-caption">Wet availability depends on measured departure moisture.</p>
      </Card.Root>)}
    </div>
  </section>;
}
