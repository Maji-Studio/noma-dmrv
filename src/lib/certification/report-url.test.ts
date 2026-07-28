import { describe, expect, it } from "vitest";
import {
  redactReportSecrets,
  redactReportUrlSecrets,
} from "./report-url";

describe("redactReportUrlSecrets", () => {
  it("removes capability tokens from audit and metadata URLs", () => {
    const redacted = redactReportUrlSecrets(
      "https://app.example/api/ghg-statement-reports/report?token=secret&x=1",
    );
    expect(redacted).not.toContain("secret");
    expect(redacted).toContain("token=%5Bredacted%5D");
    expect(redacted).toContain("x=1");
  });

  it("removes capability tokens nested in provider error bodies", () => {
    const sanitized = redactReportSecrets({
      errors: [
        {
          rejected:
            "https://app.example/report.pdf?token=provider-echo",
        },
      ],
    });

    expect(JSON.stringify(sanitized)).not.toContain("provider-echo");
  });
});
