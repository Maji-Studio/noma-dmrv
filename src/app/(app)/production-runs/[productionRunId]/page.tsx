import { redirect } from "next/navigation";

interface ProductionRunRedirectPageProps {
  params: Promise<{ productionRunId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ProductionRunRedirectPage({
  params,
  searchParams,
}: ProductionRunRedirectPageProps) {
  const { productionRunId } = await params;
  const sp = await searchParams;
  const nextParams = new URLSearchParams();

  for (const [key, value] of Object.entries(sp)) {
    if (key === "run") continue;
    if (Array.isArray(value)) {
      for (const entry of value) nextParams.append(key, entry);
    } else if (value !== undefined) {
      nextParams.set(key, value);
    }
  }

  nextParams.set("run", productionRunId);

  redirect(`/production-runs?${nextParams.toString()}`);
}
