import { API_PERMISSION_ROWS } from "@/components/api-keys/api-key-permissions";
import type { ApiScope } from "@/lib/auth/api-scopes";

/** One row of the consent board: an area with the read and write scopes the request offers for it. */
export interface ConsentArea {
  entity: string;
  label: string;
  read: ApiScope | null;
  write: ApiScope | null;
}

export type PegState = "on" | "off" | "mixed";
export type PegKind = "read" | "write";

export const isReadScope = (scope: string) => scope.endsWith(":read");
export const isWriteScope = (scope: string) => scope.endsWith(":write");

/** The areas touched by the offered scopes, in the API permission order. Deletes are never offered. */
export function buildConsentAreas(offered: readonly ApiScope[]): ConsentArea[] {
  return API_PERMISSION_ROWS.flatMap((row) => {
    const read = row.scopes.find((scope) => isReadScope(scope) && offered.includes(scope)) ?? null;
    const write = read ? row.scopes.find((scope) => isWriteScope(scope) && offered.includes(scope)) ?? null : null;
    return read || write ? [{ entity: row.entity, label: row.label, read, write }] : [];
  });
}

/** Write needs read: switching a write on switches its read on, switching a read off switches its write off. */
export function togglePeg(ticked: readonly ApiScope[], area: ConsentArea, kind: PegKind, on: boolean): ApiScope[] {
  const next = new Set(ticked);
  if (kind === "write" && area.write) {
    if (on) { next.add(area.write); if (area.read) next.add(area.read); } else next.delete(area.write);
  } else if (kind === "read" && area.read) {
    if (on) next.add(area.read);
    else { next.delete(area.read); if (area.write) next.delete(area.write); }
  }
  return [...next];
}

/** Preselect refused scopes through the same peg linkage, keeping only scopes still up for decision. */
export function preselectStepUp(areas: readonly ConsentArea[], undecided: readonly ApiScope[], stepUpScopes: readonly ApiScope[]): ApiScope[] {
  let ticked: ApiScope[] = [];
  for (const area of areas) {
    for (const kind of ["read", "write"] as const) {
      const scope = area[kind];
      if (scope && undecided.includes(scope) && stepUpScopes.includes(scope)) ticked = togglePeg(ticked, area, kind, true);
    }
  }
  return undecided.filter((scope) => ticked.includes(scope));
}

/** The "All areas" row: every scope of one kind that is still up for decision. */
export function toggleAll(ticked: readonly ApiScope[], areas: readonly ConsentArea[], undecided: readonly ApiScope[], kind: PegKind, on: boolean): ApiScope[] {
  const next = new Set(ticked);
  const decide = (scope: ApiScope | null) => { if (scope && undecided.includes(scope)) { if (on) next.add(scope); else next.delete(scope); } };
  for (const area of areas) {
    if (kind === "write") {
      decide(area.write);
      if (on && area.write && undecided.includes(area.write) && area.read) next.add(area.read);
    } else {
      decide(area.read);
      if (!on && area.read && undecided.includes(area.read)) decide(area.write);
    }
  }
  return [...next];
}

export function groupState(ticked: readonly ApiScope[], scopes: readonly ApiScope[]): PegState {
  const on = scopes.filter((scope) => ticked.includes(scope)).length;
  if (on === 0) return "off";
  return on === scopes.length ? "on" : "mixed";
}
