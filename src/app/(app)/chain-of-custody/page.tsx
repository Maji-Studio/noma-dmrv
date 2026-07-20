import { redirect } from "next/navigation";

type LegacyTraceabilityPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Preserve old bookmarks while keeping Traceability as the canonical URL. */
export default async function LegacyTraceabilityPage({
  searchParams,
}: LegacyTraceabilityPageProps) {
  const params = new URLSearchParams();
  const values = await searchParams;

  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => params.append(key, entry));
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  redirect(query ? `/traceability?${query}` : "/traceability");
}
