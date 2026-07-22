import { sql, type SQL } from "drizzle-orm";
import { applications } from "@/db/schema/application";
import { documents } from "@/db/schema/documentation";
import {
  APPLICATION_EVIDENCE_RULE_SPEC,
  type ApplicationEvidenceDocumentMatcher,
  type ApplicationEvidenceRequirement,
  type ApplicationEvidenceUploadedDocumentPredicate,
} from "@/lib/certification/application-evidence";

const APPLICATION_ENTITY_TYPE = "application";

function uploadedDocumentSql(
  predicate: ApplicationEvidenceUploadedDocumentPredicate,
): SQL {
  return sql`(${documents[predicate.uploadStatusField]} = ${predicate.uploadStatus} or ${documents[predicate.fileUrlField]} is not null)`;
}

function documentMatcherSql(
  matcher: ApplicationEvidenceDocumentMatcher,
): SQL {
  switch (matcher.kind) {
    case "geotagged-photo-for-role":
      return sql`(
        ${uploadedDocumentSql(matcher.uploaded)}
        and ${documents.documentType} = ${matcher.documentType}
        and ${documents.metadata}->>${matcher.geotagStatusMetadataKey} = ${matcher.geotagStatus}
        and ${documents.metadata}->>${matcher.evidenceRoleMetadataKey} = ${matcher.role}
      )`;
    case "unconditional-logbook-document-type":
      return sql`(
        ${uploadedDocumentSql(matcher.uploaded)}
        and ${documents.documentType} in (${sql.join(
          matcher.documentTypes.map((type) => sql`${type}`),
          sql`, `,
        )})
      )`;
    case "conditional-logbook-document-type":
      return sql`(
        ${uploadedDocumentSql(matcher.uploaded)}
        and ${documents.documentType} = ${matcher.documentType}
        and ${documents.metadata}->>${matcher.evidenceTypeMetadataKey} in (${sql.join(
          matcher.evidenceTypes.map((type) => sql`${type}`),
          sql`, `,
        )})
      )`;
    case "any-document-matcher":
      return sql`(${sql.join(
        matcher.matchers.map(documentMatcherSql),
        sql` or `,
      )})`;
  }
}

function missingDocumentSql(
  matcher: ApplicationEvidenceDocumentMatcher,
): SQL {
  return sql`not exists (
    select 1
    from ${documents}
    where ${documents.entityType} = ${APPLICATION_ENTITY_TYPE}
      and ${documents.entityId} = ${applications.id}
      and ${documents.organizationId} = ${applications.organizationId}
      and ${documentMatcherSql(matcher)}
  )`;
}

function missingRequirementSql(
  requirement: ApplicationEvidenceRequirement,
): SQL {
  switch (requirement.kind) {
    case "document":
      return missingDocumentSql(requirement.matcher);
    case "non-blank-application-field":
      return sql`(
        ${applications[requirement.field]} is null
        or trim(${applications[requirement.field]}::text) = ''
      )`;
  }
}

function evidenceGapCountSql(
  requirements: readonly ApplicationEvidenceRequirement[],
): SQL {
  return sql.join(
    requirements.map(
      (requirement) =>
        sql`case when ${missingRequirementSql(requirement)} then 1 else 0 end`,
    ),
    sql` + `,
  );
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
  const { dispatch, paths } = APPLICATION_EVIDENCE_RULE_SPEC;
  const boundaryGapCount = evidenceGapCountSql(paths[dispatch.boundaryPath]);
  const defaultGapCount = evidenceGapCountSql(paths[dispatch.defaultPath]);

  return sql<number>`case
    when ${applications.evidenceMethod} = ${dispatch.boundaryValue} then
      ${boundaryGapCount}
    else ${defaultGapCount}
  end`;
}

/** True when the correlated application row has any missing evidence. */
export function applicationHasEvidenceGapSql(): SQL {
  return sql`${applicationEvidenceGapCountSql()} > 0`;
}
