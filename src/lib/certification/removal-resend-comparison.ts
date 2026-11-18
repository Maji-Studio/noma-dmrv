import { z } from "zod";
import { isRegistryMissingSubmission } from "./removal-registry-presence";

const inputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("monitored"), rtcId: z.string(), inputKey: z.string(), value: z.number().finite(), unit: z.string() }),
  z.object({ kind: z.literal("fixed"), rtcId: z.string(), inputKey: z.string(), preboundDatapointId: z.string() }),
]);
const semanticSchema = z.object({ inputs: z.array(inputSchema) });
export interface RemovalResendComparisonLine {
  componentId: string;
  inputKey: string;
  previous: { value: number; unit: string } | null;
  current: { value: number; unit: string } | null;
}
export interface RemovalResendComparison {
  previousVersion: number;
  /** Null means the snapshot is unavailable; [] means no monitored inputs. */
  lines: RemovalResendComparisonLine[] | null;
}

/** Compare numeric submitted inputs, retaining units and added/removed lines.
 * Fixed inputs have registry identities, not locally stored numeric values.
 */
export function buildRemovalResendComparison(
  previous: { status: string; version: number; externalId: string | null; metadata: unknown; payloadSnapshot: unknown } | null,
  currentSemantic: unknown,
): RemovalResendComparison | null {
  if (!previous || !isRegistryMissingSubmission(previous)) return null;
  const snapshot = z.object({ semantic: semanticSchema }).safeParse(previous.payloadSnapshot);
  const current = semanticSchema.safeParse(currentSemantic);
  if (!snapshot.success || !current.success) return { previousVersion: previous.version, lines: null };
  const lines = new Map<string, RemovalResendComparisonLine>();
  for (const [side, semantic] of [["previous", snapshot.data.semantic], ["current", current.data]] as const) {
    for (const input of semantic.inputs) {
      if (input.kind !== "monitored") continue;
      const key = JSON.stringify([input.rtcId, input.inputKey]);
      const line = lines.get(key) ?? { componentId: input.rtcId, inputKey: input.inputKey, previous: null, current: null };
      line[side] = { value: input.value, unit: input.unit };
      lines.set(key, line);
    }
  }
  return { previousVersion: previous.version, lines: [...lines.values()] };
}
