import { z } from "zod";

const INTEGER_STEP = 1;
const MAX_FIXED_DECIMALS = 100;
const ARRAY_INDEX_PATTERN = /^\d+$/;

export interface NumberInputConstraints {
  min?: number;
  max?: number;
  step: number | "any";
}

type Schema = z.core.$ZodType;

/** Pipes prefer their output; unions retain every matching branch. */
function resolveSchemas<T extends Schema>(
  schema: Schema,
  matches: (value: Schema) => value is T,
  ancestors = new Set<Schema>(),
): T[] {
  if (ancestors.has(schema)) return [];
  if (matches(schema)) return [schema];
  const visited = new Set(ancestors).add(schema);
  if (schema instanceof z.ZodPipe) {
    const output = resolveSchemas(schema.out, matches, visited);
    return output.length ? output : resolveSchemas(schema.in, matches, visited);
  }
  if (schema instanceof z.ZodUnion) {
    return schema.options.flatMap(option => resolveSchemas(option, matches, visited));
  }
  if (
    schema instanceof z.ZodOptional || schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault || schema instanceof z.ZodPrefault ||
    schema instanceof z.ZodCatch || schema instanceof z.ZodReadonly ||
    schema instanceof z.ZodNonOptional || schema instanceof z.ZodLazy
  ) {
    return resolveSchemas(schema.unwrap(), matches, visited);
  }
  return [];
}

function decimalPlaces(value: number): number {
  const [coefficient, exponent = "0"] = value.toString().split("e");
  const fractionLength = coefficient.split(".")[1]?.length ?? 0;
  return Math.min(MAX_FIXED_DECIMALS, Math.max(0, fractionLength - Number(exponent)));
}

function exclusiveBound(value: number, step: NumberInputConstraints["step"], direction: number): number {
  return step === "any" ? value : Number((value + direction * step).toFixed(decimalPlaces(step)));
}

function inputBound(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && Math.abs(value) < Number.MAX_SAFE_INTEGER;
}

/** Constraints for one numeric field schema. */
export function numberInputConstraints(schema: z.ZodType): NumberInputConstraints {
  const numbers = resolveSchemas(schema, (value): value is z.ZodNumber => value instanceof z.ZodNumber);
  if (numbers.length !== 1) return { step: "any" };
  const number = numbers[0];
  const bag = number._zod.bag;
  const step = typeof bag.multipleOf === "number"
    ? bag.multipleOf
    : number.isInt ? INTEGER_STEP : "any";
  const constraints: NumberInputConstraints = { step };
  const minima = [bag.minimum];
  const maxima = [bag.maximum];
  if (inputBound(bag.exclusiveMinimum)) minima.push(exclusiveBound(bag.exclusiveMinimum, step, 1));
  if (inputBound(bag.exclusiveMaximum)) maxima.push(exclusiveBound(bag.exclusiveMaximum, step, -1));
  const usableMinima = minima.filter(inputBound);
  const usableMaxima = maxima.filter(inputBound);
  if (usableMinima.length) constraints.min = Math.max(...usableMinima);
  if (usableMaxima.length) constraints.max = Math.min(...usableMaxima);
  return constraints;
}

function pathContainer(schema: Schema): z.ZodObject | z.ZodArray | undefined {
  const containers = resolveSchemas(schema, (value): value is z.ZodObject | z.ZodArray =>
    value instanceof z.ZodObject || value instanceof z.ZodArray);
  return containers.length === 1 ? containers[0] : undefined;
}

function schemaAtPath(schema: z.ZodType, path: string): z.ZodType | undefined {
  if (!path) return undefined;
  let current: Schema = schema;
  for (const segment of path.split(".")) {
    let container = pathContainer(current);
    const arrays = new Set<Schema>();
    while (container instanceof z.ZodArray) {
      if (arrays.has(container)) return undefined;
      arrays.add(container);
      current = container.element;
      if (ARRAY_INDEX_PATTERN.test(segment)) break;
      container = pathContainer(current);
    }
    if (container instanceof z.ZodArray) continue;
    if (!(container instanceof z.ZodObject) || !Object.hasOwn(container.shape, segment)) return undefined;
    current = container.shape[segment];
  }
  return current instanceof z.ZodType ? current : undefined;
}

/**
 * Look up dotted fields, with optional numeric array indexes. Results are cached
 * per path. An unresolved path throws an Error naming the path.
 */
export function numberInputConstraintsFor(schema: z.ZodType): (path: string) => NumberInputConstraints {
  const cache = new Map<string, NumberInputConstraints>();
  return path => {
    const cached = cache.get(path);
    if (cached) return cached;
    const field = schemaAtPath(schema, path);
    if (!field) throw new Error(`Number input schema not found for path "${path}".`);
    const constraints = numberInputConstraints(field);
    cache.set(path, constraints);
    return constraints;
  };
}
