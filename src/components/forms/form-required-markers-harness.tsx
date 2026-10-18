/**
 * Test harness for the required marker guard (`form-detail-parity-forms.test.tsx`).
 * Renders a form, reads which `FormField`s carry the required star, submits the
 * form empty and reads which fields report an error. A field that refuses an
 * empty submit must carry the star; a starred field that accepts one must be
 * explained (a prefilled default).
 */
import type { ReactElement } from "react";
import { act, create } from "react-test-renderer";
import { FormDetailProvider } from "./form-detail-context";
import { FormField } from "./form-field";

export type RequiredMarkers = {
  /** Ids of the fields showing the star before any submit. */
  starred: string[];
  /** Ids of the fields that report an error after an empty submit. */
  failing: string[];
};

export async function requiredMarkers(element: ReactElement, { submit = true } = {}): Promise<RequiredMarkers> {
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(<FormDetailProvider scope="required-markers">{element}</FormDetailProvider>);
  });
  const starred = renderer.root.findAllByType(FormField).filter(field => field.props.required).map(field => field.props.id as string);
  if (submit) {
    for (const form of renderer.root.findAll(node => node.type === "form")) {
      await act(async () => { await form.props.onSubmit({ preventDefault: () => undefined, stopPropagation: () => undefined }); });
    }
  }
  const failing = renderer.root.findAllByType(FormField).filter(field => field.props.error).map(field => field.props.id as string);
  await act(async () => renderer.unmount());
  return { starred, failing };
}
