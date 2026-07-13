import { relative, sep } from "node:path";
import type { SlopScore, SlopFinding } from "../types.js";

/**
 * m7 — render each SlopFinding as a GitHub Actions workflow command so the
 * packaged Action surfaces per-line slop annotations inline on the PR diff, with
 * no extra setup on the consumer's side. A pure formatter over the SlopScore the
 * CLI already produces (every SlopFinding carries file + line + evidence) — no
 * new CLI primitive and no new SlopScore band.
 *
 * The emitted lines follow the documented `::warning file=…,line=…::message`
 * workflow-command syntax; GitHub reads them from the step's stdout and renders
 * an annotation on the referenced line of the diff. Property values and the
 * message are escaped per the workflow-command spec so a comma/colon/newline in
 * the evidence can't break the command.
 *
 * `cwd` is the directory GitHub treats as the workspace root (the step's working
 * directory, `$GITHUB_WORKSPACE`); finding paths are emitted RELATIVE to it —
 * see `toWorkspacePath`.
 *
 * See: https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions
 */
export function renderGithubAnnotations(
  score: SlopScore,
  cwd: string = process.cwd(),
): string {
  return score.findings.map((f) => annotationLine(f, cwd)).join("\n");
}

function annotationLine(f: SlopFinding, cwd: string): string {
  const file = escapeProperty(toWorkspacePath(f.file, cwd));
  const line = String(f.line);
  const title = "SlopAudit: " + f.category;
  const message = escapeData(`${f.category} — ${f.evidence}`);
  return `::warning file=${file},line=${line},title=${escapeProperty(title)}::${message}`;
}

/**
 * GitHub only attaches an annotation to a line of the PR diff when the `file`
 * property is a path RELATIVE to the repository root (the workspace = the step's
 * working directory). The scanner records absolute paths, so emitting them
 * verbatim left every annotation unmatched and silently absent from the diff —
 * the whole point of the m7 inline-annotation feature. Relativize each finding
 * against `cwd` and normalize to POSIX separators (GitHub expects `/`). If the
 * file resolves outside `cwd` (a `..` climb), keep the original path rather than
 * emit a broken relative path.
 */
function toWorkspacePath(file: string, cwd: string): string {
  const rel = relative(cwd, file);
  const chosen = rel.length > 0 && !rel.startsWith("..") ? rel : file;
  return chosen.split(sep).join("/");
}

/**
 * Escape a workflow-command *message* body: only `%`, CR and LF are special.
 */
function escapeData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * Escape a workflow-command *property value*: the message escapes plus `:` and
 * `,`, which delimit the property list.
 */
function escapeProperty(s: string): string {
  return s
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A")
    .replace(/:/g, "%3A")
    .replace(/,/g, "%2C");
}
