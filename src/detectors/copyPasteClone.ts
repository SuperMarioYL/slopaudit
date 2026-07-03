import type { SlopFinding } from "../types.js";
import type { FileUnit } from "../scan/parse.js";

/**
 * Detect copy-paste / NEAR-duplicate blocks: two statement blocks whose bodies
 * are structurally *similar but not identical* once identifier names and literal
 * values are ignored. Pure + deterministic over the AST — no I/O.
 *
 * This is deliberately the *fuzzy* complement to the exact duplicate-block check
 * in `genericBoilerplate` (which collapses same-shape, same-ORDER blocks). Bulk
 * AI-generated code more often copy-pastes a block and then lightly edits it —
 * reorders a couple of statements, inserts one, tweaks one — which an exact
 * ordered-signature match slides right past. This detector fingerprints each
 * statement structurally, then flags a block whose statement multiset overlaps a
 * *previous* block by >= NEAR_MIN (Dice), while EXCLUDING exact-ordered-identical
 * pairs so it never merely double-counts what `genericBoilerplate` already flags.
 *
 * Conservative by design:
 *  - only `BlockStatement`s with >= MIN_STATEMENTS statements are considered;
 *  - a match needs >= MIN_SHARED shared statement shapes AND Dice >= NEAR_MIN;
 *  - exact-ordered clones are skipped (genericBoilerplate's domain);
 *  - each block is flagged at most once, pointing back at its earliest match.
 */
export function detectCopyPasteClone(unit: FileUnit): SlopFinding[] {
  if (!unit.ast) return [];

  interface Block {
    line: number;
    stmtSigs: string[]; // per-statement structural fingerprints
    orderedSig: string; // ordered join — identical => exact clone (skip)
  }
  const blocks: Block[] = [];

  walk(unit.ast, (node) => {
    if (node.type !== "BlockStatement") return;
    const body = Array.isArray(node.body) ? node.body : [];
    if (body.length < MIN_STATEMENTS) return;
    const stmtSigs = body.map((s) => structuralSig(s));
    if (stmtSigs.join("").length < MIN_TOTAL_SIG) return;
    blocks.push({
      line: lineOf(node),
      stmtSigs,
      orderedSig: stmtSigs.join("|"),
    });
  });

  // Earliest block first, so a clone always points back at its original.
  blocks.sort((a, b) => a.line - b.line);

  const findings: SlopFinding[] = [];
  for (let j = 1; j < blocks.length; j++) {
    const cur = blocks[j];
    let best: { line: number; sim: number } | null = null;
    for (let i = 0; i < j; i++) {
      const prev = blocks[i];
      // Exact-ordered duplicates are genericBoilerplate's job — don't double-count.
      if (prev.orderedSig === cur.orderedSig) {
        best = null;
        break;
      }
      const { sim, shared } = dice(prev.stmtSigs, cur.stmtSigs);
      if (shared < MIN_SHARED || sim < NEAR_MIN) continue;
      if (!best || sim > best.sim || (sim === best.sim && prev.line < best.line)) {
        best = { line: prev.line, sim };
      }
    }
    if (!best) continue;
    findings.push({
      file: unit.file,
      line: cur.line,
      category: "copy_paste_clone",
      weight: 0.5,
      evidence:
        `near-duplicate ${cur.stmtSigs.length}-statement block — ~${Math.round(best.sim * 100)}% ` +
        `shared structure with the block at line ${best.line} (reordered or lightly edited copy); ` +
        `copy-paste clone`,
    });
  }

  return findings.sort((a, b) => a.line - b.line);
}

// A block must carry at least this many statements to be a clone candidate.
const MIN_STATEMENTS = 3;
// …and at least this many shared statement shapes with the block it clones, so a
// pair of unrelated small blocks that happen to share one shape never matches.
const MIN_SHARED = 3;
// …and a combined fingerprint at least this long, so tiny blocks stay below the
// noise floor even when they share a shape.
const MIN_TOTAL_SIG = 80;
// Dice overlap of the two blocks' statement multisets required to call it a clone.
const NEAR_MIN = 0.75;

/** Dice similarity of two statement-fingerprint multisets (order-independent). */
function dice(a: string[], b: string[]): { sim: number; shared: number } {
  const ca = counts(a);
  const cb = counts(b);
  let shared = 0;
  for (const [k, v] of ca) shared += Math.min(v, cb.get(k) ?? 0);
  const total = a.length + b.length;
  return { sim: total === 0 ? 0 : (2 * shared) / total, shared };
}

function counts(xs: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

/**
 * Structural fingerprint of an AST node/array: node `type`s + child structure,
 * with all scalar values (identifier names, literal values, operators) dropped,
 * so two statements that differ only in names/literals hash identically. `loc`,
 * byte offsets, and comment attachments are skipped.
 */
function structuralSig(node: unknown): string {
  if (Array.isArray(node)) {
    return "[" + node.map(structuralSig).join(",") + "]";
  }
  if (!node || typeof node !== "object") return "";
  const obj = node as Record<string, unknown>;
  if (typeof obj.type !== "string") return "";
  const parts: string[] = [obj.type];
  for (const key of Object.keys(obj).sort()) {
    if (SKIP_KEYS.has(key)) continue;
    const child = obj[key];
    if (child && typeof child === "object") {
      parts.push(key + ":" + structuralSig(child));
    }
    // scalar values (names, literals, operators) are intentionally ignored — the
    // fingerprint is structure-only so renamed clones collide.
  }
  return "(" + parts.join("|") + ")";
}

/** Source line of a node's start location, or 1 when unavailable. */
function lineOf(node: Record<string, unknown>): number {
  const loc = node.loc as { start?: { line?: number } } | undefined;
  return loc?.start?.line ?? 1;
}

const SKIP_KEYS = new Set<string>([
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

/** DFS over the AST, visiting every typed node. Mirrors the other detectors. */
function walk(root: unknown, visit: (node: Record<string, unknown>) => void): void {
  const stack: unknown[] = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      continue;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.type === "string") visit(obj);
    for (const key of Object.keys(obj)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const child = obj[key];
      if (child && typeof child === "object") stack.push(child);
    }
  }
}
