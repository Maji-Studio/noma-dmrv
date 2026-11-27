import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { storageLocations } from "@/db/schema";

/** A real biochar destination for fixtures with terminal production runs. */
export async function createProductionRunOutputBin(organizationId: string, facilityId: string, uncarbonized = false): Promise<string> {
  const tag = randomUUID();
  const [bin] = await db.insert(storageLocations).values({
    organizationId, facilityId, code: `E2E-OUT-${tag}`,
    name: `E2E Run output ${tag}`, type: "biochar_bin", uncarbonized,
  }).returning({ id: storageLocations.id });
  return bin.id;
}
