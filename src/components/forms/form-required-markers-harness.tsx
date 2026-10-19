/**
 * Test harness for the required marker guards (`form-detail-parity-forms.test.tsx`).
 * Renders a form and reads which `FormField`s carry the star (`required`) and how
 * many `RequiredMarker`s render in all, so stars outside FormField (a position
 * picker label, the GIS reference label) count too.
 *
 * `requiredMarkers` submits the form empty and reports the fields that then show
 * an error. That catches an unconditionally required field with no star. Its
 * limit: Zod 4 aborts an object `superRefine` once an `invalid_type` issue is
 * present, and handler checks (for example the merge time) run only after
 * validation passes, so an empty submit never reaches a conditional requirement.
 * Those are covered by `conditionalRequired`, which starts from a valid fixture,
 * empties one field and reports the star and the error of that field together.
 */
import type { ReactElement } from "react";
import { act, create, type ReactTestInstance } from "react-test-renderer";
import { FormDetailProvider } from "./form-detail-context";
import { FormField } from "./form-field";
import { RequiredMarker } from "./required-marker";

export type RequiredMarkers = {
  /** Ids of the fields showing the star before any submit. */
  starred: string[];
  /** Ids of the fields that report an error after an empty submit. */
  failing: string[];
  /** Every `RequiredMarker` rendered, inside a FormField or not. */
  markerCount: number;
};

async function submitForms(root: ReactTestInstance) {
  for (const form of root.findAll(node => node.type === "form")) {
    await act(async () => { await form.props.onSubmit({ preventDefault: () => undefined, stopPropagation: () => undefined }); });
  }
}

async function render(element: ReactElement) {
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(<FormDetailProvider scope="required-markers">{element}</FormDetailProvider>);
  });
  return renderer;
}

const read = (root: ReactTestInstance) => ({
  starred: root.findAllByType(FormField).filter(field => field.props.required).map(field => field.props.id as string),
  failing: root.findAllByType(FormField).filter(field => field.props.error).map(field => field.props.id as string),
  markerCount: root.findAllByType(RequiredMarker).length,
});

export async function requiredMarkers(element: ReactElement, { submit = true } = {}): Promise<RequiredMarkers> {
  const renderer = await render(element);
  const before = read(renderer.root);
  if (submit) await submitForms(renderer.root);
  const after = read(renderer.root);
  await act(async () => renderer.unmount());
  return { starred: before.starred, failing: after.failing, markerCount: after.markerCount };
}

export type ConditionalResult = { starred: boolean; error: string | undefined; markerCount: number };

/**
 * Renders `element` (a form with valid values), runs `empty` to clear one
 * conditionally required field, submits, and reads the field `id`.
 */
export async function conditionalRequired(
  element: ReactElement,
  target: string | ((root: ReactTestInstance) => { starred: boolean; error: string | undefined }),
  empty: (root: ReactTestInstance) => Promise<void> = async () => undefined,
): Promise<ConditionalResult> {
  const renderer = await render(element);
  await empty(renderer.root);
  await submitForms(renderer.root);
  const field = typeof target === "string"
    ? renderer.root.findAllByType(FormField).find(node => node.props.id === target)
    : undefined;
  const probed = typeof target === "string"
    ? { starred: Boolean(field?.props.required), error: field?.props.error as string | undefined }
    : target(renderer.root);
  const result = { ...probed, markerCount: renderer.root.findAllByType(RequiredMarker).length };
  await act(async () => renderer.unmount());
  return result;
}

/** Runs a React state update from a test callback. */
export const change = (run: () => unknown) => act(async () => { await run(); });
