import { expect, it } from "vitest";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { createLineageFixture, cleanupLineageFixture } from "./helpers/certification-lineage-fixture";
import { makeTestOrgContext } from "./helpers/test-org";
import { setDocumentVisibilityInTransaction } from "@/data-access/document-mutations";
const ctx = makeTestOrgContext();
it("enforces visibility roles at data access, bumps version and refuses submitted owners", async () => {
  for (const state of ["none", "removal"] as const) {
    const fixture = await createLineageFixture(state);
    const [row] = await db.insert(documents).values({ organizationId: ctx.organizationId, entityType: "sample", entityId: fixture.sampleId, documentType: "pdf", fileName: "report.pdf", fileUrl: "https://example.test/report" }).returning();
    try {
      await expect(db.transaction((tx) => setDocumentVisibilityInTransaction({ ...ctx, orgRole: "member" }, tx, { documentId: row.id, expectedVersion: row.version, visibility: "public" }))).rejects.toMatchObject({ code: "forbidden" });
      const update = () => db.transaction((tx) => setDocumentVisibilityInTransaction({ ...ctx, orgRole: "admin" }, tx, { documentId: row.id, expectedVersion: row.version, visibility: "public" }));
      if (state === "none") expect(await update()).toMatchObject({ version: 2, visibility: "public" });
      else await expect(update()).rejects.toMatchObject({ code: "certification_locked" });
    } finally {
      await db.delete(documents).where(and(eq(documents.id, row.id), eq(documents.organizationId, ctx.organizationId)));
      await cleanupLineageFixture(fixture);
    }
  }
});
