import { expect, it } from "vitest";
import { SafeError } from "./errors";

it.each(["Driver", "Facility", "Feedstock", "Feedstock type", "Storage location", "Supplier", "Vehicle", "Organization"])(
  "normalizes missing %s copy only once", (resource) => {
    const message = `${resource} was not found.`;
    expect(new SafeError(message).message).toBe(message);
    expect(new SafeError(new SafeError(message).message).message).toBe(message);
    expect(new SafeError(`${resource} not found`).message).toBe(message);
    expect(new SafeError(`${resource} was not found in this organization.`).message)
      .toBe(`${resource} was not found in this Organization.`);
  },
);
