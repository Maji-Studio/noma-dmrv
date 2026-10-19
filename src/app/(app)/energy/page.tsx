/**
 * Energy became Emissions (epic #1058, plan §4.4). Old links land on the
 * Emissions overview with their query kept; the facility activity they used
 * to show sits behind its "Facility activity" disclosure there.
 */
import { redirect } from "next/navigation";

interface EnergyRedirectPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function EnergyRedirectPage({ searchParams }: EnergyRedirectPageProps) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, entry);
    }
  }
  const query = params.toString();
  redirect(`/emissions${query ? `?${query}` : ""}`);
}
