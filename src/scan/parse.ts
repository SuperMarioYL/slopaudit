import { parse } from "@babel/parser";

/**
 * A parsed source file plus the metadata detectors need. `ast` is the Babel
 * `File` node (loosely typed as `any` here because detectors hand-roll their own
 * recursive traversal — we deliberately avoid an @babel/types runtime dep).
 */
export interface FileUnit {
  file: string;
  code: string;
  lineCount: number;
  ast: any | null;
}

export interface ParseResult {
  ast: any | null;
  lineCount: number;
  error?: string;
}

/**
 * Parse a single file with Babel in error-recovery mode. Never throws: on a hard
 * parse failure it returns `{ ast: null, lineCount, error }` so the caller can
 * keep scanning the rest of the repo.
 */
export function parseFile(filePath: string, code: string): ParseResult {
  const lineCount = countLines(code);

  try {
    const ast = parse(code, {
      sourceType: "module",
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowSuperOutsideMethod: true,
      plugins: [
        "typescript",
        "jsx",
        "decorators-legacy",
        "classProperties",
        "topLevelAwait",
      ],
    });
    return { ast, lineCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ast: null, lineCount, error: message };
  }
}

function countLines(code: string): number {
  if (code.length === 0) return 0;
  let lines = 1;
  for (let i = 0; i < code.length; i++) {
    if (code.charCodeAt(i) === 10 /* \n */) lines++;
  }
  return lines;
}
