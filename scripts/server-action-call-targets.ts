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
  /** Callable consumed by a precisely checked invocation, rather than stored. */
  target?: ts.Expression;
  /** Index of the first argument that binds a parameter. */
  firstArgument: number;
  /**
   * Parameters already bound by `.bind(this, …)` before this call, or null
   * when a spread inside the `.bind` hides how many.
   */
  boundParameters: number | null;
  /** `.apply`: the arguments arrive as one array. */
  applied: boolean;
  /** Reflect invokes this built-in forwarder with its receiver as thisArg. */
  appliedForwarder?: string;
}

/** Interfaces in the default lib that declare `call`/`apply`/`bind`. */
const FUNCTION_INTERFACES = new Set(["Function", "CallableFunction", "NewableFunction"]);

function isDefaultLib(declaration: ts.Declaration): boolean {
  return declaration.getSourceFile().hasNoDefaultLib;
}

/** Callable/constructable signatures, including nullable targets. */
function signaturesOf(checker: ts.TypeChecker, target: ts.Expression): readonly ts.Signature[] {
  const type = checker.getNonNullableType(checker.getTypeAtLocation(target));
  return [...type.getCallSignatures(), ...type.getConstructSignatures()];
}

/** Follow local callable aliases before a cast or annotation erased their type. */
function callableSource(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  seen = new Set<ts.Node>(),
): ts.Expression {
  const source = unwrapExpression(expression);
  if (seen.has(source)) return source;
  seen.add(source);
  const declaration = ts.isIdentifier(source)
    ? checker.getSymbolAtLocation(source)?.valueDeclaration
    : undefined;
  return declaration && ts.isVariableDeclaration(declaration) && declaration.initializer
    && ts.isVariableDeclarationList(declaration.parent)
    && (declaration.parent.flags & ts.NodeFlags.Const)
    ? callableSource(checker, declaration.initializer, seen)
    : source;
}

function stringKey(checker: ts.TypeChecker, expression: ts.Expression): string | null {
  const type = checker.getTypeAtLocation(expression);
  return type.isStringLiteral() ? type.value : null;
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
    ts.isElementAccessExpression(callee)
  ) {
    method = stringKey(checker, callee.argumentExpression);
    target = callee.expression;
  }
  if (!method || !target || !FUNCTION_FORWARDERS.has(method)) return null;
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

/** Default-lib Reflect methods, including element access and local aliases. */
function reflectMethod(checker: ts.TypeChecker, expression: ts.Expression): string | null {
  const callee = callableSource(checker, expression);
  let symbol: ts.Symbol | undefined;
  if (ts.isPropertyAccessExpression(callee)) {
    symbol = checker.getSymbolAtLocation(callee.name);
  } else if (
    ts.isElementAccessExpression(callee)
  ) {
    symbol = checker.getPropertyOfType(
      checker.getTypeAtLocation(callee.expression),
      stringKey(checker, callee.argumentExpression) ?? "",
    );
  } else if (ts.isIdentifier(callee)) {
    const binding = checker.getSymbolAtLocation(callee)?.valueDeclaration;
    if (binding && ts.isBindingElement(binding) && ts.isObjectBindingPattern(binding.parent)) {
      const variable = binding.parent.parent;
      const name = binding.propertyName ?? binding.name;
      if (ts.isVariableDeclaration(variable) && variable.initializer && ts.isIdentifier(name)
        && ts.isVariableDeclarationList(variable.parent) && (variable.parent.flags & ts.NodeFlags.Const)) {
        symbol = checker.getPropertyOfType(
          checker.getTypeAtLocation(variable.initializer),
          name.text,
        );
      }
    }
  }
  const declaration = symbol?.declarations?.[0];
  const namespace = declaration?.parent?.parent;
  if (
    declaration &&
    isDefaultLib(declaration) &&
    namespace &&
    ts.isModuleDeclaration(namespace) &&
    namespace.name.getText() === "Reflect"
  ) {
    return symbol?.name ?? null;
  }
  return null;
}

export function invokedFunction(
  checker: ts.TypeChecker,
  call: ts.CallExpression | ts.NewExpression,
): InvokedFunction | null {
  const callee = callableSource(checker, call.expression);
  // Overloads: the one implementation behind them receives the argument
  // whichever overload TypeScript picks for the forwarder, so every declared
  // signature is checked.
  const forwarded = forwarderTarget(checker, callee);
  if (forwarded) {
    const inner = forwarderTarget(checker, callableSource(checker, forwarded.target));
    // Calling a built-in forwarder supplies its receiver as the first argument.
    // Preserve that receiver's signatures instead of the untyped lib signature.
    if (inner && forwarded.method === "call" && call.arguments?.[0]) {
      return {
        target: inner.method === "bind" ? undefined : call.arguments[0],
        signatures: signaturesOf(checker, call.arguments[0]),
        firstArgument: 2,
        boundParameters: 0,
        applied: inner.method === "apply",
      };
    }
    return {
      signatures: signaturesOf(checker, forwarded.target),
      firstArgument: 1,
      boundParameters: 0,
      applied: forwarded.method === "apply",
    };
  }
  const reflectSlots = argumentSlots(checker, call.arguments ?? [], 0);
  const reflectTarget = reflectSlots.find((slot) => slot.position === 0 && !slot.open)?.value;
  const reflected = reflectMethod(checker, callee);
  if (reflectTarget && (reflected === "apply" || reflected === "construct")) {
    const forwarder = forwarderTarget(checker, callableSource(checker, reflectTarget));
    const receiver = reflectSlots.find((slot) => slot.position === 1 && !slot.open)?.value;
    if (reflected === "apply" && forwarder && receiver) {
      return {
        target: forwarder.method === "bind" ? undefined : receiver,
        signatures: signaturesOf(checker, receiver),
        firstArgument: 2,
        boundParameters: 0,
        applied: true,
        appliedForwarder: forwarder.method,
      };
    }
    return {
      target: reflectTarget,
      signatures: signaturesOf(checker, reflectTarget),
      firstArgument: reflected === "apply" ? 2 : 1,
      boundParameters: 0,
      applied: true,
    };
  }
  // `fn.bind(this, a)(b)`: b binds the parameter after the bound ones.
  if (ts.isCallExpression(callee)) {
    const nested = nestedBind(checker, callee);
    if (nested) return { ...nested, firstArgument: 0, applied: false };
    const bound = forwarderTarget(checker, unwrapExpression(callee.expression));
    if (bound?.method === "bind") {
      return {
        signatures: signaturesOf(checker, bound.target),
        firstArgument: 0,
        boundParameters: boundParameterCount(checker, callee.arguments),
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

/** A nested bind is consumed only by a later invocation we can check. */
function nestedBind(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
): Pick<InvokedFunction, "target" | "signatures" | "boundParameters"> | null {
  const callee = callableSource(checker, call.expression);
  const outer = forwarderTarget(checker, callee);
  const inner = outer && forwarderTarget(checker, callableSource(checker, outer.target));
  let target: ts.Expression | undefined;
  let slots: ArgumentSlot[];
  if (outer?.method === "call" && inner?.method === "bind") {
    target = call.arguments[0];
    slots = argumentSlots(checker, call.arguments.slice(1), 0);
  } else if (reflectMethod(checker, callee) === "apply" && call.arguments[0] &&
    forwarderTarget(checker, callableSource(checker, call.arguments[0]))?.method === "bind") {
    target = call.arguments[1];
    slots = appliedSlots(checker, call.arguments[2], 0, false);
  } else return null;
  if (!target) return null;
  return {
    target,
    signatures: signaturesOf(checker, target),
    boundParameters: slots.some((slot) => slot.open) ? null : Math.max(0, slots.length - 1),
  };
}

/** Number of logical slots, expanding tuple-rest parameters. */
export function parameterSlotCount(checker: ts.TypeChecker, signature: ts.Signature): number {
  const parameters = signature.getParameters();
  const last = parameters[parameters.length - 1];
  const declaration = last?.valueDeclaration;
  const elements = declaration && ts.isParameter(declaration) && declaration.dotDotDotToken
    ? elementTypes(checker, checker.getTypeOfSymbol(last)) : null;
  return parameters.length + Math.max(0, (elements?.length ?? 0) - 1);
}

/** The declared parameter types that may receive the value at `index`. */
export function parameterCandidates(
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
  /** Available for ordinary arguments, but not individual spread elements. */
  value?: ts.Expression;
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
      slots.push({
        node, value: argument, type: checker.getTypeAtLocation(argument), position, open,
      });
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
    const literal = unwrapExpression(argument.expression);
    if (ts.isArrayLiteralExpression(literal) && !literal.elements.some(ts.isSpreadElement)) {
      spread.slots.forEach((slot, index) => { slot.value = literal.elements[index]; });
    }
    slots.push(...spread.slots);
    position = spread.next;
    open = spread.open;
  }
  return slots;
}

function boundParameterCount(checker: ts.TypeChecker, args: readonly ts.Expression[]): number | null {
  const slots = argumentSlots(checker, args, 0);
  return slots.some((slot) => slot.open) ? null : Math.max(0, slots.length - 1);
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
  // Expand fixed tuples before removing thisArg. Only variable-length
  // spreads can hide where the parameter-binding arguments begin.
  const allSlots = argumentSlots(checker, allArgs, 0);
  const positionsKnown =
    invoked.boundParameters !== null &&
    !allSlots.some((slot) => slot.open && slot.position < invoked.firstArgument);
  const offset = invoked.boundParameters ?? 0;
  const forwardedSlots = positionsKnown
    ? allSlots.filter((slot) => slot.position >= invoked.firstArgument)
    : allSlots;
  let slots = invoked.applied
    ? forwardedSlots
      .filter((slot) => !positionsKnown || slot.position === invoked.firstArgument)
      .flatMap((slot) => slot.value
        ? appliedSlots(checker, slot.value, offset, !positionsKnown)
        : spreadSlots(checker, slot.node, slot.type, offset, !positionsKnown).slots)
    : forwardedSlots.map((slot) => ({
      ...slot,
      position: positionsKnown ? slot.position - invoked.firstArgument + offset : 0,
      open: slot.open || !positionsKnown,
    }));
  if (invoked.appliedForwarder === "apply") {
    slots = slots.filter((slot) => slot.open || slot.position === 1).flatMap((slot) =>
      slot.value
        ? appliedSlots(checker, slot.value, offset, slot.open)
        : spreadSlots(checker, slot.node, slot.type, offset, slot.open).slots);
  } else if (invoked.appliedForwarder) {
    slots = slots.filter((slot) => slot.open || slot.position >= 1).map((slot) => ({
      ...slot, position: Math.max(0, slot.position - 1),
    }));
  }
  for (const slot of slots) {
    if (findings.has(slot.node) || isExempt(slot.node)) continue;
    for (const signature of invoked.signatures) {
      const from = positionsKnown ? Math.max(0, slot.position) : 0;
      const count = Math.max(parameterSlotCount(checker, signature), from + 1);
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
