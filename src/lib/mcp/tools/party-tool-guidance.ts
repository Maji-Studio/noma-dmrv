import { PARTY_MAX_LOCATIONS } from "@/config/party-input";
import { REQUEST_KEY_RULE, UNTRUSTED_TEXT } from "@/lib/operations/agent-guidance";

type Party = "supplier" | "customer";
type Command = "create" | "update" | "delete" | "archive" | "restore";
const pastTense = { create: "Created", update: "Updated", delete: "Deleted", archive: "Archived", restore: "Restored" };

export function partyToolDescription(kind: Party, command: Command): string {
  const descriptions = {
    create: `Create one ${kind} with a generated code and 1 to ${PARTY_MAX_LOCATIONS} locations. Coordinates are required for each location; ask for missing coordinates.`,
    update: `Update a ${kind} by UUID. Send only what changes; omitted fields stay unchanged and null clears optional fields. Locations stay unchanged.`,
    delete: `Delete a ${kind} by UUID and its locations. ${kind === "supplier" ? "Feedstock intakes" : "Orders or registered storage sites"} prevent deletion. An unused archived ${kind} can be deleted. Returns deleted id and code, or data on a dry run.`,
    archive: `Archive a ${kind} by UUID. Existing records keep it; new references cannot use it.`,
    restore: `Restore an archived ${kind} by UUID so it can be selected and edited again.`,
  };
  return `${descriptions[command]} Search find_${kind}s (${kind}s:read) first and do not create a duplicate. Names are unique per organization, case and whitespace insensitive. Use the returned UUID and version as ${kind}Id and expectedVersion for changes. Archived parties are hidden unless archived: true. Restore before editing or reusing. ${REQUEST_KEY_RULE} ${UNTRUSTED_TEXT}`;
}

export function partyToolSummary(kind: Party, command: Command, row: { code: string; version?: number }, dryRun: boolean): string {
  return dryRun ? `Dry run: would ${command} ${kind} ${row.code}${command === "create" ? " (provisional code)" : ""}.`
    : `${pastTense[command]} ${kind} ${row.code}${command === "delete" ? "" : ` (version ${row.version})`}.`;
}
