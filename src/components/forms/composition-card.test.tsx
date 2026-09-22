import { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useForm } from "react-hook-form";
import { beforeAll, expect, it } from "vitest";
import { CompositionCard } from "./composition-card";

beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
function History() {
  const [value, setValue] = useState("original");
  return <input aria-label="History correction" value={value} onChange={() => setValue("correction draft")} />;
}
function Form() {
  const { formState } = useForm({ defaultValues: { mass: 100 } });
  return <form><output>{formState.isDirty ? "dirty" : "clean"}</output><CompositionCard title="Bin composition" details={<History />}><p>100 kg</p></CompositionCard></form>;
}
it("starts collapsed, keeps correction drafts mounted, and never submits or dirties the form", async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<Form />); });
  const button = () => renderer.root.findByType("button");
  const panel = () => renderer.root.findByProps({ id: button().props["aria-controls"] });
  expect(button().props.type).toBe("button");
  expect(button().props["data-presentation-control"]).toBe(true);
  expect(button().props["aria-expanded"]).toBe(false);
  expect(panel().props.hidden).toBe(true);
  await act(async () => button().props.onClick());
  expect(panel().props.hidden).toBe(false);
  await act(async () => renderer.root.findByType("input").props.onChange());
  await act(async () => button().props.onClick());
  await act(async () => button().props.onClick());
  expect(renderer.root.findByType("input").props.value).toBe("correction draft");
  expect(renderer.root.findByType("output").children).toEqual(["clean"]);
  await act(async () => renderer.unmount());
});
