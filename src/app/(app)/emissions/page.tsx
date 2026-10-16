/**
 * PROTOTYPE route (throwaway branch `prototype/emissions-variants`): the
 * Emissions overview, three variants behind `?variant=A|B|C`. Hidden in
 * production builds. Protected by the requireAuth guard in the (app) layout.
 */
import { notFound } from "next/navigation";
import { EmissionsPrototype } from "@/components/emissions";

export default function EmissionsPrototypeRoute() {
  if (process.env.NODE_ENV === "production") notFound();
  return <EmissionsPrototype />;
}
