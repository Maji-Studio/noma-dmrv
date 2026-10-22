import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { CertifierSyncEventRow } from "@/data-access/certification";
import { SyncEventList, SyncEventLog } from "./sync-event-log";

const TIME_ZONE = "Africa/Dar_es_Salaam";
const events = [{ id: "event-1", status: "succeeded", operation: "submit", attemptedAt: new Date("2026-10-21T21:30:00Z"), errorMessage: null }] as CertifierSyncEventRow[];

it.each([SyncEventList, SyncEventLog])("renders sync attempts on the facility clock", (Component) => {
  expect(renderToStaticMarkup(<Component events={events} timeZone={TIME_ZONE} />)).toContain("Oct 22, 2026, 00:30");
});
