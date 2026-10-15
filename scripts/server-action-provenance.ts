/** Reject conversions that discard a callable's trusted parameter contract. */
import ts from "typescript";
import { parameterCandidates, parameterSlotCount } from "./server-action-call-targets";
import {
  carriesAnyContext,
  elementCandidates,
  elementTypes,
  withoutNullish,
  type ParameterInspector,
} from "./server-action-types";

// Inspect each parameter shape once per checker run, including shared library
// types reached through namespace objects such as globalThis.
const contextDescriptions = new WeakMap<ParameterInspector, Map<ts.Type, string | null>>();
function describesContext(inspector: ParameterInspector, type: ts.Type): string | null {
  let cache = contextDescriptions.get(inspector);
  if (!cache) {
    cache = new Map();
    contextDescriptions.set(inspector, cache);
  }
  if (!cache.has(type)) cache.set(type, inspector.describe(type));
  return cache.get(type) ?? null;
}

/**
 * Compare the same property paths in both types. A sibling guarded method does
 * not preserve a lost method, and cycles terminate by (source, target) pair.
 * Callback parameters run in the opposite direction: the receiving API supplies
 * them, so an `any` in its signature must not reach the guarded parameter.
 */
export function losesGuardedSignature(
  checker: ts.TypeChecker,
  inspector: ParameterInspector,
  source: ts.Type,
  target: ts.Type,
  seen = new Map<ts.Type, Set<ts.Type>>(),
): boolean {
  if (source === target) return false;
  const targets = seen.get(source) ?? new Set<ts.Type>();
  if (targets.has(target)) return false;
  targets.add(target);
  seen.set(source, targets);
  const loses = (value: ts.Type, slot?: ts.Type): boolean =>
    losesGuardedSignature(checker, inspector, value, slot ?? checker.getUnknownType(), seen);
  if (source.flags & ts.TypeFlags.TypeParameter) {
    const constraint = checker.getBaseConstraintOfType(source);
    return !!constraint && loses(constraint, target);
  }
  if (source.isUnionOrIntersection()) return source.types.some((part) => loses(part, target));
  if (target.isUnion()) {
    const members = withoutNullish(target);
    return members.length ? members.every((part) => loses(source, part)) : loses(source);
  }
  if (!(source.flags & ts.TypeFlags.Object)) return false;
  for (const kind of [ts.SignatureKind.Call, ts.SignatureKind.Construct]) {
    const receiving = checker.getSignaturesOfType(target, kind);
    for (const signature of checker.getSignaturesOfType(source, kind)) {
      const guarded = Array.from({ length: parameterSlotCount(checker, signature) }, (_, index) =>
        parameterCandidates(checker, signature, index).map((type) => ({ type, index })))
        .flat().filter(({ type }) => describesContext(inspector, type));
      if (!guarded.length) continue;
      if (!receiving.length || receiving.some((candidate) => guarded.some(({ type, index }) => {
        const supplied = parameterCandidates(checker, candidate, index);
        return !supplied.length || supplied.some((slot) =>
          !describesContext(inspector, slot) || carriesAnyContext(checker, inspector, slot, type));
      }))) return true;
    }
  }
  const elements = elementTypes(checker, source);
  if (elements) {
    return elements.some((element, index) => {
      const slots = elementCandidates(checker, target, index);
      return slots.length ? slots.some((slot) => loses(element, slot)) : loses(element);
    });
  }
  for (const property of source.getProperties()) {
    const slot = checker.getPropertyOfType(target, property.name);
    const indexes = checker.getIndexInfosOfType(target).filter(({ keyType }) =>
      checker.isTypeAssignableTo(checker.getStringLiteralType(property.name), keyType));
    const value = checker.getTypeOfSymbol(property);
    if (slot ? loses(value, checker.getTypeOfSymbol(slot))
      : indexes.length ? indexes.some(({ type }) => loses(value, type)) : loses(value)) return true;
  }
  const indexes = checker.getIndexInfosOfType(target);
  return checker.getIndexInfosOfType(source).some((index) => {
    const slots = indexes.filter(({ keyType }) => checker.isTypeAssignableTo(index.keyType, keyType));
    return slots.length ? slots.some(({ type }) => loses(index.type, type)) : loses(index.type);
  });
}

/** Contextual types cover arguments, returns, annotated initializers and literal elements. */
export function provenanceTarget(checker: ts.TypeChecker, node: ts.Expression): ts.Type | undefined {
  if (ts.isSpreadElement(node)) return undefined;
  const parent = node.parent;
  if (ts.isSatisfiesExpression(parent) ||
    (ts.isPropertyAssignment(parent) && parent.name === node)) return undefined;
  // An inferred destructuring binding has a contextual tuple of `any` slots,
  // but retains the initializer's types. It is not an erasing annotation.
  if (ts.isVariableDeclaration(parent) && !parent.type) return undefined;
  if ((ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)) && parent.expression === node) {
    return ts.isConstTypeReference(parent.type) ? undefined : checker.getTypeFromTypeNode(parent.type);
  }
  if (ts.isBinaryExpression(parent) && parent.right === node &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) return checker.getTypeAtLocation(parent.left);
  const contextual = checker.getContextualType(node);
  if (contextual) return contextual;
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.includes(node)) {
    return checker.getUnknownType();
  }
  // Inference can erase a guarded value without providing a contextual type.
  // Object shorthand/property nodes sit between the value and its literal.
  const container = ts.isShorthandPropertyAssignment(parent) || ts.isPropertyAssignment(parent)
    ? parent.parent : parent;
  if (ts.isExpression(container)) {
    const inferred = checker.getTypeAtLocation(container);
    if (inferred.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return inferred;
    if (ts.isArrayLiteralExpression(container)) {
      const elements = elementTypes(checker, inferred);
      return elements?.find((type) => !!(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)));
    }
  }
  return undefined;
}
