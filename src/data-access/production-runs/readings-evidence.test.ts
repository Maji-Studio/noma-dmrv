import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { hasUploadedProductionReadingsFile } from "./readings-evidence";

const ctx: OrgContext = {
  userId: "user-readings-evidence",
  organizationId: "org-readings-evidence",
  orgRole: "owner",
  isPlatformAdmin: false,
};

describe("hasUploadedProductionReadingsFile", () => {
  it("projects one org-scoped EXISTS over uploaded production-run sensor data", () => {
    const query = new PgDialect().sqlToQuery(
      hasUploadedProductionReadingsFile(ctx, productionRuns.id),
    );

    expect(query.sql.toLowerCase()).toContain("exists");
    expect(query.sql).toContain('"documents"."organization_id"');
    expect(query.sql).toContain('"documents"."entity_type"');
    expect(query.sql).toContain('"documents"."entity_id"');
    expect(query.sql).toContain('"production_runs"."id"');
    expect(query.sql).toContain('"documents"."document_type"');
    expect(query.sql).toContain('"documents"."upload_status"');
    expect(query.sql).toContain('"documents"."file_name"');
    expect(query.sql).toContain('"documents"."mime_type"');
    expect(query.params).toEqual([
      ctx.organizationId,
      "production_run",
      "sensor_data",
      "uploaded",
      "%.csv",
      "text/csv",
      "application/vnd.ms-excel",
    ]);
  });
});
