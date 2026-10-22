import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SubmissionStatusHistory } from "./submission-status-history";

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: "facility-1" }),
  useFacilityClock: () => ({ timeZone: "Africa/Dar_es_Salaam", hint: "" }),
}));
vi.mock("@/hooks/use-certification", () => ({ useSubmissionStatusHistory: () => ({
  isPending: false, isError: false,
  data: { recordingBeganAt: "2026-10-21T21:30:00Z", entries: [{
    id: "event-1", value: "submitted", label: "Submitted", version: 1,
    occurredAt: "2026-10-21T21:30:00Z", origin: "local", source: "form", actorName: null,
  }] },
}) }));

it("shows status history on the active facility calendar and clock", () => {
  const markup = renderToStaticMarkup(<SubmissionStatusHistory entityType="removal" entityId="removal-1" />);
  expect(markup).toContain("Oct 22, 2026, 00:30");
  expect(markup).toContain("Recording began on Oct 22, 2026");
});
