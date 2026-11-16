// Exporting results: CSV tables (for spreadsheets) and the chart as an image.
// CSV: commas, decimal points and full precision (the standard form spreadsheets import), with a
// byte-order mark so Excel reads non-Latin labels correctly.

const cell = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows) => "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

export function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const downloadCsv = (name, rows) => download(name, new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));

// A file name from a title: Latin letters, digits and dashes. Cyrillic is spelled in Latin
// letters, because some browsers ignore a download name with other scripts and save "download".
const CYR = { а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ye", ё: "yo", ж: "zh", з: "z", и: "y", і: "i", ї: "yi", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
export const fileName = (...parts) => parts.filter(Boolean).join("-")
  .replace(/\p{L}/gu, (ch) => { const low = ch.toLowerCase(), t = CYR[low]; return t === undefined ? ch : ch === low ? t : t.charAt(0).toUpperCase() + t.slice(1); })
  .normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "results";

// For each pull: chance the goal is reached by then, chance of finishing on that pull, and (with a
// budget report) each target's expected progress.
export function chanceByPullRows(result, L) {
  const { cdf, pmf, budget } = result;
  const reqs = budget?.requirements ?? [];
  const last = Math.max(cdf.length - 1, budget ? budget.pulls : 0);
  const rows = [[L.csvPull, L.csvChance, L.csvFinish, ...reqs.map((q) => L.csvExpected(q.label))]];
  for (let t = 0; t <= last; t++) {
    const done = t < cdf.length ? cdf[t] : cdf[cdf.length - 1];
    rows.push([t, done, t < pmf.length ? pmf[t] : 0, ...reqs.map((q) => (t < q.expectedByPull.length ? q.expectedByPull[t] : ""))]);
  }
  return rows;
}

// After the budget: each target's progress distribution, and the whole goal
export function budgetRows(budget, L) {
  const rows = [[L.csvTarget, L.csvProgress, L.csvProbability]];
  for (const q of budget.requirements) {
    q.dist.forEach((p, v) => rows.push([q.label, v === q.dist.length - 1 && v > 0 ? L.csvOrMore(v) : v, p]));
    rows.push([q.label, L.csvTargetMet(q.target), q.chanceMet]);
  }
  rows.push([L.csvWholeGoal(budget.pulls), "", budget.chanceGoal]);
  return rows;
}

// The chart as a PNG, on an opaque background (the chart area itself is see-through), with a
// heading above it saying what it shows
export function downloadChartPng(chart, name, { background, ink, muted, title, subtitle }) {
  const src = chart.canvas, scale = src.width / src.clientWidth || 1;
  const pad = Math.round(14 * scale), head = Math.round((subtitle ? 50 : 30) * scale);
  const out = document.createElement("canvas");
  out.width = src.width + 2 * pad; out.height = src.height + head + 2 * pad;
  const ctx = out.getContext("2d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.textBaseline = "top";
  ctx.fillStyle = ink;
  ctx.font = `600 ${Math.round(15 * scale)}px Roboto, system-ui, sans-serif`;
  ctx.fillText(title, pad, pad, src.width);
  if (subtitle) {
    ctx.fillStyle = muted;
    ctx.font = `400 ${Math.round(12.5 * scale)}px Roboto, system-ui, sans-serif`;
    ctx.fillText(subtitle, pad, pad + Math.round(21 * scale), src.width);
  }
  ctx.drawImage(src, pad, pad + head);
  out.toBlob((blob) => blob && download(name, blob), "image/png");
}

// The preview card for a short link: 1200×630, the setup and its result on top, the chart on
// the page below them, in the current theme. A JPEG data URL (small enough to store).
export function shareCard({ title, detail }, chartCanvas) {
  const W = 1200, H = 630, pad = 56;
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const ctx = out.getContext("2d");
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => cs.getPropertyValue(n).trim() || d;
  ctx.fillStyle = v("--pop-bg", "#15172a");
  ctx.fillRect(0, 0, W, H);
  const font = (w, px) => `${w} ${px}px Roboto, system-ui, sans-serif`;
  // title: up to two lines, cut with "…"
  ctx.textBaseline = "top";
  ctx.fillStyle = v("--ink", "#eceef6");
  ctx.font = font(700, 44);
  const words = title.split(" "), lines = [""];
  for (const w of words) {
    const tryLine = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${w}` : w;
    if (ctx.measureText(tryLine).width <= W - 2 * pad || !lines[lines.length - 1]) lines[lines.length - 1] = tryLine;
    else if (lines.length < 2) lines.push(w);
    else { lines[1] = `${lines[1]}…`; break; }
  }
  lines.forEach((l, i) => ctx.fillText(l, pad, pad + i * 54, W - 2 * pad));
  let y = pad + lines.length * 54 + 10;
  if (detail) {
    ctx.fillStyle = v("--accent", "#a99cff");
    ctx.font = font(600, 30);
    ctx.fillText(detail, pad, y, W - 2 * pad);
    y += 48;
  }
  // the chart below, kept in proportion
  const footer = 40;
  if (chartCanvas && chartCanvas.width && chartCanvas.height) {
    const boxW = W - 2 * pad, boxH = H - y - pad / 2 - footer;
    const k = Math.min(boxW / chartCanvas.width, boxH / chartCanvas.height);
    const w = chartCanvas.width * k, h = chartCanvas.height * k;
    ctx.drawImage(chartCanvas, pad + (boxW - w) / 2, y + 8, w, h);
  }
  ctx.fillStyle = v("--ink-2", "#9aa0b8");
  ctx.font = font(500, 22);
  ctx.fillText("Morimens Gacha Calculator", pad, H - pad / 2 - 22);
  return out.toDataURL("image/jpeg", 0.85);
}
