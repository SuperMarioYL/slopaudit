import type { SlopFinding } from "../types.js";
import type { FileUnit } from "../scan/parse.js";

/**
 * Detect generic-boilerplate slop: filler that pads a file without carrying
 * intent. Pure + deterministic over the AST (plus a comment scan of the source).
 *
 * Flags:
 *  - dense trivial getters/setters (`get x(){return this._x}` en masse)
 *  - near-identical try/catch scaffolding repeated across the file
 *  - high TODO/FIXME/placeholder comment density
 *  - copy-paste-shaped duplicate statement blocks
 */
export function detectGenericBoilerplate(unit: FileUnit): SlopFinding[] {
  if (!unit.ast) return [];
  const findings: SlopFinding[] = [];

  const trivialAccessors: { line: number }[] = [];
  const tryShapes = new Map<string, number[]>(); // normalized catch shape -> lines
  const blockShapes = new Map<string, number[]>(); // normalized block -> lines

  walk(unit.ast, (node) => {
    // trivial getters/setters
    if (
      (node.type === "ClassMethod" || node.type === "ObjectMethod") &&
      (node.kind === "get" || node.kind === "set") &&
      isTrivialAccessor(node)
    ) {
      trivialAccessors.push({ line: lineOf(node) });
    }

    // try/catch scaffolding
    if (node.type === "TryStatement" && node.handler) {
      const shape = normalizeCatch(node.handler);
      push(tryShapes, shape, lineOf(node.handler));
    }

    // copy-paste-shaped duplicate statement blocks (>=3 statements)
    if (node.type === "BlockStatement" && (node.body?.length ?? 0) >= 3) {
      const shape = normalizeBlock(node.body);
      if (shape) push(blockShapes, shape, lineOf(node));
    }
  });

  // dense trivial accessors: only flag when there's a real cluster
  if (trivialAccessors.length >= 4) {
    const first = trivialAccessors.reduce(
      (a, b) => (b.line < a.line ? b : a),
      trivialAccessors[0],
    );
    findings.push({
      file: unit.file,
      line: first.line,
      category: "generic_boilerplate",
      weight: Math.min(1, 0.3 + 0.07 * trivialAccessors.length),
      evidence: `${trivialAccessors.length} trivial getters/setters that just read/write a backing field`,
    });
  }

  // repeated near-identical try/catch scaffolding
  for (const [, lines] of tryShapes) {
    if (lines.length >= 3) {
      const sorted = [...lines].sort((a, b) => a - b);
      findings.push({
        file: unit.file,
        line: sorted[0],
        category: "generic_boilerplate",
        weight: Math.min(1, 0.3 + 0.1 * sorted.length),
        evidence: `${sorted.length} near-identical try/catch blocks (same handler shape) — copy-pasted error scaffolding`,
      });
    }
  }

  // copy-paste duplicate blocks
  for (const [, lines] of blockShapes) {
    if (lines.length >= 2) {
      const sorted = [...lines].sort((a, b) => a - b);
      findings.push({
        file: unit.file,
        line: sorted[0],
        category: "generic_boilerplate",
        weight: Math.min(1, 0.35 + 0.12 * (sorted.length - 1)),
        evidence: `${sorted.length} duplicate statement blocks with the same shape (lines ${sorted.join(", ")}) — copy-paste`,
      });
    }
  }

  // comment density (TODO/FIXME/placeholder) from source text
  findings.push(...scanComments(unit));

  return dedupeByLine(findings);
}

function isTrivialAccessor(node: any): boolean {
  const stmts = node.body?.body ?? [];
  if (stmts.length === 0) return true; // empty accessor — definitely filler
  if (stmts.length !== 1) return false;
  const s = stmts[0];
  if (node.kind === "get") {
    return (
      s.type === "ReturnStatement" &&
      isMemberOrIdent(s.argument)
    );
  }
  // setter: this._x = x;  (single assignment)
  if (node.kind === "set") {
    return (
      s.type === "ExpressionStatement" &&
      s.expression?.type === "AssignmentExpression" &&
      s.expression.operator === "=" &&
      isMemberOrIdent(s.expression.left) &&
      isMemberOrIdent(s.expression.right)
    );
  }
  return false;
}

function isMemberOrIdent(n: any): boolean {
  return !!n && (n.type === "MemberExpression" || n.type === "Identifier");
}

/** Normalize a catch handler to a structural signature (ignores identifiers). */
function normalizeCatch(handler: any): string {
  const param = handler.param ? "p" : "";
  const body = handler.body?.body ?? [];
  return `catch(${param}){${body.map(structuralType).join(";")}}`;
}

function normalizeBlock(stmts: any[]): string | null {
  if (!stmts || stmts.length < 3) return null;
  return stmts.map(structuralType).join(";");
}

/**
 * Structural fingerprint of a statement: the node type plus the structural
 * shape of its children, but NOT identifier names or literal values — so
 * copy-pasted-then-renamed blocks collapse to the same signature.
 *
 * fix-double-count-copy-paste-vs-boilerplate: If, For-star, Throw and Try
 * used to collapse to a bare constant ("If" / "For" / "Throw" / "Try"), so
 * two blocks that differed only in an if-branch's (or for/throw/try arm's)
 * internal structure collided as a generic_boilerplate "exact duplicate block" while
 * copyPasteClone's own deeper `structuralSig` still saw the difference and
 * flagged the pair as a near-duplicate — the same block pair was
 * double-counted (a false-red at `--fail-on`). Recursing those arms
 * (structure-only, names+literals dropped) was the first step; see
 * fix-structuraltype-shallow-arms-double-count below for the root-cause fix
 * that made the fingerprint uniformly structure-only.
 *
 * fix-structuraltype-while-dowhile-switch-bare-constant: the v0.14.0 fix recursed
 * If, For-star, Throw and Try but left WhileStatement, DoWhileStatement and SwitchStatement
 * falling through to the bare `default: return node.type` constant, so two blocks
 * differing only in a while / do-while / switch body still collided as an exact
 * duplicate here while copyPasteClone's deeper `structuralSig` saw the body
 * difference and flagged a near-duplicate — the same double-count, in arms the
 * v0.14.0 fix missed.
 *
 * fix-structuraltype-shallow-arms-double-count: even with every statement arm
 * recursing, the fingerprint was still lossy in the arms no fix ever touched —
 * exprShape collapsed CallExpression to `Call/<argc>` (callee + every argument to
 * their bare node type) and MemberExpression to bare "Member", VariableDeclaration
 * to a bare `V<count>`, and every node type without an explicit arm to
 * `default: return node.type`. Two blocks differing only in the depth of a call
 * argument chain (`save(a.b.c.d)` vs `save(e)`) or in a declaration initializer's
 * shape (`const cfg = {...}` vs `const cfg = loadConfig()`) collided here as an
 * "exact duplicate" while copyPasteClone's deep `structuralSig` still saw the
 * difference and flagged the same pair as a near-duplicate — the block pair
 * double-counted (gb=1 + cp=1), inflating the SlopScore (a false-red at
 * `--fail-on`). The root cause is TWO disagreeing equivalence relations: a
 * hand-tuned shallow shape here vs a uniform deep fingerprint there, so the
 * fingerprint is now the SAME uniform structure-only recursion `structuralSig`
 * implements — node type + every object child's fingerprint, every scalar
 * (names, literals, operators) dropped, loc/offset/comment keys skipped. gb and
 * cp now agree by construction: any pair gb calls an exact duplicate is
 * orderedSig-equal to copyPasteClone, whose exact-clone skip fires, so
 * near-duplicates stay copyPasteClone's exclusive domain and can never be
 * double-counted again — no arm-by-arm whack-a-mole. Renamed clones still
 * collide (scalars dropped), preserving legitimate copy-paste detection.
 */
function structuralType(node: any): string {
  if (Array.isArray(node)) return `[${node.map(structuralType).join(",")}]`;
  if (!node || typeof node !== "object" || typeof node.type !== "string") return "?";
  const parts: string[] = [node.type];
  for (const key of Object.keys(node).sort()) {
    if (SHAPE_SKIP_KEYS.has(key)) continue;
    const child = (node as any)[key];
    if (child && typeof child === "object") parts.push(structuralType(child));
  }
  return `(${parts.join("|")})`;
}

/**
 * Keys excluded from the structural fingerprint: source positions and comment
 * attachments carry no structure (mirrors copyPasteClone's SKIP_KEYS).
 */
const SHAPE_SKIP_KEYS = new Set([
  "loc",
  "start",
  "end",
  "range",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
  "extra",
]);

const PLACEHOLDER_RE = /\b(TODO|FIXME|XXX|HACK|placeholder|implement me|fill( this)? in|stub|coming soon|not implemented)\b/i;

function scanComments(unit: FileUnit): SlopFinding[] {
  const comments: any[] = unit.ast?.comments ?? [];
  if (comments.length === 0) return [];
  const hits = comments.filter((c) => PLACEHOLDER_RE.test(c.value ?? ""));
  if (hits.length === 0) return [];

  const lines = Math.max(1, unit.lineCount);
  const density = hits.length / lines; // placeholders per line
  // flag when there are several, or when density is high in a small file
  if (hits.length < 3 && density < 0.02) return [];

  const first = hits.reduce(
    (a, b) => ((b.loc?.start?.line ?? 1) < (a.loc?.start?.line ?? 1) ? b : a),
    hits[0],
  );
  return [
    {
      file: unit.file,
      line: first.loc?.start?.line ?? 1,
      category: "generic_boilerplate",
      weight: Math.min(1, 0.25 + 0.1 * hits.length),
      evidence: `${hits.length} TODO/FIXME/placeholder comments (${(density * 100).toFixed(1)}% of lines) — unfinished filler`,
    },
  ];
}

// ---- helpers ---------------------------------------------------------------

function push(map: Map<string, number[]>, key: string, line: number): void {
  const arr = map.get(key);
  if (arr) arr.push(line);
  else map.set(key, [line]);
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
