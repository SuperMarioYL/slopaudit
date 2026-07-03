import { describe, it, expect } from "vitest";
import { renderGithubAnnotations } from "../src/report/github.js";
import { aggregate } from "../src/score/aggregate.js";
import type { SlopFinding } from "../src/types.js";

function scoreOf(findings: SlopFinding[]) {
  return aggregate(findings, { filesScanned: 3, linesScanned: 90 });
}

describe("renderGithubAnnotations (m7)", () => {
  it("emits one ::warning workflow command per finding with file + line", () => {
    const score = scoreOf([
      { file: "src/a.ts", line: 3, category: "over_abstraction", weight: 0.6, evidence: "deep wrapper" },
      { file: "src/b.ts", line: 8, category: "copy_paste_clone", weight: 0.5, evidence: "duplicate block" },
    ]);
    const out = renderGithubAnnotations(score);
    const lines = out.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(2);
    for (const l of lines) expect(l.startsWith("::warning ")).toBe(true);
    expect(out).toContain("file=src/a.ts,line=3");
    expect(out).toContain("file=src/b.ts,line=8");
    // the category + evidence ride in the message body after `::`
    expect(out).toContain("over_abstraction");
    expect(out).toContain("deep wrapper");
    expect(out).toContain("copy_paste_clone");
  });

  it("escapes commas/colons in property values and the message body", () => {
    const score = scoreOf([
      {
        file: "src/weird,name:x.ts",
        line: 1,
        category: "plausible_but_wrong",
        weight: 0.7,
        evidence: "bad, thing: here",
      },
    ]);
    const out = renderGithubAnnotations(score);
    // the file property must have its , and : percent-encoded so they don't
    // terminate the property list
    expect(out).toContain("file=src/weird%2Cname%3Ax.ts");
    // the message body keeps commas/colons literal (only %, CR, LF are escaped
    // in data), so the human-readable evidence survives
    expect(out).toContain("bad, thing: here");
  });

  it("returns an empty string when there are no findings", () => {
    const score = scoreOf([]);
    expect(renderGithubAnnotations(score)).toBe("");
  });
});
