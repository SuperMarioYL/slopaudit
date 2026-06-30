import type { SlopFinding } from "../types.js";
import type { FileUnit } from "../scan/parse.js";

/**
 * Detect dead-parameter slop: named function parameters that are never referenced
 * in the function body. Pure + deterministic over the AST — no I/O.
 *
 * AI-generated code routinely carries a plausible-looking parameter that is wired
 * into the signature but never read — a `context`, `options`, or `_unusedId` the
 * generator added "just in case". TypeScript's `noUnusedParameters` catches these
 * only when explicitly enabled and only for leading params, and most inherited
 * agent code never turned it on; this detector flags them on the slop axis.
 *
 * Flags a *named* parameter (a plain `Identifier`, or the `Identifier` inside a
 * default `AssignmentPattern`) when its name never appears as a referencing
 * identifier anywhere in that function's body. Conservatively skips:
 *  - parameters prefixed with `_` (the conventional "intentionally unused" marker)
 *  - destructured params (`{a}`, `[a]`) and rest params (`...rest`) — too noisy
 *  - the TS `this` pseudo-parameter
 *  - functions whose body references `arguments` (params reached positionally)
 *  - abstract / declaration-only signatures with no body (overloads, interfaces)
 */
export function detectDeadParameter(unit: FileUnit): SlopFinding[] {
  if (!unit.ast) return [];
  const findings: SlopFinding[] = [];

  walk(unit.ast, (node) => {
    if (!isFunctionLike(node)) return;
    const body = node.body;
    // No real body (TS overload signature, abstract/ambient decl, interface
    // method) — nothing to reference the param, so don't flag.
    if (!body || typeof body !== "object") return;
    if (body.type !== "BlockStatement" && !isExpression(body)) return;

    const named = namedParams(node.params ?? []);
    if (named.length === 0) return;

    // If the body uses `arguments`, params can be read positionally — bail out to
    // avoid false positives.
    if (referencesIdentifier(body, "arguments")) return;

    for (const p of named) {
      if (referencesIdentifier(body, p.name)) continue;
      findings.push({
        file: unit.file,
        line: p.line,
        category: "dead_parameter",
        weight: 0.4,
        evidence: `parameter "${p.name}" is never used in the function body — dead parameter`,
      });
    }
  });

  return dedupeByLine(findings);
}

interface NamedParam {
  name: string;
  line: number;
}

/**
 * Extract the referenceable named parameters of a function: bare identifiers and
 * the identifier of a default `AssignmentPattern`. Skips `_`-prefixed names,
 * destructuring patterns, rest elements, and the `this` pseudo-param.
 */
function namedParams(params: any[]): NamedParam[] {
  const out: NamedParam[] = [];
  for (const p of params) {
    const id = paramIdentifier(p);
    if (!id) continue;
    if (id.name === "this") continue; // TS `this` pseudo-parameter
    if (id.name.startsWith("_")) continue; // conventional "unused" marker
    out.push({ name: id.name, line: lineOf(id) ?? lineOf(p) ?? 1 });
  }
  return out;
}

/** The bound Identifier of a param, or null for destructured / rest params. */
function paramIdentifier(p: any): any | null {
  if (!p) return null;
  if (p.type === "Identifier") return p;
  // `x = default` — the binding is on the left.
  if (p.type === "AssignmentPattern") return paramIdentifier(p.left);
  // `{a}`, `[a]`, `...rest`, `this: T` annotated as TSParameterProperty etc. are
  // deliberately not flagged (destructuring/rest usage is too easy to misread).
  return null;
}

/**
 * True if `name` appears as a referencing identifier anywhere inside `root`.
 *
 * We count any `Identifier`/`JSXIdentifier` node whose `name` matches and that is
 * not purely a non-referencing position (object-literal keys, member-access
 * property names, declared binding names). This is intentionally permissive: a
 * false "used" reading just suppresses a finding, which is the safe direction for
 * a slop heuristic.
 */
function referencesIdentifier(root: any, name: string): boolean {
  let found = false;
  walkRefs(root, (node, parentKey, parent) => {
    if (found) return;
    if (node.type !== "Identifier" && node.type !== "JSXIdentifier") return;
    if (node.name !== name) return;
    if (isNonReferencingPosition(node, parentKey, parent)) return;
    found = true;
  });
  return found;
}

/**
 * Identifier positions that are NOT a value reference to the parameter:
 *  - a non-computed member/optional-member property:  obj.<name>
 *  - a non-shorthand object/class property key:        { <name>: v }
 *  - a TS qualified-name / type-member right side
 * Shorthand object properties (`{ x }`) DO reference the binding, so they count.
 */
function isNonReferencingPosition(node: any, parentKey: string | null, parent: any): boolean {
  if (!parent) return false;

  // obj.name / obj?.name  (property of a non-computed member expression)
  if (
    (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") &&
    parentKey === "property" &&
    !parent.computed
  ) {
    return true;
  }

  // object/class property or method *key*, unless it's shorthand (then the key
  // identifier IS the value reference).
  if (
    (parent.type === "ObjectProperty" ||
      parent.type === "Property" ||
      parent.type === "ClassProperty" ||
      parent.type === "ObjectMethod" ||
      parent.type === "ClassMethod") &&
    parentKey === "key" &&
    parent.computed !== true &&
    parent.shorthand !== true
  ) {
    return true;
  }

  // TS qualified name right side (A.B) and type member labels.
  if (parent.type === "TSQualifiedName" && parentKey === "right") return true;

  return false;
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

function isExpression(node: any): boolean {
  // arrow concise body — any node that isn't a statement block
  return typeof node?.type === "string" && node.type !== "BlockStatement";
}

function lineOf(node: any): number | null {
  return node?.loc?.start?.line ?? null;
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

/** DFS over the AST, visiting every typed node. Mirrors the other detectors. */
function walk(root: any, visit: (node: any) => void): void {
  const stack: any[] = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      continue;
    }
    if (typeof node.type === "string") visit(node);
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const child = (node as any)[key];
      if (child && typeof child === "object") stack.push(child);
    }
  }
}

/**
 * DFS that hands the visitor each node plus the key/parent it hangs off, so the
 * reference check can tell a value use from a property-name/key position.
 */
function walkRefs(
  root: any,
  visit: (node: any, parentKey: string | null, parent: any) => void,
): void {
  function rec(node: any, parentKey: string | null, parent: any): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) rec(child, parentKey, parent);
      return;
    }
    if (typeof node.type === "string") visit(node, parentKey, parent);
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const child = (node as any)[key];
      if (child && typeof child === "object") rec(child, key, node);
    }
  }
  rec(root, null, null);
}
