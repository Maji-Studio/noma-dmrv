import type { ReactTestRenderer } from "react-test-renderer";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";

export const CONTEXT = {
  isProduction: false,
  latestSubmission: null,
  linkedGhgStatement: null,
  mapping: null,
  emissionsLedger: {
    inputs: [],
    inputsUnavailable: true,
    claims: [],
    creditBatches: [],
    productionRuns: [],
    applications: [],
  },
} as unknown as RemovalCertifyContext;

export function findButton(renderer: ReactTestRenderer, label: string) {
  return renderer.root
    .findAllByType("button")
    .find((button) => button.props.children === label);
}

export function findLink(renderer: ReactTestRenderer, label: string) {
  return renderer.root
    .findAllByType("a")
    .find((link) => link.props.children?.[0] === label);
}
