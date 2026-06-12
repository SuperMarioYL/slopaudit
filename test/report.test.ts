import { describe, it, expect } from "vitest";
import { renderBadge } from "../src/report/badge.js";
import { renderHtml } from "../src/report/html.js";
import { renderTerminal } from "../src/report/terminal.js";
import { aggregate } from "../src/score/aggregate.js";
import type { SlopFinding, SlopScore } from "../src/types.js";

function makeScore(): SlopScore {
  const findings: SlopFinding[] = [
    { file: "src/a.ts", line: 3, category: "over_abstraction", weight: 0.6, evidence: "deep wrapper" },
    { file: "src/b.ts", line: 8, category: "plausible_but_wrong", weight: 0.7, evidence: "empty catch" },
  ];
  return aggregate(findings, { filesScanned: 5, linesScanned: 120 });
}

// strip ANSI color codes for plain-text assertions
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("renderBadge", () => {
  it("returns valid SVG containing the score", () => {
    const score = makeScore();
    const svg = renderBadge(score);
    expect(svg.trimStart().startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
    expect(svg).toContain(`${score.score}/100`);
    expect(svg).toContain("SlopScore");
  });

  it("colors the badge by band", () => {
    const clean = renderBadge(aggregate([], { filesScanned: 1, linesScanned: 100 }));
    expect(clean).toContain("#4c1"); // green for clean
  });
});

describe("renderHtml", () => {
  it("returns a self-contained doc starting with <!DOCTYPE html> containing the score", () => {
    const score = makeScore();
    const html = renderHtml(score);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).toContain(String(score.score));
    expect(html).toContain(score.band);
    // self-contained: no external stylesheet/script references
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
  });
});

describe("renderTerminal", () => {
  it("includes the SlopScore headline", () => {
    const score = makeScore();
    const out = stripAnsi(renderTerminal(score));
    expect(out).toContain(`SlopScore: ${score.score}/100 (${score.band})`);
  });

  it("lists top offender files when findings exist", () => {
    const out = stripAnsi(renderTerminal(makeScore()));
    expect(out).toContain("Top offender files");
  });

  it("reports a clean headline when there are no findings", () => {
    const out = stripAnsi(renderTerminal(aggregate([], { filesScanned: 3, linesScanned: 90 })));
    expect(out).toContain("SlopScore: 0/100 (clean)");
  });
});
