import { PARTY_MAX_LOCATIONS } from "@/config/party-input";
import { REQUEST_KEY_RULE, UNTRUSTED_TEXT } from "@/lib/operations/agent-guidance";

type Party = "supplier" | "customer";
type Command = "create" | "update" | "delete" | "archive" | "restore";
const pastTense = { create: "Created", update: "Updated", delete: "Deleted", archive: "Archived", restore: "Restored" };

export function partyToolDescription(kind: Party, command: Command): string {
  const descriptions = {
    create: `Create one ${kind} with a generated code and 1 to ${PARTY_MAX_LOCATIONS} locations. Coordinates are required for each location; ask for missing coordinates.`,
    update: `Update a ${kind} by UUID. Send only what changes; omitted fields stay unchanged and null clears optional fields. Locations stay unchanged.`,
    delete: kind === "supplier"
      ? "Delete a supplier by UUID and its locations. Feedstock intakes prevent deletion. An unused archived supplier can be deleted. Returns deleted id and code, or data on a dry run."
      : "Delete a customer by UUID and its locations. Orders without deliveries, archived orders included, are deleted with it and cannot be restored. Deliveries on its orders or registered storage sites prevent deletion. Run a dry run first, show the user the listed orders, then pass its cascadeFingerprint. Returns customer data, cascade details and any warnings on success and dry run.",
    archive: `Archive a ${kind} by UUID. Existing records keep it; new references cannot use it.`,
    restore: `Restore an archived ${kind} by UUID so it can be selected and edited again.`,
  };
  return `${descriptions[command]} Search find_${kind}s (${kind}s:read) first and do not create a duplicate. Names are unique per organization, case and whitespace insensitive. Use the returned UUID and version as ${kind}Id and expectedVersion for changes. Archived parties are hidden unless archived: true. Restore before editing or reusing. ${REQUEST_KEY_RULE} ${UNTRUSTED_TEXT}`;
}

export function partyToolSummary(kind: Party, command: Command, row: { code: string; version?: number }, dryRun: boolean): string {
  return dryRun ? `Dry run: would ${command} ${kind} ${row.code}${command === "create" ? " (provisional code)" : ""}.`
    : `${pastTense[command]} ${kind} ${row.code}${command === "delete" ? "" : ` (version ${row.version})`}.`;
}

export type LocationCommand = "add" | "update" | "delete" | "archive" | "restore";

export function locationToolDescription(kind: Party, command: LocationCommand): string {
  const descriptions = {
    add: `Add one location to a ${kind}. Coordinates and country are required; ask for missing coordinates.`,
    update: `Update a ${kind} location. Send only what changes; omitted fields stay unchanged and null clears optional fields.`,
    delete: `Delete a ${kind} location. ${kind === "customer" ? "Deletion is refused when orders or a storage site use it; archive it instead." : "Existing intakes keep their recorded source facts."} Returns the pre-delete data on success and dry run.`,
    archive: "Archive a customer location. It stays on existing orders, deliveries and storage-site registration, but is hidden from new order destinations. The customer must keep an active location.",
    restore: "Restore an archived customer location so it can be selected and edited again.",
  };
  return `${descriptions[command]} Call find_${kind}_locations (${kind}s:read) first. ${kind === "customer" ? "Find an archived destination with find_customer_locations and archived: true. Restore it before editing." : "Restore an archived supplier before changing its locations."} Send ${kind}Id as the parent UUID.${command === "add" ? "" : " Send the location UUID as locationId and its version as expectedVersion. A stale version returns the current representation."} ${REQUEST_KEY_RULE} ${UNTRUSTED_TEXT}`;
}

export function locationToolSummary(kind: Party, command: LocationCommand, row: { id: string; version: number }, dryRun: boolean): string {
  if (dryRun) return `Dry run: would ${command} ${kind} location ${row.id}.`;
  return `${command === "add" ? "Added" : pastTense[command]} ${kind} location ${row.id}${command === "add" ? ` to its ${kind}` : ""}${command === "delete" ? "" : ` (version ${row.version})`}.`;
}
