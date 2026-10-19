/**
 * PROTOTYPE (throwaway, never merges): Monthly facility report, issues #1109
 * and #1110. Sub-shape B: a new route inside the app shell, three variants
 * switched by ?variant=A|B|C, ?state=empty for the empty month. In-memory
 * fixture only, no data access.
 */
import { notFound } from "next/navigation";
import { PrototypeSwitcher } from "./switcher";
import { VariantA } from "./variant-a";
import { parseState } from "./report";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";

export default async function MonthlyReportPrototypePage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string; state?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { variant = "A", state } = await searchParams;
  const monthState = parseState(state);
  const empty = monthState === "empty";
  return (
    <>
      {variant === "A" && <VariantA state={monthState} />}
      {variant === "B" && <VariantB empty={empty} />}
      {variant === "C" && <VariantC empty={empty} />}
      <PrototypeSwitcher current={variant} state={monthState} />
    </>
  );
}
