import type { SlopFinding } from "../types.js";
import type { FileUnit } from "../scan/parse.js";

/**
 * Detect "plausible but wrong" slop: code that looks reasonable but is subtly
 * broken — the most dangerous category. Pure + deterministic over the AST.
 *
 * Flags:
 *  - empty catch blocks that swallow errors
 *  - `any`-heavy signatures (params/returns typed `any`)
 *  - unawaited promise-returning calls inside async functions
 *  - unreachable code after return / throw / break / continue
 *  - contradictory or always-true/false guards
 */
export function detectPlausibleButWrong(unit: FileUnit): SlopFinding[] {
  if (!unit.ast) return [];
  const findings: SlopFinding[] = [];

  // track async-function nesting so we only flag unawaited calls inside async fns
  walkWithStack(unit.ast, (node, ancestors) => {
    // empty catch
    if (node.type === "CatchClause") {
      const body = node.body?.body ?? [];
      const onlyComments = body.length === 0;
      if (onlyComments) {
        findings.push({
          file: unit.file,
          line: lineOf(node),
          category: "plausible_but_wrong",
          weight: 0.7,
          evidence: `empty catch block swallows the error silently`,
        });
      }
    }

    // any-heavy signatures
    if (isFunctionLike(node)) {
      const anyCount = countAnyInSignature(node);
      const total = (node.params?.length ?? 0) + 1; // params + return slot
      if (anyCount >= 2 || (anyCount >= 1 && total <= 1)) {
        findings.push({
          file: unit.file,
          line: lineOf(node),
          category: "plausible_but_wrong",
          weight: Math.min(0.8, 0.3 + 0.15 * anyCount),
          evidence: `signature uses \`any\` ${anyCount}x — defeats type checking`,
        });
      }
    }

    // unawaited promise-returning calls inside async fns
    if (node.type === "ExpressionStatement") {
      const inAsync = ancestors.some(
        (a) => isFunctionLike(a) && a.async === true,
      );
      if (inAsync) {
        const call = node.expression;
        if (
          call?.type === "CallExpression" &&
          looksAsyncCall(call) &&
          !isAwaitedOrChained(node.expression)
        ) {
          findings.push({
            file: unit.file,
            line: lineOf(node),
            category: "plausible_but_wrong",
            weight: 0.6,
            evidence: `${describeCall(call)} returns a promise but is not awaited inside an async function`,
          });
        }
      }
    }

    // unreachable code after a terminating statement
    if (node.type === "BlockStatement" || node.type === "Program") {
      collectUnreachable(node, unit, findings);
    }
    if (node.type === "SwitchCase") {
      collectUnreachableInList(node.consequent ?? [], unit, findings);
    }

    // contradictory / always-true|false guards
    if (node.type === "IfStatement") {
      const verdict = constantTest(node.test);
      if (verdict) {
        findings.push({
          file: unit.file,
          line: lineOf(node),
          category: "plausible_but_wrong",
          weight: 0.55,
          evidence: `guard condition is ${verdict} — ${verdict === "always true" ? "branch always runs" : "branch is dead code"}`,
        });
      }
    }
  });

  return dedupeByLine(findings);
}

// ---- empty catch / any -----------------------------------------------------

function countAnyInSignature(node: any): number {
  let count = 0;
  for (const p of node.params ?? []) {
    if (paramIsAny(p)) count++;
  }
  if (typeAnnIsAny(node.returnType)) count++;
  return count;
}

function paramIsAny(p: any): boolean {
  if (!p) return false;
  // Identifier with annotation, or AssignmentPattern wrapping one
  if (p.type === "Identifier") return typeAnnIsAny(p.typeAnnotation);
  if (p.type === "AssignmentPattern") return paramIsAny(p.left);
  if (p.type === "RestElement") return typeAnnIsAny(p.typeAnnotation);
  return false;
}

function typeAnnIsAny(ann: any): boolean {
  if (!ann) return false;
  // TSTypeAnnotation wraps the actual type
  const t = ann.typeAnnotation ?? ann;
  if (!t) return false;
  if (t.type === "TSAnyKeyword") return true;
  // any[] , Array<any>
  if (t.type === "TSArrayType") return typeIsAny(t.elementType);
  return false;
}

function typeIsAny(t: any): boolean {
  return !!t && t.type === "TSAnyKeyword";
}

// ---- unawaited promises ----------------------------------------------------

const ASYNC_HINT_RE = /^(fetch|read|write|load|save|send|query|get|post|put|delete|update|create|find|connect|close|open|exec|run|wait|sleep|delay)/i;
const ASYNC_METHOD_RE = /(Async|^then$)/;

function looksAsyncCall(call: any): boolean {
  const callee = call.callee;
  if (!callee) return false;
  if (callee.type === "Identifier") {
    return ASYNC_HINT_RE.test(callee.name) || ASYNC_METHOD_RE.test(callee.name);
  }
  if (callee.type === "MemberExpression" && callee.property?.type === "Identifier") {
    const prop = callee.property.name;
    return ASYNC_HINT_RE.test(prop) || ASYNC_METHOD_RE.test(prop);
  }
  return false;
}

function isAwaitedOrChained(expr: any): boolean {
  // ExpressionStatement -> the bare call is the expression; if it were awaited
  // the node type would be AwaitExpression, which we never reach here.
  // Treat `.then(...)`/`.catch(...)` chains as handled.
  let cur = expr;
  while (cur && cur.type === "CallExpression") {
    const callee = cur.callee;
    if (
      callee?.type === "MemberExpression" &&
      callee.property?.type === "Identifier" &&
      (callee.property.name === "then" ||
        callee.property.name === "catch" ||
        callee.property.name === "finally")
    ) {
      return true;
    }
    cur = callee?.type === "MemberExpression" ? callee.object : null;
  }
  return false;
}

function describeCall(call: any): string {
  const callee = call.callee;
  if (callee?.type === "Identifier") return `call to "${callee.name}()"`;
  if (
    callee?.type === "MemberExpression" &&
    callee.property?.type === "Identifier"
  ) {
    return `call to ".${callee.property.name}()"`;
  }
  return `call`;
}

// ---- unreachable code ------------------------------------------------------

function collectUnreachable(block: any, unit: FileUnit, out: SlopFinding[]): void {
  collectUnreachableInList(block.body ?? [], unit, out);
}

function collectUnreachableInList(stmts: any[], unit: FileUnit, out: SlopFinding[]): void {
  for (let i = 0; i < stmts.length - 1; i++) {
    if (isTerminator(stmts[i])) {
      const dead = stmts[i + 1];
      // function/var declarations are hoisted — not truly dead
      if (
        dead.type === "FunctionDeclaration" ||
        dead.type === "VariableDeclaration" ||
        dead.type === "ClassDeclaration" ||
        dead.type === "TSInterfaceDeclaration" ||
        dead.type === "TSTypeAliasDeclaration" ||
        dead.type === "EmptyStatement"
      ) {
        continue;
      }
      out.push({
        file: unit.file,
        line: lineOf(dead),
        category: "plausible_but_wrong",
        weight: 0.65,
        evidence: `unreachable code after ${terminatorWord(stmts[i])}`,
      });
      break; // one report per block is enough
    }
  }
}

function isTerminator(s: any): boolean {
  return (
    s.type === "ReturnStatement" ||
    s.type === "ThrowStatement" ||
    s.type === "BreakStatement" ||
    s.type === "ContinueStatement"
  );
}

function terminatorWord(s: any): string {
  switch (s.type) {
    case "ReturnStatement":
      return "return";
    case "ThrowStatement":
      return "throw";
    case "BreakStatement":
      return "break";
    case "ContinueStatement":
      return "continue";
    default:
      return "terminating statement";
  }
}

// ---- constant guards -------------------------------------------------------

/** Returns "always true" | "always false" for trivially constant tests. */
function constantTest(test: any): string | null {
  if (!test) return null;
  if (test.type === "BooleanLiteral") {
    return test.value ? "always true" : "always false";
  }
  if (test.type === "NumericLiteral") {
    return test.value !== 0 ? "always true" : "always false";
  }
  // x === x / x !== x  (same identifier both sides)
  if (test.type === "BinaryExpression" && sameIdentifier(test.left, test.right)) {
    if (test.operator === "===" || test.operator === "==") return "always true";
    if (test.operator === "!==" || test.operator === "!=") return "always false";
  }
  // a && !a  /  a || !a
  if (test.type === "LogicalExpression") {
    if (test.operator === "&&" && isNegationPair(test.left, test.right)) {
      return "always false";
    }
    if (test.operator === "||" && isNegationPair(test.left, test.right)) {
      return "always true";
    }
  }
  return null;
}

function sameIdentifier(a: any, b: any): boolean {
  return (
    a?.type === "Identifier" &&
    b?.type === "Identifier" &&
    a.name === b.name
  );
}

function isNegationPair(a: any, b: any): boolean {
  const neg = (x: any, y: any) =>
    x?.type === "UnaryExpression" &&
    x.operator === "!" &&
    sameIdentifier(x.argument, y);
  return neg(a, b) || neg(b, a);
}

// ---- shared helpers --------------------------------------------------------

function isFunctionLike(node: any): boolean {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "ClassMethod" ||
    node.type === "ObjectMethod"
  );
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
 * DFS that passes the ancestor chain (root → parent) to the visitor. Hand-rolled
 * to avoid an @babel/traverse dependency. Deterministic child order.
 */
function walkWithStack(
  root: any,
  visit: (node: any, ancestors: any[]) => void,
): void {
  const ancestors: any[] = [];

  function rec(node: any): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) rec(child);
      return;
    }
    const isNode = typeof node.type === "string";
    if (isNode) visit(node, ancestors);
    if (isNode) ancestors.push(node);
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const child = (node as any)[key];
      if (child && typeof child === "object") rec(child);
    }
    if (isNode) ancestors.pop();
  }

  rec(root);
}
