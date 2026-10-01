/**
 * Lines a call's arguments up with the declared parameters of the function it
 * actually invokes, for the Server Action boundary gate
 * (scripts/check-server-action-exports.ts). Spreads, `.call`/`.apply`/`.bind`
 * and generic inference all hide a context slot from the contextual type.
 */
import ts from "typescript";
import {
  carriesAnyContext,
  elementCandidates,
  elementTypes,
  fixedPrefixLength,
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
  /**
   * Parameters already bound by `.bind(this, …)` before this call, or null
   * when a spread inside the `.bind` hides how many.
   */
  boundParameters: number | null;
  /** `.apply`: the arguments arrive as one array. */
  applied: boolean;
}

/** Interfaces in the default lib that declare `call`/`apply`/`bind`. */
const FUNCTION_INTERFACES = new Set(["Function", "CallableFunction", "NewableFunction"]);

function isDefaultLib(declaration: ts.Declaration): boolean {
  return declaration.getSourceFile().hasNoDefaultLib;
}

/** Call signatures of a possibly nullable function (`maybeCore?.call(…)`). */
function signaturesOf(checker: ts.TypeChecker, target: ts.Expression): readonly ts.Signature[] {
  return checker.getNonNullableType(checker.getTypeAtLocation(target)).getCallSignatures();
}

/** `core.call`, `core["call"]`, `maybeCore?.call`: the built-in forwarder only. */
function forwarderTarget(
  checker: ts.TypeChecker,
  callee: ts.Expression,
): { method: string; target: ts.Expression } | null {
  let method: string | null = null;
  let target: ts.Expression | null = null;
  if (ts.isPropertyAccessExpression(callee)) {
    method = callee.name.text;
    target = callee.expression;
  } else if (
    ts.isElementAccessExpression(callee) &&
    ts.isStringLiteralLike(callee.argumentExpression)
  ) {
    method = callee.argumentExpression.text;
    target = callee.expression;
  }
  if (!method || !target || !FUNCTION_FORWARDERS.has(method)) return null;
  if (signaturesOf(checker, target).length === 0) return null;
  // A callable object's own `call` method is not Function.prototype.call.
  const member = checker.getPropertyOfType(
    checker.getApparentType(checker.getNonNullableType(checker.getTypeAtLocation(target))),
    method,
  );
  const owner = member?.declarations?.[0]?.parent;
  if (
    !owner ||
    !ts.isInterfaceDeclaration(owner) ||
    !FUNCTION_INTERFACES.has(owner.name.text) ||
    !isDefaultLib(owner)
  ) {
    return null;
  }
  return { method, target };
}

/** `Reflect.apply(fn, thisArg, args)` from the default lib. */
function isReflectApply(checker: ts.TypeChecker, callee: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "apply") return false;
  const declaration = checker.getSymbolAtLocation(callee.name)?.declarations?.[0];
  const namespace = declaration?.parent?.parent;
  return (
    !!declaration &&
    isDefaultLib(declaration) &&
    !!namespace &&
    ts.isModuleDeclaration(namespace) &&
    namespace.name.getText() === "Reflect"
  );
}

export function invokedFunction(
  checker: ts.TypeChecker,
  call: ts.CallExpression | ts.NewExpression,
): InvokedFunction | null {
  const callee = unwrapExpression(call.expression);
  // Overloads: the one implementation behind them receives the argument
  // whichever overload TypeScript picks for the forwarder, so every declared
  // signature is checked.
  const forwarded = forwarderTarget(checker, callee);
  if (forwarded) {
    return {
      signatures: signaturesOf(checker, forwarded.target),
      firstArgument: 1,
      boundParameters: 0,
      applied: forwarded.method === "apply",
    };
  }
  const [reflectTarget] = call.arguments ?? [];
  if (reflectTarget && isReflectApply(checker, callee)) {
    return {
      signatures: signaturesOf(checker, reflectTarget),
      firstArgument: 2,
      boundParameters: 0,
      applied: true,
    };
  }
  // `fn.bind(this, a)(b)`: b binds the parameter after the bound ones.
  if (ts.isCallExpression(callee)) {
    const bound = forwarderTarget(checker, unwrapExpression(callee.expression));
    if (bound?.method === "bind") {
      return {
        signatures: signaturesOf(checker, bound.target),
        firstArgument: 0,
        boundParameters: callee.arguments.some(ts.isSpreadElement)
          ? null
          : Math.max(0, callee.arguments.length - 1),
        applied: false,
      };
    }
  }
  // A direct call: the resolved signature keeps parameter types fixed by the
  // receiver (`push(...items)` on an `OrgContext[]`); the declared one keeps a
  // generic constraint (`<T extends OrgContext>(ctx: T)`) that inference
  // replaces with the argument's `any`.
  const resolved = checker.getResolvedSignature(call);
  const declaration = resolved?.getDeclaration();
  const declared =
    declaration && ts.isFunctionLike(declaration)
      ? checker.getSignatureFromDeclaration(declaration)
      : undefined;
  const signatures = [resolved, declared].filter(
    (signature, index, all): signature is ts.Signature =>
      !!signature && all.indexOf(signature) === index,
  );
  return signatures.length > 0
    ? { signatures, firstArgument: 0, boundParameters: 0, applied: false }
    : null;
}

/** The declared parameter types that may receive the value at `index`. */
function parameterCandidates(
  checker: ts.TypeChecker,
  signature: ts.Signature,
  index: number,
): readonly ts.Type[] {
  const parameters = signature.getParameters();
  const last = parameters[parameters.length - 1];
  const lastDeclaration = last?.valueDeclaration;
  const restIndex =
    lastDeclaration && ts.isParameter(lastDeclaration) && lastDeclaration.dotDotDotToken
      ? parameters.length - 1
      : -1;
  if (restIndex >= 0 && index >= restIndex) {
    const restType = checker.getTypeOfSymbol(last);
    // A generic rest (`...args: T`) has no elements to read; compare it whole.
    return elementTypes(checker, restType)
      ? elementCandidates(checker, restType, index - restIndex)
      : [restType];
  }
  const parameter = parameters[index];
  return parameter ? [checker.getTypeOfSymbol(parameter)] : [];
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
 * The values a spread (or `.apply` list) yields when it is not an array or
 * tuple: an `ArrayLike`'s number index (`arguments`), an iterable's type
 * arguments (`Set<any>`), or `any` when neither says, so the check fails
 * closed.
 */
function iteratedTypes(checker: ts.TypeChecker, type: ts.Type): readonly ts.Type[] {
  if (type.flags & ts.TypeFlags.Any) return [type];
  const numberIndex = checker.getIndexInfoOfType(type, ts.IndexKind.Number)?.type;
  if (numberIndex) return [numberIndex];
  const typeArguments =
    type.flags & ts.TypeFlags.Object &&
    (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
      ? checker.getTypeArguments(type as ts.TypeReference)
      : [];
  return typeArguments.length > 0 ? typeArguments : [checker.getAnyType()];
}

/**
 * The slots a spread value fills from `position`: one per element of a
 * tuple's known prefix, then (variable tail, array, iterable) values whose
 * position is unknown.
 */
function spreadSlots(
  checker: ts.TypeChecker,
  node: ts.Expression,
  type: ts.Type,
  position: number,
  open: boolean,
): { slots: ArgumentSlot[]; next: number; open: boolean } {
  const elements = elementTypes(checker, type);
  const prefix = elements && checker.isTupleType(type) ? fixedPrefixLength(checker, type) : 0;
  const slots: ArgumentSlot[] = (elements ?? [])
    .slice(0, prefix)
    .map((element, index) => ({ node, type: element, position: position + index, open }));
  const tail = elements ? elements.slice(prefix) : iteratedTypes(checker, type);
  if (elements && tail.length === 0) return { slots, next: position + prefix, open };
  for (const element of tail) {
    slots.push({ node, type: element, position: position + prefix, open: true });
  }
  return { slots, next: position + prefix, open: true };
}

/**
 * The value types an argument list feeds into each parameter position. A
 * spread of unknown length makes every later position unknown, so its values
 * (and everything after it) are matched against all remaining parameters.
 */
function argumentSlots(
  checker: ts.TypeChecker,
  args: readonly ts.Expression[],
  firstParameter: number,
  initiallyOpen = false,
  reportAs?: ts.Expression,
): ArgumentSlot[] {
  const slots: ArgumentSlot[] = [];
  let position = firstParameter;
  let open = initiallyOpen;
  for (const argument of args) {
    const node = reportAs ?? argument;
    if (!ts.isSpreadElement(argument)) {
      slots.push({ node, type: checker.getTypeAtLocation(argument), position, open });
      position += 1;
      continue;
    }
    const spread = spreadSlots(
      checker,
      node,
      checker.getTypeAtLocation(argument.expression),
      position,
      open,
    );
    slots.push(...spread.slots);
    position = spread.next;
    open = spread.open;
  }
  return slots;
}

/** `.apply(this, args)` / `Reflect.apply(fn, this, args)`: the list's values. */
function appliedSlots(
  checker: ts.TypeChecker,
  argsArray: ts.Expression | undefined,
  firstParameter: number,
  open: boolean,
): ArgumentSlot[] {
  if (!argsArray) return [];
  const literal = unwrapExpression(argsArray);
  if (ts.isArrayLiteralExpression(literal)) {
    return argumentSlots(checker, literal.elements, firstParameter, open, argsArray);
  }
  return spreadSlots(checker, argsArray, checker.getTypeAtLocation(argsArray), firstParameter, open)
    .slots;
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
  const allArgs = call.arguments ?? [];
  // A spread before the first parameter-binding argument (`core.call(...xs)`)
  // or inside `.bind` hides every position: match all arguments everywhere.
  const positionsKnown =
    invoked.boundParameters !== null &&
    !allArgs.slice(0, invoked.firstArgument).some(ts.isSpreadElement);
  const slots = !positionsKnown
    ? argumentSlots(checker, allArgs, 0, true)
    : invoked.applied
      ? appliedSlots(checker, allArgs[invoked.firstArgument], invoked.boundParameters ?? 0, false)
      : argumentSlots(checker, allArgs.slice(invoked.firstArgument), invoked.boundParameters ?? 0);
  for (const slot of slots) {
    if (findings.has(slot.node) || isExempt(slot.node)) continue;
    for (const signature of invoked.signatures) {
      const from = positionsKnown ? Math.max(0, slot.position) : 0;
      const count = Math.max(signature.getParameters().length, from + 1);
      const positions = slot.open
        ? Array.from({ length: count - from }, (_, i) => from + i)
        : [slot.position];
      const target = positions
        .flatMap((position) => parameterCandidates(checker, signature, position))
        .find((type) => carriesAnyContext(checker, inspector, slot.type, type));
      if (target) {
        findings.set(slot.node, inspector.describe(target) ?? "");
        break;
      }
    }
  }
  return findings;
}
