import type { SlopFinding } from "../types.js";
import type { FileUnit } from "../scan/parse.js";

/**
 * Detect over-abstraction slop: ceremony that adds indirection without adding
 * behaviour. Pure function over the AST — deterministic, no I/O.
 *
 * Flags:
 *  - factory/provider/manager/wrapper/service classes with a single real method
 *  - single-method interfaces (an interface that could just be a function type)
 *  - pass-through functions whose body only forwards the same args to another fn
 *  - deep wrapper chains where every layer just calls the next (single caller)
 */
export function detectOverAbstraction(unit: FileUnit): SlopFinding[] {
  if (!unit.ast) return [];
  const findings: SlopFinding[] = [];

  // ---- collect declarations + a simple call graph -------------------------
  const functions: FnInfo[] = [];
  const fnByName = new Map<string, FnInfo>();

  walk(unit.ast, (node) => {
    // classes
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      inspectClass(node, unit, findings);
    }
    // interfaces
    if (node.type === "TSInterfaceDeclaration") {
      inspectInterface(node, unit, findings);
    }
    // function-shaped declarations
    if (isFunctionLike(node)) {
      const info = describeFunction(node);
      if (info) {
        functions.push(info);
        if (info.name) fnByName.set(info.name, info);
      }
    }
  });

  // pass-through functions
  for (const fn of functions) {
    if (isPassThrough(fn.node)) {
      findings.push({
        file: unit.file,
        line: fn.line,
        category: "over_abstraction",
        weight: 0.5,
        evidence: fn.name
          ? `function "${fn.name}" is a pass-through that just forwards its args to another call`
          : `pass-through function that just forwards its args to another call`,
      });
    }
  }

  // ---- deep single-caller wrapper chains ----------------------------------
  // Build "who does this named fn call (the single inner call it forwards to)".
  const forwardsTo = new Map<string, string>(); // fnName -> callee name
  const callCounts = new Map<string, number>(); // callee name -> # of call sites repo-wide (this file)
  for (const fn of functions) {
    const inner = singleForwardCallee(fn.node);
    if (fn.name && inner) forwardsTo.set(fn.name, inner);
  }
  walk(unit.ast, (node) => {
    if (node.type === "CallExpression") {
      const callee = calleeName(node.callee);
      if (callee) callCounts.set(callee, (callCounts.get(callee) ?? 0) + 1);
    }
  });

  for (const fn of functions) {
    if (!fn.name) continue;
    const chain = followChain(fn.name, forwardsTo, fnByName, callCounts);
    if (chain.length >= 3) {
      findings.push({
        file: unit.file,
        line: fn.line,
        category: "over_abstraction",
        weight: Math.min(1, 0.4 + 0.15 * (chain.length - 2)),
        evidence: `${chain.length}-deep wrapper chain (${chain.join(" → ")}), each layer single-caller pass-through`,
      });
    }
  }

  return dedupeByLine(findings);
}

interface FnInfo {
  node: any;
  name: string | null;
  line: number;
}

const LAYER_NAME_RE = /(Factory|Provider|Manager|Wrapper|Service|Helper|Handler|Controller|Builder)$/;

function inspectClass(node: any, unit: FileUnit, out: SlopFinding[]): void {
  const className: string | null = node.id?.name ?? null;
  const body = node.body?.body ?? [];
  const realMethods = body.filter((m: any) => {
    if (m.type !== "ClassMethod") return false;
    if (m.kind === "constructor") return false;
    if (m.kind === "get" || m.kind === "set") return false;
    return true;
  });

  if (className && LAYER_NAME_RE.test(className) && realMethods.length === 1) {
    const m = realMethods[0];
    out.push({
      file: unit.file,
      line: lineOf(node),
      category: "over_abstraction",
      weight: 0.6,
      evidence: `class "${className}" is a ${suffixWord(className)} with a single real method "${methodName(m)}" — likely a needless layer`,
    });
  }
}

function inspectInterface(node: any, unit: FileUnit, out: SlopFinding[]): void {
  const name: string | null = node.id?.name ?? null;
  const members = node.body?.body ?? [];
  const methodMembers = members.filter(
    (m: any) => m.type === "TSMethodSignature",
  );
  const propMembers = members.filter(
    (m: any) => m.type === "TSPropertySignature",
  );
  if (methodMembers.length === 1 && propMembers.length === 0) {
    out.push({
      file: unit.file,
      line: lineOf(node),
      category: "over_abstraction",
      weight: 0.4,
      evidence: name
        ? `interface "${name}" has a single method — a plain function type would do`
        : `single-method interface — a plain function type would do`,
    });
  }
}

/** A pass-through forwards the SAME params, in order, to one inner call. */
function isPassThrough(fnNode: any): boolean {
  const callee = singleForwardCallee(fnNode);
  if (!callee) return false;
  const params: string[] = (fnNode.params ?? [])
    .map((p: any) => (p.type === "Identifier" ? p.name : null))
    .filter((x: any): x is string => !!x);
  if (params.length === 0) return false; // 0-arg forwards are often legit (init, etc.)
  const call = soleReturnedOrExpressedCall(fnNode);
  if (!call) return false;
  const args: string[] = (call.arguments ?? [])
    .map((a: any) => (a.type === "Identifier" ? a.name : null));
  if (args.length !== params.length) return false;
  for (let i = 0; i < params.length; i++) {
    if (args[i] !== params[i]) return false;
  }
  return true;
}

/** Returns the callee name if the fn body is exactly one forwarding call. */
function singleForwardCallee(fnNode: any): string | null {
  const call = soleReturnedOrExpressedCall(fnNode);
  if (!call) return null;
  return calleeName(call.callee);
}

/**
 * If the function body is a single statement that is `return X(...)`,
 * `X(...)`, or `return await X(...)`, return that CallExpression.
 */
function soleReturnedOrExpressedCall(fnNode: any): any | null {
  const body = fnNode.body;
  // arrow with expression body: () => foo(a)
  if (body && body.type !== "BlockStatement") {
    return unwrapCall(body);
  }
  const stmts = body?.body ?? [];
  if (stmts.length !== 1) return null;
  const s = stmts[0];
  if (s.type === "ReturnStatement") return unwrapCall(s.argument);
  if (s.type === "ExpressionStatement") return unwrapCall(s.expression);
  return null;
}

function unwrapCall(expr: any): any | null {
  if (!expr) return null;
  if (expr.type === "AwaitExpression") return unwrapCall(expr.argument);
  if (expr.type === "CallExpression") return expr;
  return null;
}

function followChain(
  start: string,
  forwardsTo: Map<string, string>,
  fnByName: Map<string, FnInfo>,
  callCounts: Map<string, number>,
): string[] {
  const chain: string[] = [start];
  const seen = new Set<string>([start]);
  let cur = start;
  while (forwardsTo.has(cur)) {
    const next = forwardsTo.get(cur)!;
    if (seen.has(next)) break; // cycle guard
    // only continue the chain if the next link is itself a local fn AND only
    // called once (single caller) — that's what makes it a needless layer.
    if (!fnByName.has(next)) {
      chain.push(next);
      break;
    }
    if ((callCounts.get(next) ?? 0) > 1) break;
    chain.push(next);
    seen.add(next);
    cur = next;
  }
  return chain;
}

// ---- generic helpers -------------------------------------------------------

function isFunctionLike(node: any): boolean {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

function describeFunction(node: any): FnInfo | null {
  let name: string | null = null;
  if (node.type === "FunctionDeclaration") name = node.id?.name ?? null;
  // name from a containing VariableDeclarator is resolved by the parent walk;
  // we approximate by leaving anonymous fns unnamed (chain detection skips them).
  if (node.__inferredName) name = node.__inferredName;
  return { node, name, line: lineOf(node) };
}

function calleeName(callee: any): string | null {
  if (!callee) return null;
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression") {
    return callee.property?.type === "Identifier" ? callee.property.name : null;
  }
  return null;
}

function methodName(m: any): string {
  if (m.key?.type === "Identifier") return m.key.name;
  if (m.key?.type === "StringLiteral") return m.key.value;
  return "<method>";
}

function suffixWord(name: string): string {
  const m = LAYER_NAME_RE.exec(name);
  return m ? m[1].toLowerCase() : "wrapper";
}

function lineOf(node: any): number {
  return node?.loc?.start?.line ?? 1;
}

function dedupeByLine(findings: SlopFinding[]): SlopFinding[] {
  const seen = new Set<string>();
  const out: SlopFinding[] = [];
  for (const f of findings) {
    const key = `${f.category}:${f.line}:${f.evidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out.sort((a, b) => a.line - b.line);
}

/**
 * Depth-first walk over a Babel AST. Visits every object node reachable via
 * array/object children. Also stamps inferred names onto function nodes that sit
 * in a `const foo = () => ...` / `const foo = function(){}` binding so the chain
 * detector can name them. Hand-rolled to avoid an @babel/traverse dependency.
 */
function walk(root: any, visit: (node: any) => void): void {
  const stack: any[] = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;

    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      continue;
    }

    if (typeof node.type === "string") {
      // infer names for fn expressions bound to a variable
      if (node.type === "VariableDeclarator" && node.id?.type === "Identifier") {
        const init = node.init;
        if (
          init &&
          (init.type === "ArrowFunctionExpression" ||
            init.type === "FunctionExpression")
        ) {
          init.__inferredName = node.id.name;
        }
      }
      visit(node);
    }

    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "start" || key === "end" || key === "__inferredName") {
        continue;
      }
      const child = (node as any)[key];
      if (child && typeof child === "object") stack.push(child);
    }
  }
}
