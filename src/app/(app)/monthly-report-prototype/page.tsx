/**
 * PROTOTYPE (throwaway, never merges): Monthly facility report, issues #1109
 * and #1110. Sub-shape B: a new route inside the app shell, three variants
 * switched by ?variant=A|B|C, ?state=empty for the empty month. In-memory
 * fixture only, no data access.
 */
import { notFound } from "next/navigation";
import { PrototypeSwitcher } from "./switcher";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";

export default async function MonthlyReportPrototypePage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string; state?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { variant = "A", state } = await searchParams;
  const empty = state === "empty";
  return (
    <>
      {variant === "A" && <VariantA empty={empty} />}
      {variant === "B" && <VariantB empty={empty} />}
      {variant === "C" && <VariantC empty={empty} />}
      <PrototypeSwitcher current={variant} empty={empty} />
    </>
  );
}
