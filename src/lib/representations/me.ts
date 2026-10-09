import { z } from "zod";
import { API_SCOPES } from "@/lib/auth/api-scopes";

export const meRepresentationSchema = z.object({
  organization: z.object({
    id: z.string().describe("Credential-bound organization identifier, opaque string."),
    name: z.string().describe("Organization display name, plain text."),
  }).describe("Organization bound to the authenticated credential."),
  facilities: z.array(z.object({
    id: z.uuid().describe("Facility identifier, UUID."),
    code: z.string().describe("Human-readable facility code, plain text."),
    name: z.string().describe("Facility display name, plain text."),
    timeZone: z.string().describe("IANA facility time zone."),
    today: z.iso.date().describe("Current facility-local business date, YYYY-MM-DD."),
  })).describe("Accessible active facilities and their current local dates."),
  role: z.enum(["owner", "admin"]).describe("Live organization role: owner owns the organization; admin administers it."),
  scopes: z.array(z.enum(API_SCOPES).describe("Per-resource permission: read lists and retrieves, write creates and updates, delete removes; no wildcards.")).describe("Credential scopes intersected with the live membership role."),
  credential: z.object({
    id: z.string().describe("Credential identifier, opaque string."),
    name: z.string().nullable().describe("Credential display name, plain text, or null when unspecified."),
    expiresAt: z.iso.datetime().describe("Credential expiry instant in UTC, RFC 3339."),
  }).describe("Safe credential metadata; contains no key material."),
});
