import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SubmissionAttempt } from "@/lib/certification/submission-attempts";
import { SubmissionHistory } from "./submission-history";
import { SubmissionOutcomeNotice, type NoticeOutcome } from "./submission-outcome-notice";

const TIME_ZONE = "Africa/Dar_es_Salaam";
const FACILITY = "fac-1";
const differs = (extra: Record<string, unknown> = {}): NoticeOutcome => ({
  kind: "differs", creditBatchId: "cb-9", creditBatchCode: "CB-26-009", shared: false, sharedWith: null,
  differences: [
    { field: "dryMass", isometric: { magnitude: 1200, unit: "kg" }, noma: { magnitude: 1150, unit: "kg" } },
    { field: "windowEnd", isometric: "2026-03-28T19:45:00.000Z", noma: "2026-03-28T18:45:00.000Z" },
  ],
  ...extra,
}) as NoticeOutcome;

function render(outcome: NoticeOutcome, finalized = false) {
  return renderToStaticMarkup(<SubmissionOutcomeNotice outcome={outcome} facilityId={FACILITY} timeZone={TIME_ZONE} finalized={finalized} />);
}

describe("SubmissionOutcomeNotice", () => {
  it("shows a stop as an error notice with linked credit batch, figure pairs and the delete line", () => {
    const html = render(differs());
    expect(html).toContain('data-tone="error"');
    expect(html).toContain("Not submitted:");
    expect(html).toContain("CB-26-009");
    expect(html).toContain("/credit-batches");
    expect(html).toContain("no longer");
    expect(html).toContain("1,200 kg");
    expect(html).toContain("1,150 kg");
    expect(html).toContain("Mar 28, 2026, 22:45");
    expect(html).toContain("Mar 28, 2026, 21:45");
    expect(html).toContain("Check the production runs in this credit batch for later edits. If the figures in noma are right, delete this Removal and submit again.");
    expect(html).toContain("About Why it stopped");
    expect(html).not.toContain("<button");
  });

  it("names and links the other Removal when the credit batch is shared", () => {
    const html = render(differs({ shared: true, sharedWith: { id: "rm-3", code: "RM-26-003" } }));
    expect(html).toContain("RM-26-003");
    expect(html).toContain("removal=rm-3");
    expect(html).toContain("Check the production runs in this credit batch for later edits.");
    expect(html).toContain("so deleting this Removal does not fix it. Contact support.");
    expect(html).not.toContain("delete this Removal and submit again");
  });

  it("sends a finalized Removal to an admin or Isometric", () => {
    expect(render(differs(), true)).toContain("Check the production runs in this credit batch for later edits. This Removal is finalized, so it cannot be deleted. Contact an admin or Isometric.");
  });

  it("keeps retry states at warning tone and points at Review and submit", () => {
    const noAnswer = render({ kind: "no-answer" });
    expect(noAnswer).toContain('data-tone="warning"');
    expect(noAnswer).toContain("Isometric did not answer");
    expect(noAnswer).not.toContain("Not submitted");
    expect(noAnswer).toContain("Anything already sent stays in Isometric. Review and submit again to send the rest.");
    const interrupted = render({ kind: "interrupted" });
    expect(interrupted).toContain("Submission interrupted");
    expect(interrupted).toContain("Part of it may already be in Isometric. Review and submit again to finish it. What is there is reused.");
    expect(render({ kind: "failed", message: "Removal needs a template." })).toContain("Removal needs a template. Review and submit again.");
  });

  it("renders nothing for a submitted attempt", () => {
    expect(render({ kind: "submitted" })).toBe("");
  });
});

describe("SubmissionHistory", () => {
  const attempts: SubmissionAttempt[] = [
    { id: "a2", at: "2026-10-27T11:05:00.000Z", errorMessage: "m", outcome: differs() as SubmissionAttempt["outcome"] },
    { id: "a1", at: "2026-10-20T06:12:00.000Z", errorMessage: null, outcome: { kind: "submitted" } },
  ];

  it("lists one line per attempt on the facility clock, with raw events folded away", () => {
    const html = renderToStaticMarkup(<SubmissionHistory attempts={attempts} events={[{ id: "e", status: "failed", operation: "x", attemptedAt: new Date("2026-10-27T11:05:00Z"), errorMessage: null }] as never} facilityId={FACILITY} timeZone={TIME_ZONE} />);
    expect(html).toContain("Submission history");
    expect(html.match(/<li/g)).toHaveLength(3);
    expect(html).toContain("Oct 27, 2026, 14:05");
    expect(html).toContain("Submitted to Isometric");
    expect(html).toContain("Technical details for support");
    expect(html).not.toMatch(/Submission history \(/);
  });

  it("renders nothing without attempts or events", () => {
    expect(renderToStaticMarkup(<SubmissionHistory attempts={[]} events={[]} facilityId={FACILITY} timeZone={TIME_ZONE} />)).toBe("");
  });
});

describe("figure formatting", () => {
  it("tells apart two instants of a repeated DST hour by their UTC offset", () => {
    const html = renderToStaticMarkup(
      <SubmissionOutcomeNotice
        outcome={{ kind: "differs", creditBatchId: "cb", creditBatchCode: "CB-1", shared: false, sharedWith: null,
          differences: [{ field: "windowEnd", isometric: "2026-10-25T00:30:00.000Z", noma: "2026-10-25T01:30:00.000Z" }] }}
        facilityId="f" timeZone="Europe/Zurich" />,
    );
    expect(html).toContain("+02:00");
    expect(html).toContain("+01:00");
  });
});

describe("figure names", () => {
  const facility = (extra: Record<string, unknown>): NoticeOutcome => ({
    kind: "differs", creditBatchId: "cb", creditBatchCode: "CB-1", shared: false, sharedWith: null,
    differences: [{ field: "facility", isometric: "fcl_old", noma: "fcl_new", ...extra }],
  }) as NoticeOutcome;

  it("shows names when saved", () => {
    const html = render(facility({ isometricLabel: "Mafinga old site", nomaLabel: "Mafinga" }));
    expect(html).toContain("Mafinga old site");
    expect(html).not.toContain("fcl_old");
  });

  it("qualifies an id noma has no name for", () => {
    const html = render(facility({}));
    expect(html).toContain("Isometric record fcl_old");
    expect(html).toContain("Isometric record fcl_new");
  });
});
