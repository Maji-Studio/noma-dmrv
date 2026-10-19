import type { LineSources } from "@/lib/isometric/template-observations/line-sources";
import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";
/**
 * Removal submission preparation: the template and registry-connection gates
 * that Review, submit and the claimed-draft freshness check all share.
 *
 * `prepareRemovalSubmission` is pure over the org-scoped
 * `RemovalSubmissionContext`. It returns the ordered blockers and, once the
 * project, credentials and template resolve, the bundle every build and compile
 * takes: the pinned template narrowed to non-null, its blueprint lookup, the
 * project id, the period-input stub flag and whether the template carries
 * durability components. Review still compiles from a blocked bundle so the
 * operator sees the details; submit and freshness refuse on any blocker.
 *
 * The shared preflight gate collects mapping, entity, tier, configuration and
 * member-batch blockers in `removal-blockers-gate.ts`. The
 * client readiness verdict stays in `lib/certification/readiness.ts` (ADR 0007).
 */
import { allowsPeriodInputStub } from "@/lib/isometric/datapoint-mapping";
import { findUnbindableTemplateInputs, formatUnbindableTemplateInputsText } from "@/lib/isometric/template-binding-coverage";
import { env } from "@/config/env";
import { SafeError } from "@/lib/errors";
import type {
  IsometricComponentBlueprint,
  IsometricGhgEntryTemplate,
} from "@/lib/isometric";
import { hasDurabilityMeasurementComponents } from "@/lib/certification/submission-readiness";
import type { RemovalSubmissionContext } from "./certify-context-core";
import {
  DURABILITY_MEASUREMENT_SAMPLES_ENABLED,
  DURABILITY_SUBMISSION_UNAVAILABLE_MESSAGE,
} from "./durability-measurement-samples";

export const REMOVAL_PREPARATION_BLOCKERS = {
  noProject: "Link a facility to an Isometric project first.",
  noCredentials:
    "Configure organization Isometric credentials before submitting.",
  ...REMOVAL_TEMPLATE_BLOCKERS,
  noTemplate: REMOVAL_TEMPLATE_BLOCKERS.unpinnedTemplate,
  templateOutOfDate:
    "The registry template is out of date. Refresh the facility link in settings before submitting.",
  // Detailed guidance comes from formatUnbindableTemplateInputs.
  templateUnbindable: "The Removal template has components noma cannot submit.",
  emptyTemplate:
    "The Removal template has no fields to submit. Choose another template for this credit batch.",
  durabilityUnavailable: DURABILITY_SUBMISSION_UNAVAILABLE_MESSAGE,
} as const;

export type RemovalPreparationBlockerCode =
  keyof typeof REMOVAL_PREPARATION_BLOCKERS;

export interface RemovalPreparationBlocker {
  code: RemovalPreparationBlockerCode;
  message: string;
}

export interface PreparedRemovalSubmission {
  removalTemplate: IsometricGhgEntryTemplate;
  lineSources: LineSources;
  blueprintsByKey: Map<string, IsometricComponentBlueprint>;
  externalProjectId: string;
  /**
   * ADR 0005 escape hatch: in SANDBOX, a Removal Template that still declares
   * a period-input tuple emits a 0-magnitude stub instead of failing closed.
   * Production NEVER stubs; 0 is an over-claim for these positive emissions.
   */
  allowPeriodInputStub: boolean;
  hasDurabilityComponents: boolean;
}

export interface RemovalSubmissionPreparation {
  /** Null until the project link, credentials and pinned template resolve. */
  prepared: PreparedRemovalSubmission | null;
  blockers: RemovalPreparationBlocker[];
}

type PreparationContext = Pick<
  RemovalSubmissionContext,
  | "mapping"
  | "hasOrgCredentials"
  | "templateBlockers"
  | "lineSources"
  | "removalTemplate"
  | "unresolvedBlueprintKeys"
  | "blueprintsForTemplate"
>;

function blocker(code: RemovalPreparationBlockerCode): RemovalPreparationBlocker {
  return { code, message: REMOVAL_PREPARATION_BLOCKERS[code] };
}

/** The project link and org credentials every registry call depends on. */
function connectionBlocker(
  ctx: Pick<PreparationContext, "mapping" | "hasOrgCredentials">,
): RemovalPreparationBlocker | null {
  if (!ctx.mapping) return blocker("noProject");
  if (!ctx.hasOrgCredentials) return blocker("noCredentials");
  return null;
}

/**
 * Submit checks the connection before its recovery branch, which finishes an
 * already-created registry Removal and must not wait on template gates.
 */
export function assertRemovalRegistryConnection<
  T extends Pick<PreparationContext, "mapping" | "hasOrgCredentials">,
>(ctx: T): asserts ctx is T & { mapping: NonNullable<T["mapping"]> } {
  const found = connectionBlocker(ctx);
  if (found) throw new SafeError(found.message);
}

export function prepareRemovalSubmission(
  ctx: PreparationContext,
  options: { isometricEnvironment?: typeof env.ISOMETRIC_ENVIRONMENT } = {},
): RemovalSubmissionPreparation {
  // Without a project link or credentials no template was loaded, so nothing
  // after this can be judged.
  const connection = connectionBlocker(ctx);
  if (connection || !ctx.mapping) {
    return {
      prepared: null,
      blockers: [connection ?? blocker("noProject")],
    };
  }
  const removalTemplate = ctx.removalTemplate;
  if (!removalTemplate) {
    return { prepared: null, blockers: ctx.templateBlockers.length ? ctx.templateBlockers : [blocker("noTemplate")] };
  }

  const hasDurabilityComponents = hasDurabilityMeasurementComponents(removalTemplate);
  const blockers: RemovalPreparationBlocker[] = [...ctx.templateBlockers];
  const isometricEnvironment = options.isometricEnvironment ?? env.ISOMETRIC_ENVIRONMENT;
  const unbindable = findUnbindableTemplateInputs(removalTemplate, { lineSources: ctx.lineSources, enrichmentComplete: !ctx.templateBlockers.some((blocker) => blocker.code === "templateNotFullyRead") });
  // The template lives on Isometric and can change credit_type after binding;
  // a REDUCTION template must never mislabel a GHG entry.
  if (removalTemplate.credit_type !== "REMOVAL") {
    blockers.push(blocker("notRemovalTemplate"));
  }
  if (ctx.unresolvedBlueprintKeys.length > 0) {
    blockers.push(blocker("templateOutOfDate"));
  }
  if (unbindable.length > 0) {
    blockers.push({ code: "templateUnbindable", message: formatUnbindableTemplateInputsText(unbindable) });
  }
  if (removalTemplate.groups.length === 0) {
    blockers.push(blocker("emptyTemplate"));
  }
  // Without the evidence step the required sequestration sources cannot be
  // bound, and an emissions-only GHG entry is forbidden.
  if (hasDurabilityComponents && !DURABILITY_MEASUREMENT_SAMPLES_ENABLED) {
    blockers.push(blocker("durabilityUnavailable"));
  }
  return {
    blockers,
    prepared: ctx.templateBlockers.length ? null : {
      removalTemplate,
      lineSources: ctx.lineSources,
      blueprintsByKey: new Map(
        ctx.blueprintsForTemplate.map((blueprint) => [blueprint.key, blueprint]),
      ),
      externalProjectId: ctx.mapping.externalProjectId,
      allowPeriodInputStub: allowsPeriodInputStub(isometricEnvironment),
      hasDurabilityComponents,
    },
  };
}

/** The bundle, or a refusal with the first blocker's message. */
export function requirePreparedRemovalSubmission(
  ctx: PreparationContext,
): PreparedRemovalSubmission {
  const { prepared, blockers } = prepareRemovalSubmission(ctx);
  if (blockers.length > 0 || !prepared) {
    throw new SafeError(
      blockers[0]?.message ?? REMOVAL_PREPARATION_BLOCKERS.noTemplate,
    );
  }
  return prepared;
}
