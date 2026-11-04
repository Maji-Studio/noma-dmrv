/** Structural template contract shared by server and client readiness checks. */
export interface TemplateFixedInputs {
  groups: readonly {
    components: readonly { inputs: readonly { type: string; datapoint_id?: string | null }[] }[];
  }[];
}

/** Same fixed-input rule as batch health's missingFixedDatapoint blocker. */
export function hasMissingFixedDatapoint(template: TemplateFixedInputs): boolean {
  return template.groups.some((group) => group.components.some((component) =>
    component.inputs.some((input) => input.type === "fixed" && !input.datapoint_id),
  ));
}
