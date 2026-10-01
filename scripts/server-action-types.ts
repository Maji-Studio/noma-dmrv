/**
 * Type-shape helpers for the Server Action boundary gate
 * (scripts/check-server-action-exports.ts): what makes a type an
 * organization context or a database handle, and whether an `any` reaches
 * such a slot.
 */
import ts from "typescript";

/** Any one of these properties makes an object type an organization context. */
const CONTEXT_PROPERTIES = ["organizationId", "orgRole", "isPlatformAdmin"];
/** Parameter or property names that carry a raw tenant id. */
export const TENANT_ID_NAMES = new Set(["organizationId", "orgId"]);
/** Members that together identify a Drizzle database or transaction. */
const DB_HANDLE_MEMBERS = ["select", "insert", "execute"] as const;
/** Members that together identify a raw pg client or pool. */
const PG_CLIENT_MEMBERS = ["query", "release"] as const;

/** Strips `as`, `!`, `satisfies`, type assertions and parentheses. */
export function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

export function withoutNullish(type: ts.Type): ts.Type[] {
  const members = type.isUnion() ? type.types : [type];
  return members.filter(
    (member) =>
      !(member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)),
  );
}

function typeHasMembers(
  checker: ts.TypeChecker,
  type: ts.Type,
  members: readonly string[],
): boolean {
  return members.every((member) => checker.getPropertyOfType(type, member));
}


export class ParameterInspector {
  constructor(private readonly checker: ts.TypeChecker) {}

  /** Why this parameter type must never cross the action boundary, if at all. */
  describe(type: ts.Type, seen = new Set<ts.Type>()): string | null {
    for (const member of withoutNullish(type)) {
      const reason = this.describeMember(member, seen);
      if (reason) return reason;
    }
    return null;
  }

  // The visited set, not a depth cap, bounds the walk: every type is inspected
  // at most once, so self-referential types terminate.
  private describeMember(type: ts.Type, seen: Set<ts.Type>): string | null {
    const { checker } = this;
    if (seen.has(type)) return null;
    seen.add(type);
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return null;
    if (type.flags & ts.TypeFlags.TypeParameter) {
      const constraint = checker.getBaseConstraintOfType(type);
      return constraint && constraint !== type
        ? this.describe(constraint, seen)
        : null;
    }
    if (type.isUnionOrIntersection()) {
      for (const part of type.types) {
        const reason = this.describeMember(part, seen);
        if (reason) return reason;
      }
      return null;
    }
    // Functions cannot be serialized from the browser, so a callback
    // parameter (withAction's `fn`) is not a forged-input channel.
    if (
      type.getCallSignatures().length > 0 &&
      type.getProperties().length === 0
    ) {
      return null;
    }
    if (checker.isArrayType(type) || checker.isTupleType(type)) {
      for (const element of checker.getTypeArguments(type as ts.TypeReference)) {
        const reason = this.describe(element, seen);
        if (reason) return reason;
      }
      return null;
    }
    if (!(type.flags & ts.TypeFlags.Object)) return null;

    const contextProperty = CONTEXT_PROPERTIES.find((name) =>
      checker.getPropertyOfType(type, name),
    );
    if (contextProperty) {
      return `accepts a caller-supplied organization context (${checker.typeToString(type)} has "${contextProperty}")`;
    }
    if (
      typeHasMembers(checker, type, DB_HANDLE_MEMBERS) ||
      typeHasMembers(checker, type, PG_CLIENT_MEMBERS)
    ) {
      return `accepts a database or transaction handle (${checker.typeToString(type)})`;
    }
    for (const property of checker.getPropertiesOfType(type)) {
      if (TENANT_ID_NAMES.has(property.name)) {
        return `property "${property.name}" accepts a raw tenant id`;
      }
      const declaration = property.valueDeclaration ?? property.declarations?.[0];
      if (!declaration) continue;
      const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
      const reason = this.describe(propertyType, seen);
      if (reason) return `property "${property.name}" ${reason}`;
    }
    // `Record<string, OrgContext>` and other index signatures carry values too.
    for (const index of checker.getIndexInfosOfType(type)) {
      const reason = this.describe(index.type, seen);
      if (reason) return `index signature ${reason}`;
    }
    return null;
  }
}


export function isAnyType(type: ts.Type): boolean {
  return withoutNullish(type).some(
    (member) => (member.flags & ts.TypeFlags.Any) !== 0,
  );
}

/** Element types of an array or tuple, or null for anything else. */
export function elementTypes(checker: ts.TypeChecker, type: ts.Type): readonly ts.Type[] | null {
  return checker.isArrayType(type) || checker.isTupleType(type)
    ? checker.getTypeArguments(type as ts.TypeReference)
    : null;
}

/** Element `index` of a tuple, or the element type of an array. */
export function elementAt(
  checker: ts.TypeChecker,
  type: ts.Type,
  index: number,
): ts.Type | undefined {
  const elements = elementTypes(checker, type);
  if (!elements) return undefined;
  return checker.isTupleType(type) ? elements[index] : elements[0];
}

/**
 * True when `valueType` puts an `any` where `targetType` expects a context
 * shape: the value itself (`JSON.parse(raw)`), or any tuple element, array
 * element, property or index-signature value of it (`{ scope: input }`,
 * `["report", input]`, `{ primary: input }` into a `Record`). TypeScript
 * checks nothing across that `any`.
 */
export function carriesAnyContext(
  checker: ts.TypeChecker,
  inspector: ParameterInspector,
  valueType: ts.Type,
  targetType: ts.Type,
  seen = new Map<ts.Type, Set<ts.Type>>(),
): boolean {
  if (!inspector.describe(targetType)) return false;
  if (isAnyType(valueType)) return true;
  // Memoise per (value, target) pair: one value type may meet several targets.
  const targets = seen.get(valueType) ?? new Set<ts.Type>();
  if (targets.has(targetType)) return false;
  targets.add(targetType);
  seen.set(valueType, targets);
  const carries = (value: ts.Type | undefined, target: ts.Type | undefined) =>
    !!value && !!target && carriesAnyContext(checker, inspector, value, target, seen);

  for (const value of withoutNullish(valueType)) {
    for (const target of withoutNullish(targetType)) {
      const valueElements = elementTypes(checker, value);
      if (valueElements && elementTypes(checker, target)) {
        if (
          valueElements.some((element, index) =>
            carries(element, elementAt(checker, target, index)),
          )
        ) {
          return true;
        }
        continue;
      }
      const targetIndexTypes = checker
        .getIndexInfosOfType(target)
        .map((info) => info.type);
      for (const valueProperty of checker.getPropertiesOfType(value)) {
        const property = checker.getPropertyOfType(target, valueProperty.name);
        const propertyValue = checker.getTypeOfSymbol(valueProperty);
        if (property) {
          if (carries(propertyValue, checker.getTypeOfSymbol(property))) return true;
        } else if (targetIndexTypes.some((indexType) => carries(propertyValue, indexType))) {
          return true;
        }
      }
      for (const info of checker.getIndexInfosOfType(value)) {
        if (targetIndexTypes.some((indexType) => carries(info.type, indexType))) {
          return true;
        }
      }
    }
  }
  return false;
}
