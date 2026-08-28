import {
  applicationEvidenceMethods,
  isSelectableApplicationEvidenceMethod,
  type ApplicationEvidenceMethod,
} from "@/schemas/applications";

export function resolveApplicationEvidenceMethodDefault(
  savedMethod: string | null | undefined,
  organizationDefault: string | null | undefined,
): ApplicationEvidenceMethod {
  if (
    applicationEvidenceMethods.includes(
      savedMethod as ApplicationEvidenceMethod,
    )
  ) {
    return savedMethod as ApplicationEvidenceMethod;
  }
  const configuredMethod = applicationEvidenceMethods.includes(
    organizationDefault as ApplicationEvidenceMethod,
  )
    ? (organizationDefault as ApplicationEvidenceMethod)
    : undefined;
  return configuredMethod &&
    isSelectableApplicationEvidenceMethod(configuredMethod)
    ? configuredMethod
    : "location";
}
