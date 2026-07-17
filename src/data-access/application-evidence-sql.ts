import { sql, type SQL } from "drizzle-orm";
import { applications } from "@/db/schema/application";
import { documents } from "@/db/schema/documentation";
import {
  APPLICATION_BOUNDARY_LOGBOOK_CONDITIONAL_DOCUMENT_TYPE,
  APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES,
  APPLICATION_BOUNDARY_LOGBOOK_UNCONDITIONAL_DOCUMENT_TYPES,
  APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE,
  APPLICATION_VISUAL_EVIDENCE_ROLES,
} from "@/lib/certification/application-evidence";

const APPLICATION_ENTITY_TYPE = "application";
const BOUNDARY_EVIDENCE_METHOD = "boundary";
const UPLOADED_STATUS = "uploaded";
const PRESENT_GEOTAG_STATUS = "present";

function uploadedDocumentSql(): SQL {
  return sql`(${documents.uploadStatus} = ${UPLOADED_STATUS} or ${documents.fileUrl} is not null)`;
}

function missingVisualRoleSql(role: string): SQL {
  return sql`not exists (
    select 1
    from ${documents}
    where ${documents.entityType} = ${APPLICATION_ENTITY_TYPE}
      and ${documents.entityId} = ${applications.id}
      and ${documents.organizationId} = ${applications.organizationId}
      and ${documents.documentType} = ${APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE}
      and ${uploadedDocumentSql()}
      and ${documents.metadata}->>'geotagStatus' = ${PRESENT_GEOTAG_STATUS}
      and ${documents.metadata}->>'evidenceRole' = ${role}
  )`;
}

function missingBoundaryLogbookSql(): SQL {
  return sql`not exists (
    select 1
    from ${documents}
    where ${documents.entityType} = ${APPLICATION_ENTITY_TYPE}
      and ${documents.entityId} = ${applications.id}
      and ${documents.organizationId} = ${applications.organizationId}
      and ${uploadedDocumentSql()}
      and (
        ${documents.documentType} in (${sql.join(
          APPLICATION_BOUNDARY_LOGBOOK_UNCONDITIONAL_DOCUMENT_TYPES.map(
            (type) => sql`${type}`,
          ),
          sql`, `,
        )})
        or (
          ${documents.documentType} = ${APPLICATION_BOUNDARY_LOGBOOK_CONDITIONAL_DOCUMENT_TYPE}
          and ${documents.metadata}->>'logbookEvidenceType' in (${sql.join(
            APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPES.map(
              (type) => sql`${type}`,
            ),
            sql`, `,
          )})
        )
      )
  )`;
}

/**
 * Correlated evidence-gap count for the current `applications` row.
 *
 * Visual evidence needs all three geotagged photo roles. Boundary evidence
 * needs both a non-blank GIS reference and a qualifying logbook document.
 * Legacy null evidence methods render as visual in the application UI, so the
 * CASE deliberately treats every non-boundary value as visual too.
 */
export function applicationEvidenceGapCountSql(): SQL<number> {
  const visualGapCount = sql.join(
    APPLICATION_VISUAL_EVIDENCE_ROLES.map(
      (role) => sql`case when ${missingVisualRoleSql(role)} then 1 else 0 end`,
    ),
    sql` + `,
  );
  const missingBoundaryReference = sql`
    ${applications.gisBoundaryReference} is null
    or trim(${applications.gisBoundaryReference}::text) = ''
  `;

  return sql<number>`case
    when ${applications.evidenceMethod} = ${BOUNDARY_EVIDENCE_METHOD} then
      (case when ${missingBoundaryReference} then 1 else 0 end)
      + (case when ${missingBoundaryLogbookSql()} then 1 else 0 end)
    else ${visualGapCount}
  end`;
}

/** True when the correlated application row has any missing evidence. */
export function applicationHasEvidenceGapSql(): SQL {
  return sql`${applicationEvidenceGapCountSql()} > 0`;
}
