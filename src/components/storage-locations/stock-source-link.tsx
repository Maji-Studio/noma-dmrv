import Link from "next/link";
import { deliveryDeepLinkHref } from "@/lib/delivery-links";
import { applicationDeepLinkHref } from "@/lib/application-links";

const SOURCES = {
  feedstock: { path: "/feedstocks", label: "feedstock intake" },
  productionRun: { path: "/production-runs", label: "production run" },
  biocharProduct: { path: "/biochar-products", label: "biochar product" },
  delivery: { path: "/deliveries", label: "delivery" },
  application: { path: "/applications", label: "application" },
} as const;

export interface StockSource { entity: keyof typeof SOURCES; id: string }

export function stockSourceHref(source: StockSource, facilityId: string): string {
  if (source.entity === "delivery") return deliveryDeepLinkHref(source.id, facilityId);
  if (source.entity === "application") return applicationDeepLinkHref(source.id, facilityId);
  if (source.entity === "productionRun") return `/production-runs/${encodeURIComponent(source.id)}`;
  return `${SOURCES[source.entity].path}?${new URLSearchParams({ facility: facilityId, [source.entity]: source.id })}`;
}

/** Lost mass and old counts have no source form and deliberately have no link. */
export function StockSourceLink({ source, facilityId }: { source?: StockSource | null; facilityId: string }) {
  if (!source) return null;
  return <Link className="inline-flex min-h-44 items-center self-start body-caption underline underline-offset-4" href={stockSourceHref(source, facilityId)}>
    Open {SOURCES[source.entity].label}
  </Link>;
}
