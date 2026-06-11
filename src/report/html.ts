import type { SlopScore, SlopBand, SlopCategory } from "../types.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function bandHex(band: SlopBand): string {
  switch (band) {
    case "clean":
      return "#2ea043";
    case "moderate":
      return "#d4a017";
    case "heavy":
      return "#d1242f";
  }
}

/**
 * Map a 0..1 density to a green->yellow->red heatmap background color.
 */
function heatColor(d: number): string {
  const x = Math.max(0, Math.min(1, d));
  // green (46,160,67) -> yellow (212,160,23) -> red (209,36,47)
  let r: number, g: number, b: number;
  if (x < 0.5) {
    const t = x / 0.5;
    r = Math.round(46 + (212 - 46) * t);
    g = Math.round(160 + (160 - 160) * t);
    b = Math.round(67 + (23 - 67) * t);
  } else {
    const t = (x - 0.5) / 0.5;
    r = Math.round(212 + (209 - 212) * t);
    g = Math.round(160 + (36 - 160) * t);
    b = Math.round(23 + (47 - 23) * t);
  }
  return `rgb(${r}, ${g}, ${b})`;
}

const CATEGORY_LABELS: Record<SlopCategory, string> = {
  over_abstraction: "Over-abstraction",
  generic_boilerplate: "Generic boilerplate",
  plausible_but_wrong: "Plausible-but-wrong",
};

/**
 * Self-contained HTML report. Inline CSS, no external assets, no frameworks.
 * A tiny inline <script> adds client-side column sorting to the file table.
 */
export function renderHtml(score: SlopScore): string {
  const band = score.band;
  const accent = bandHex(band);

  // Category breakdown: count + summed weight per category.
  const catAgg: Record<string, { count: number; weight: number }> = {};
  for (const f of score.findings) {
    const k = f.category;
    if (!catAgg[k]) catAgg[k] = { count: 0, weight: 0 };
    catAgg[k].count += 1;
    catAgg[k].weight += f.weight;
  }

  // Per-file: density + finding count.
  const fileCounts: Record<string, number> = {};
  for (const f of score.findings) {
    fileCounts[f.file] = (fileCounts[f.file] ?? 0) + 1;
  }

  const fileRows = Object.keys(score.byFile)
    .map((file) => ({
      file,
      density: score.byFile[file],
      count: fileCounts[file] ?? 0,
    }))
    .sort((a, b) => {
      if (b.density !== a.density) return b.density - a.density;
      return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
    });

  const catRows = (Object.keys(CATEGORY_LABELS) as SlopCategory[])
    .map((cat) => {
      const a = catAgg[cat] ?? { count: 0, weight: 0 };
      return { cat, label: CATEGORY_LABELS[cat], count: a.count, weight: a.weight };
    })
    .filter((r) => r.count > 0 || true);

  const tableBody = fileRows
    .map((r) => {
      const pct = Math.round(r.density * 100);
      const bg = heatColor(r.density);
      return `        <tr>
          <td class="file">${esc(r.file)}</td>
          <td class="num" data-sort="${r.density}">
            <div class="cell-bar"><span class="bar-fill" style="width:${pct}%;background:${bg}"></span><span class="bar-label">${pct}%</span></div>
          </td>
          <td class="num" data-sort="${r.count}">${r.count}</td>
        </tr>`;
    })
    .join("\n");

  const catCards = catRows
    .map((r) => {
      return `      <div class="cat-card">
        <div class="cat-label">${esc(r.label)}</div>
        <div class="cat-count">${r.count}</div>
        <div class="cat-weight">weight ${r.weight.toFixed(2)}</div>
      </div>`;
    })
    .join("\n");

  const emptyNote =
    fileRows.length === 0
      ? `      <p class="empty">No slop findings — the audited tree looks clean.</p>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SlopAudit Report — ${score.score}/100 (${band})</title>
<style>
  :root {
    --bg: #0d1117;
    --panel: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --muted: #8b949e;
    --accent: ${accent};
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
  }
  .wrap { max-width: 1000px; margin: 0 auto; padding: 32px 20px 64px; }
  header { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; margin-bottom: 8px; }
  .gauge {
    width: 132px; height: 132px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    flex-direction: column;
    background:
      radial-gradient(closest-side, var(--panel) 79%, transparent 80% 100%),
      conic-gradient(var(--accent) calc(${score.score} * 1%), var(--border) 0);
    flex: 0 0 auto;
  }
  .gauge .val { font-size: 32px; font-weight: 700; }
  .gauge .max { font-size: 13px; color: var(--muted); }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .band-pill {
    display: inline-block; padding: 2px 12px; border-radius: 999px;
    font-size: 13px; font-weight: 600; color: #fff; background: var(--accent);
    text-transform: capitalize;
  }
  .meta { color: var(--muted); font-size: 14px; margin-top: 8px; }
  h2 { font-size: 16px; margin: 36px 0 12px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  .cats { display: flex; gap: 14px; flex-wrap: wrap; }
  .cat-card {
    background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    padding: 14px 18px; min-width: 150px; flex: 1 1 150px;
  }
  .cat-label { font-size: 13px; color: var(--muted); }
  .cat-count { font-size: 28px; font-weight: 700; }
  .cat-weight { font-size: 12px; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  th {
    cursor: pointer; user-select: none; color: var(--muted); font-weight: 600;
    position: sticky; top: 0; background: var(--bg);
  }
  th:hover { color: var(--text); }
  th .arrow { font-size: 10px; opacity: 0.6; }
  td.num { text-align: right; white-space: nowrap; }
  td.file { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; word-break: break-all; }
  .cell-bar { position: relative; display: flex; align-items: center; justify-content: flex-end; gap: 8px; min-width: 120px; }
  .bar-fill { height: 10px; border-radius: 5px; display: inline-block; min-width: 2px; }
  .bar-label { width: 36px; text-align: right; color: var(--muted); }
  .empty { color: var(--muted); font-style: italic; }
  footer { margin-top: 48px; color: var(--muted); font-size: 12px; }
  footer code { background: var(--panel); padding: 1px 6px; border-radius: 4px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="gauge"><span class="val">${score.score}</span><span class="max">/ 100</span></div>
    <div>
      <h1>SlopAudit Report</h1>
      <span class="band-pill">${band}</span>
      <div class="meta">${score.filesScanned} files scanned &middot; ${score.linesScanned} lines &middot; ${score.findings.length} findings</div>
    </div>
  </header>

  <h2>Category breakdown</h2>
  <div class="cats">
${catCards}
  </div>

  <h2>File heatmap</h2>
${emptyNote}
  <table id="fileTable">
    <thead>
      <tr>
        <th data-col="0" data-type="str">File <span class="arrow"></span></th>
        <th data-col="1" data-type="num" class="num">Density <span class="arrow">▼</span></th>
        <th data-col="2" data-type="num" class="num">Findings <span class="arrow"></span></th>
      </tr>
    </thead>
    <tbody>
${tableBody}
    </tbody>
  </table>

  <footer>
    Generated by <code>slopaudit</code> — 100% static, offline, deterministic. No code left the machine.
  </footer>
</div>
<script>
(function () {
  var table = document.getElementById("fileTable");
  if (!table) return;
  var tbody = table.querySelector("tbody");
  var headers = table.querySelectorAll("th");
  var state = { col: 1, dir: -1 };
  function cellValue(row, col, type) {
    var cell = row.children[col];
    if (!cell) return type === "num" ? 0 : "";
    var ds = cell.getAttribute("data-sort");
    if (type === "num") return parseFloat(ds != null ? ds : cell.textContent) || 0;
    return (cell.textContent || "").trim().toLowerCase();
  }
  function sortBy(col, type) {
    if (state.col === col) { state.dir = -state.dir; } else { state.col = col; state.dir = type === "num" ? -1 : 1; }
    var rows = Array.prototype.slice.call(tbody.querySelectorAll("tr"));
    rows.sort(function (a, b) {
      var va = cellValue(a, col, type), vb = cellValue(b, col, type);
      if (va < vb) return -1 * state.dir;
      if (va > vb) return 1 * state.dir;
      return 0;
    });
    rows.forEach(function (r) { tbody.appendChild(r); });
    headers.forEach(function (h) {
      var arrow = h.querySelector(".arrow");
      if (!arrow) return;
      arrow.textContent = parseInt(h.getAttribute("data-col"), 10) === col ? (state.dir < 0 ? "▼" : "▲") : "";
    });
  }
  headers.forEach(function (h) {
    h.addEventListener("click", function () {
      sortBy(parseInt(h.getAttribute("data-col"), 10), h.getAttribute("data-type"));
    });
  });
})();
</script>
</body>
</html>
`;
}
