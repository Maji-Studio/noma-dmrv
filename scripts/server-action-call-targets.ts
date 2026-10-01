/**
 * Lines a call's arguments up with the declared parameters of the function it
 * actually invokes, for the Server Action boundary gate
 * (scripts/check-server-action-exports.ts). Spreads, `.call`/`.apply`/`.bind`
 * and generic inference all hide a context slot from the contextual type.
 */
import ts from "typescript";
import {
  carriesAnyContext,
  elementAt,
  elementTypes,
  unwrapExpression,
  type ParameterInspector,
} from "./server-action-types";

/** `Function.prototype` members that invoke or partially apply their receiver. */
const FUNCTION_FORWARDERS = new Set(["call", "apply", "bind"]);

/**
 * The function a call ultimately invokes and how its arguments line up with
 * that function's parameters. `.call`/`.apply`/`.bind` and calling a bound
 * function all erase the parameter types from the contextual type (TypeScript
 * infers the forwarded tuple from the arguments), so the declared signatures
 * are checked instead.
 */
export interface InvokedFunction {
  signatures: readonly ts.Signature[];
  /** Index of the first argument that binds a parameter. */
  firstArgument: number;
  /** Parameters already bound by `.bind(this, …)` before this call. */
  boundParameters: number;
  /** `.apply`: the arguments arrive as one array. */
  applied: boolean;
}

function forwarderTarget(
  checker: ts.TypeChecker,
  callee: ts.Expression,
): { method: string; target: ts.Expression } | null {
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const method = callee.name.text;
  if (!FUNCTION_FORWARDERS.has(method)) return null;
  const target = callee.expression;
  if (checker.getTypeAtLocation(target).getCallSignatures().length === 0) return null;
  return { method, target };
}

export function invokedFunction(
  checker: ts.TypeChecker,
  call: ts.CallExpression | ts.NewExpression,
): InvokedFunction | null {
  const callee = unwrapExpression(call.expression);
  const forwarded = forwarderTarget(checker, callee);
  if (forwarded) {
    return {
      signatures: checker.getTypeAtLocation(forwarded.target).getCallSignatures(),
      firstArgument: 1,
      boundParameters: 0,
      applied: forwarded.method === "apply",
    };
  }
  // `fn.bind(this, a)(b)`: b binds the parameter after the bound ones.
  if (ts.isCallExpression(callee)) {
    const bound = forwarderTarget(checker, unwrapExpression(callee.expression));
    if (bound?.method === "bind") {
      return {
        signatures: checker.getTypeAtLocation(bound.target).getCallSignatures(),
        firstArgument: 0,
        boundParameters: Math.max(0, callee.arguments.length - 1),
        applied: false,
      };
    }
  }
  // A direct call: the declared (uninstantiated) signature, so a generic
  // `<T extends OrgContext>(ctx: T)` keeps its constraint instead of the
  // `any` that inference substitutes for T.
  const declaration = checker.getResolvedSignature(call)?.getDeclaration();
  const declared =
    declaration && ts.isFunctionLike(declaration)
      ? checker.getSignatureFromDeclaration(declaration)
      : undefined;
  return declared
    ? { signatures: [declared], firstArgument: 0, boundParameters: 0, applied: false }
    : null;
}

/** The declared type of parameter `index`, reading into a rest parameter. */
function parameterTypeAt(
  checker: ts.TypeChecker,
  signature: ts.Signature,
  index: number,
): ts.Type | undefined {
  const parameters = signature.getParameters();
  const last = parameters[parameters.length - 1];
  const lastDeclaration = last?.valueDeclaration;
  const restIndex =
    lastDeclaration && ts.isParameter(lastDeclaration) && lastDeclaration.dotDotDotToken
      ? parameters.length - 1
      : -1;
  if (restIndex >= 0 && index >= restIndex) {
    const restType = checker.getTypeOfSymbol(last);
    return elementAt(checker, restType, index - restIndex) ?? restType;
  }
  const parameter = parameters[index];
  return parameter ? checker.getTypeOfSymbol(parameter) : undefined;
}

interface ArgumentSlot {
  /** The argument reported for this value (the spread, or the `.apply` array). */
  node: ts.Expression;
  type: ts.Type;
  position: number;
  /** Position unknown past `position` (after a spread of unknown length). */
  open: boolean;
}

/**
 * The value types an argument list feeds into each parameter position. A
 * spread of a tuple occupies one position per element; a spread whose length
 * is unknown makes every later position unknown, so its values are matched
 * against all remaining parameters.
 */
function argumentSlots(
  checker: ts.TypeChecker,
  args: readonly ts.Expression[],
  firstParameter: number,
): ArgumentSlot[] {
  const slots: ArgumentSlot[] = [];
  let position = firstParameter;
  let open = false;
  for (const argument of args) {
    if (!ts.isSpreadElement(argument)) {
      slots.push({ node: argument, type: checker.getTypeAtLocation(argument), position, open });
      position += 1;
      continue;
    }
    const spreadType = checker.getTypeAtLocation(argument.expression);
    const elements = elementTypes(checker, spreadType);
    if (elements && checker.isTupleType(spreadType)) {
      for (const element of elements) {
        slots.push({ node: argument, type: element, position, open });
        position += 1;
      }
      continue;
    }
    slots.push({ node: argument, type: elements?.[0] ?? spreadType, position, open: true });
    open = true;
  }
  return slots;
}

/** Arguments that hand an `any` to a context-shaped declared parameter, with why. */
export function declaredParameterFindings(
  checker: ts.TypeChecker,
  inspector: ParameterInspector,
  call: ts.CallExpression | ts.NewExpression,
  invoked: InvokedFunction,
  /** Arguments already accounted for (a guard finding, the session context). */
  isExempt: (argument: ts.Expression) => boolean,
): Map<ts.Expression, string> {
  const findings = new Map<ts.Expression, string>();
  const args = (call.arguments ?? []).slice(invoked.firstArgument);
  const slots = invoked.applied
    ? appliedSlots(checker, args[0], invoked.boundParameters)
    : argumentSlots(checker, args, invoked.boundParameters);
  for (const slot of slots) {
    if (findings.has(slot.node) || isExempt(slot.node)) continue;
    for (const signature of invoked.signatures) {
      const count = Math.max(signature.getParameters().length, slot.position + 1);
      const positions = slot.open
        ? Array.from({ length: count - slot.position }, (_, i) => slot.position + i)
        : [slot.position];
      const target = positions
        .map((position) => parameterTypeAt(checker, signature, position))
        .find((type) => type && carriesAnyContext(checker, inspector, slot.type, type));
      if (target) {
        findings.set(slot.node, inspector.describe(target) ?? "");
        break;
      }
    }
  }
  return findings;
}

/** `.apply(this, args)`: the array literal's elements, or its element type. */
function appliedSlots(
  checker: ts.TypeChecker,
  argsArray: ts.Expression | undefined,
  firstParameter: number,
): ArgumentSlot[] {
  if (!argsArray) return [];
  const literal = unwrapExpression(argsArray);
  if (ts.isArrayLiteralExpression(literal)) {
    return argumentSlots(checker, literal.elements, firstParameter).map((slot) => ({
      ...slot,
      node: argsArray,
    }));
  }
  const arrayType = checker.getTypeAtLocation(argsArray);
  const elements = elementTypes(checker, arrayType);
  if (elements && checker.isTupleType(arrayType)) {
    return elements.map((type, index) => ({
      node: argsArray,
      type,
      position: firstParameter + index,
      open: false,
    }));
  }
  return [
    { node: argsArray, type: elements?.[0] ?? arrayType, position: firstParameter, open: true },
  ];
}
