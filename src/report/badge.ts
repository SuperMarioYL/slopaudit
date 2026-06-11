import type { SlopScore, SlopBand } from "../types.js";

function bandHex(band: SlopBand): string {
  switch (band) {
    case "clean":
      return "#4c1"; // green
    case "moderate":
      return "#dfb317"; // yellow
    case "heavy":
      return "#e05d44"; // red
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Shields-style flat badge as a self-contained SVG string.
 * Left label "SlopScore", right value "NN/100" colored by band.
 */
export function renderBadge(score: SlopScore): string {
  const label = "SlopScore";
  const value = `${score.score}/100`;
  const valColor = bandHex(score.band);

  // Approximate text widths (px) for the default 11px verdana-ish font at the
  // 110-scaled units shields uses. ~6.5px per char + horizontal padding.
  const charW = 6.5;
  const pad = 10;
  const labelW = Math.round(label.length * charW) + pad * 2;
  const valueW = Math.round(value.length * charW) + pad * 2;
  const totalW = labelW + valueW;

  const labelX = (labelW / 2) * 10;
  const valueX = (labelW + valueW / 2) * 10;
  const labelTW = (labelW - pad) * 10;
  const valueTW = (valueW - pad) * 10;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalW}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
  <title>${esc(label)}: ${esc(value)}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalW}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="20" fill="#555"/>
    <rect x="${labelW}" width="${valueW}" height="20" fill="${valColor}"/>
    <rect width="${totalW}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${labelX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${labelTW}">${esc(label)}</text>
    <text x="${labelX}" y="140" transform="scale(.1)" fill="#fff" textLength="${labelTW}">${esc(label)}</text>
    <text aria-hidden="true" x="${valueX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${valueTW}">${esc(value)}</text>
    <text x="${valueX}" y="140" transform="scale(.1)" fill="#fff" textLength="${valueTW}">${esc(value)}</text>
  </g>
</svg>
`;
}
