/**
 * Removal submission preparation: the template and registry-connection gates
 * that Review, submit and the claimed-draft freshness check all share.
 *
 * `prepareRemovalSubmission` is pure over the org-scoped
 * `RemovalSubmissionContext`. It returns the ordered blockers and, once the
 * project, credentials and template resolve, the bundle every build and compile
 * takes: the default template narrowed to non-null, its blueprint lookup, the
 * project id, the period-input stub flag and whether the template carries
 * durability components. Review still compiles from a blocked bundle so the
 * operator sees the details; submit and freshness refuse on any blocker.
 *
 * Submit-only gates (feedstock-type mapping, entity readiness, template tier,
 * durability configuration, member batches) stay in `submit-removal.ts`. The
 * client readiness verdict stays in `lib/certification/readiness.ts` (ADR 0007).
 */
import { env } from "@/config/env";
import { SafeError } from "@/lib/errors";
import type {
  IsometricComponentBlueprint,
  IsometricGhgEntryTemplate,
} from "@/lib/isometric";
import { isSequestrationBlueprintKey } from "@/lib/isometric/transformers/measurement-sample";
import type { RemovalSubmissionContext } from "./certify-context-core";
import {
  DURABILITY_MEASUREMENT_SAMPLES_ENABLED,
  DURABILITY_SUBMISSION_UNAVAILABLE_MESSAGE,
} from "./durability-measurement-samples";

export const REMOVAL_PREPARATION_BLOCKERS = {
  noProject: "Link a facility to an Isometric project first.",
  noCredentials:
    "Configure organization Isometric credentials before submitting.",
  templateNotFound:
    "The facility's default Removal template was not found in Certify. Refresh the link in facility settings.",
  noTemplate: "Set a default Removal template before submitting.",
  notRemovalTemplate:
    "The facility's default template is not a REMOVAL template. Rebind a REMOVAL template in facility settings before submitting.",
  templateOutOfDate:
    "The registry template is out of date. Refresh the facility link in settings before submitting.",
  emptyTemplate:
    "The default Removal template has no fields to submit. Choose another template in facility settings.",
  durabilityUnavailable: DURABILITY_SUBMISSION_UNAVAILABLE_MESSAGE,
} as const;

export type RemovalPreparationBlockerCode =
  keyof typeof REMOVAL_PREPARATION_BLOCKERS;

export interface RemovalPreparationBlocker {
  code: RemovalPreparationBlockerCode;
  message: string;
}

export interface PreparedRemovalSubmission {
  defaultTemplate: IsometricGhgEntryTemplate;
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
  /** Null until the project link, credentials and default template resolve. */
  prepared: PreparedRemovalSubmission | null;
  blockers: RemovalPreparationBlocker[];
}

type PreparationContext = Pick<
  RemovalSubmissionContext,
  | "mapping"
  | "hasOrgCredentials"
  | "missingDefaultTemplateId"
  | "defaultTemplate"
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
  if (ctx.missingDefaultTemplateId) {
    return { prepared: null, blockers: [blocker("templateNotFound")] };
  }
  const defaultTemplate = ctx.defaultTemplate;
  if (!defaultTemplate) {
    return { prepared: null, blockers: [blocker("noTemplate")] };
  }

  const hasDurabilityComponents = defaultTemplate.groups.some((group) =>
    group.components.some((component) =>
      isSequestrationBlueprintKey(component.blueprint_key),
    ),
  );
  const blockers: RemovalPreparationBlocker[] = [];
  // The template lives on Isometric and can change credit_type after binding;
  // a REDUCTION template must never mislabel a GHG entry.
  if (defaultTemplate.credit_type !== "REMOVAL") {
    blockers.push(blocker("notRemovalTemplate"));
  }
  if (ctx.unresolvedBlueprintKeys.length > 0) {
    blockers.push(blocker("templateOutOfDate"));
  }
  if (defaultTemplate.groups.length === 0) {
    blockers.push(blocker("emptyTemplate"));
  }
  // Without the evidence step the required sequestration sources cannot be
  // bound, and an emissions-only GHG entry is forbidden.
  if (hasDurabilityComponents && !DURABILITY_MEASUREMENT_SAMPLES_ENABLED) {
    blockers.push(blocker("durabilityUnavailable"));
  }
  const isometricEnvironment =
    options.isometricEnvironment ?? env.ISOMETRIC_ENVIRONMENT;
  return {
    blockers,
    prepared: {
      defaultTemplate,
      blueprintsByKey: new Map(
        ctx.blueprintsForTemplate.map((blueprint) => [blueprint.key, blueprint]),
      ),
      externalProjectId: ctx.mapping.externalProjectId,
      allowPeriodInputStub: isometricEnvironment === "sandbox",
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
