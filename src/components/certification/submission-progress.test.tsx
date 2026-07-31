import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  canRetrySubmissionProgress,
  SubmissionProgress,
} from "./submission-progress";

describe("SubmissionProgress", () => {
  it("shows completed, active, counted, and upcoming Removal steps", () => {
    const html = renderToStaticMarkup(
      <SubmissionProgress
        kind="removal"
        updates={[
          { step: "removal.checking_data", state: "complete" },
          { step: "removal.preparing_evidence", state: "complete" },
          {
            step: "removal.sending_inputs",
            state: "active",
            completed: 2,
            total: 5,
          },
        ]}
      />,
    );

    expect(html).toContain("Checking submission data");
    expect(html).toContain("Sending monitored inputs");
    expect(html).toContain("2 of 5");
    expect(html).toContain("Creating Removal in Isometric");
    expect(html).toContain("Sending monitored inputs</span>");
    expect(html).toContain('aria-label="Submission progress"');
    expect(html).toContain("Complete. ");
    expect(html).toContain("In progress. ");
  });

  it("marks the current step failed without losing completed checks", () => {
    const html = renderToStaticMarkup(
      <SubmissionProgress
        kind="ghg_statement"
        updates={[
          { step: "ghg_statement.checking", state: "complete" },
          { step: "ghg_statement.preparing_report", state: "active" },
        ]}
        error="The report could not be prepared."
      />,
    );

    expect(html).toContain("Preparing verifier document failed.");
    expect(html).toContain("text-[var(--st-ok)]");
    expect(html).toContain("text-[var(--st-bad)]");
  });

  it("does not blame the first step when submission fails before progress starts", () => {
    const html = renderToStaticMarkup(
      <SubmissionProgress
        kind="ghg_statement"
        updates={[]}
        error="The submission could not be started."
      />,
    );

    expect(html).toContain("Submission failed before progress started.");
    expect(html).not.toContain("Checking statement and report failed.");
    expect(html).not.toContain("text-[var(--st-bad)]");
  });

  it("keeps the active step in progress when progress updates stall", () => {
    const removalHtml = renderToStaticMarkup(
      <SubmissionProgress
        kind="removal"
        updates={[
          { step: "removal.checking_data", state: "complete" },
          { step: "removal.preparing_evidence", state: "active" },
        ]}
        error="The progress connection stopped responding."
        stalled
      />,
    );
    const ghgHtml = renderToStaticMarkup(
      <SubmissionProgress
        kind="ghg_statement"
        updates={[
          { step: "ghg_statement.checking", state: "complete" },
          { step: "ghg_statement.preparing_report", state: "complete" },
          { step: "ghg_statement.sending", state: "active" },
        ]}
        error="The progress connection stopped responding."
        stalled
      />,
    );

    expect(removalHtml).toContain(
      "Progress updates stopped during preparing supporting evidence.",
    );
    expect(removalHtml).toContain("In progress. ");
    expect(removalHtml).not.toContain(
      "Preparing supporting evidence failed.",
    );
    expect(removalHtml).not.toContain("text-[var(--st-bad)]");
    expect(ghgHtml).toContain(
      "Progress updates stopped during sending to the verifier.",
    );
    expect(ghgHtml).toContain("In progress. ");
    expect(ghgHtml).not.toContain("Sending to the verifier failed.");
    expect(ghgHtml).not.toContain("text-[var(--st-bad)]");
  });

  it("labels conditional steps that are not required", () => {
    const html = renderToStaticMarkup(
      <SubmissionProgress
        kind="removal"
        updates={[
          { step: "removal.checking_data", state: "complete" },
          { step: "removal.preparing_evidence", state: "complete" },
          { step: "removal.sending_inputs", state: "skipped" },
          { step: "removal.sending_durability", state: "skipped" },
        ]}
      />,
    );

    expect(html.match(/Not required/g)).toHaveLength(4);
    expect(html).toContain("This step is not needed for this submission.");
  });

  it("distinguishes work recovered from an earlier attempt", () => {
    const html = renderToStaticMarkup(
      <SubmissionProgress
        kind="removal"
        updates={[
          { step: "removal.checking_data", state: "complete" },
          { step: "removal.preparing_evidence", state: "complete" },
          { step: "removal.sending_inputs", state: "reused" },
          { step: "removal.sending_durability", state: "reused" },
          { step: "removal.creating", state: "reused" },
          { step: "removal.verifying_evidence", state: "active" },
        ]}
      />,
    );

    expect(html.match(/Already sent/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain(
      "This step was completed in an earlier submission attempt.",
    );
    expect(html).not.toContain(">Not required<");
  });

  it("announces the terminal state when every step is complete", () => {
    const html = renderToStaticMarkup(
      <SubmissionProgress
        kind="ghg_statement"
        updates={[
          { step: "ghg_statement.checking", state: "complete" },
          { step: "ghg_statement.preparing_report", state: "complete" },
          { step: "ghg_statement.sending", state: "complete" },
          { step: "ghg_statement.confirming", state: "complete" },
          { step: "ghg_statement.complete", state: "complete" },
        ]}
      />,
    );

    expect(html).toContain('role="status">Submission complete</span>');
    expect(html).not.toContain('role="status">Preparing submission</span>');
  });

  it("offers direct retry only after an external submission step starts", () => {
    expect(
      canRetrySubmissionProgress("ghg_statement", [
        { step: "ghg_statement.checking", state: "active" },
      ]),
    ).toBe(false);
    expect(
      canRetrySubmissionProgress("ghg_statement", [
        { step: "ghg_statement.checking", state: "complete" },
        { step: "ghg_statement.preparing_report", state: "complete" },
        { step: "ghg_statement.sending", state: "active" },
      ]),
    ).toBe(true);
    expect(canRetrySubmissionProgress("ghg_statement", [])).toBe(false);
  });

  it("does not retry a deterministic GHG Statement confirmation failure", () => {
    expect(
      canRetrySubmissionProgress("ghg_statement", [
        { step: "ghg_statement.checking", state: "complete" },
        { step: "ghg_statement.preparing_report", state: "complete" },
        { step: "ghg_statement.sending", state: "complete" },
        { step: "ghg_statement.confirming", state: "active" },
      ]),
    ).toBe(false);
  });

  it("never offers a direct Removal retry after draft claim may have started", () => {
    expect(
      canRetrySubmissionProgress("removal", [
        { step: "removal.checking_data", state: "complete" },
        { step: "removal.preparing_evidence", state: "complete" },
        {
          step: "removal.sending_inputs",
          state: "active",
          completed: 0,
          total: 1,
        },
      ]),
    ).toBe(false);
  });
});
