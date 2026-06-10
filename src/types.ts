export type SlopCategory = "over_abstraction" | "generic_boilerplate" | "plausible_but_wrong";

export interface SlopFinding {
  file: string;
  line: number;
  category: SlopCategory;
  weight: number;      // 0..1 severity
  evidence: string;    // human-readable why, e.g. "4-deep wrapper, single caller"
}

export type SlopBand = "clean" | "moderate" | "heavy";

export interface SlopScore {
  score: number;                  // 0..100, higher = more slop debt
  band: SlopBand;                 // clean <34, moderate 34..66, heavy >66
  findings: SlopFinding[];
  byFile: Record<string, number>; // per-file slop density 0..1 → heatmap
  filesScanned: number;
  linesScanned: number;
}
