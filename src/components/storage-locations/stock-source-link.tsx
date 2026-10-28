import { recordHref } from "@/lib/record-links";
import Link from "next/link";

const SOURCES = {
  feedstock: { label: "feedstock intake" },
  productionRun: { label: "production run" },
  biocharProduct: { label: "biochar product" },
  delivery: { label: "delivery" },
  application: { label: "application" },
} as const;

export interface StockSource { entity: keyof typeof SOURCES; id: string }

export function stockSourceHref(source: StockSource, facilityId: string): string {
  return recordHref(source.entity, source.id, { facilityId });
}

/** Lost mass and old counts have no source form and deliberately have no link. */
export function StockSourceLink({ source, facilityId }: { source?: StockSource | null; facilityId: string }) {
  if (!source) return null;
  return <Link className="inline-flex min-h-44 items-center self-start body-caption underline underline-offset-4" href={stockSourceHref(source, facilityId)}>
    Open {SOURCES[source.entity].label}
  </Link>;
}
