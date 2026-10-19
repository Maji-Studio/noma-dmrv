/**
 * Emissions overview: every credit batch of the facility with the state of
 * its Removal template's lines, plus the facility's recorded activity behind
 * a disclosure (epic #1058). Protected by the requireAuth guard in the (app)
 * layout.
 */
import { EmissionsOverview } from "@/components/emissions";
import { emissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";

export default function EmissionsRoute() {
  return <EmissionsOverview entriesEnabled={emissionsEntriesEnabled()} />;
}
