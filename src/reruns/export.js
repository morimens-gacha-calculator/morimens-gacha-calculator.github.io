// The compact plan, to keep or send: as text (one line per planned day) and as a picture of the
// 35 days, a week to a row, the planned ones in gold.
import { SITE_NAME } from "../site.config.js";
import { CHARACTERS, DAYS, KINDS, LEVELS, copiesOn, dateOf, levelBefore } from "./plan.js";

export const fmtDate = (d, L, weekday = false) => d.toLocaleDateString(L, { day: "numeric", month: "short", ...(weekday ? { weekday: "short" } : {}) });

// What a day's plan says: "E1 → E3, wheel None → E0" (null when nothing is planned that day)
export function dayPlan(plan, day, today, T) {
  const parts = KINDS.filter((k) => copiesOn(plan, k, day, today) > 0)
    .map((k) => T.reruns.share.goal(k, LEVELS[levelBefore(plan, k, day, today)], LEVELS[plan.goals[day][k]]));
  return parts.length ? parts.join(", ") : null;
}
// "13 Dec GHelot: E1 → E3", for every planned day still to come
export function planLines(plan, today, T) {
  const out = [];
  for (let day = Math.max(0, today); day < DAYS; day++) {
    const p = dayPlan(plan, day, today, T);
    if (p) out.push(`${fmtDate(dateOf(day), T.numberLocale)} ${CHARACTERS[day]}: ${p}`);
  }
  return out;
}
export function planText(plan, today, T, summary) {
  const C = T.reruns.compact;
  const lines = planLines(plan, today, T);
  return [C.textTitle, ...(lines.length ? lines : [C.nothing]), ...(summary ? [summary] : [])].join("\n");
}

// The picture: 7 columns from Monday 30 Nov, 5 rows
const loadImage = (src) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; });
function fit(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
  return `${t}…`;
}
export async function planImage({ plan, today, T, summary, portrait }) {
  const R = T.reruns, L = T.numberLocale;
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => cs.getPropertyValue(n).trim() || d;
  const font = v("--font", "system-ui, sans-serif");
  const C = { bg: v("--bg", "#12181e"), tile: v("--surface-2", "#1c242d"), line: v("--line", "#2c3843"), ink: v("--ink", "#e8ebe7"), ink2: v("--ink-2", "#c3cac8"), muted: v("--muted", "#8d9a9c"), gold: v("--gold", "#e8b04f"), inset: v("--inset", "#121920") };
  const cols = 7, rows = Math.ceil(DAYS / cols);
  const pad = 40, gap = 10, tileW = 180, photoH = 180, textH = 70;
  const W = pad * 2 + cols * tileW + (cols - 1) * gap;
  const head = 120;
  const H = head + rows * (photoH + textH) + (rows - 1) * gap + pad + 26;
  const scale = 2;
  const out = document.createElement("canvas");
  out.width = W * scale; out.height = H * scale;
  const ctx = out.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.ink; ctx.font = `700 30px ${font}`;
  ctx.fillText(R.compact.title, pad, pad + 26);
  ctx.fillStyle = C.ink2; ctx.font = `500 17px ${font}`;
  ctx.fillText(fit(ctx, summary, W - pad * 2), pad, pad + 56);

  const images = await Promise.all(CHARACTERS.map((n) => loadImage(portrait(n))));
  const round = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
  CHARACTERS.forEach((name, day) => {
    const x = pad + (day % cols) * (tileW + gap);
    const y = head + Math.floor(day / cols) * (photoH + textH + gap);
    const past = day < today;
    const lines = KINDS.filter((k) => copiesOn(plan, k, day, today) > 0);
    round(x, y, tileW, photoH + textH, 10);
    ctx.fillStyle = C.tile; ctx.fill();
    ctx.save();
    // the photo, cut to the top of the tile (its corners rounded with the tile's)
    round(x, y, tileW, photoH + textH, 10); ctx.clip();
    ctx.beginPath(); ctx.rect(x, y, tileW, photoH); ctx.clip();
    const im = images[day];
    if (im) {
      // cover the photo area, a little above the middle
      const s = Math.max(tileW / im.width, photoH / im.height), w = im.width * s, h = im.height * s;
      ctx.filter = past || !lines.length ? "grayscale(1) brightness(0.6)" : "none";
      ctx.drawImage(im, x + (tileW - w) / 2, y + (photoH - h) / 2, w, h);
      ctx.filter = "none";
    }
    ctx.restore();
    round(x + 0.5, y + 0.5, tileW - 1, photoH + textH - 1, 10);
    ctx.strokeStyle = lines.length ? C.gold : C.line; ctx.lineWidth = lines.length ? 1.5 : 1; ctx.stroke();
    // date
    ctx.font = `500 13px ${font}`;
    const date = fmtDate(dateOf(day), L);
    const dw = ctx.measureText(date).width + 10;
    round(x + 5, y + 5, dw, 20, 6); ctx.fillStyle = "rgba(18, 24, 30, 0.85)"; ctx.fill();
    ctx.fillStyle = C.ink; ctx.fillText(date, x + 10, y + 19);
    // name and levels, close under the photo
    ctx.fillStyle = C.ink;
    ctx.font = `600 16px ${font}`;
    ctx.fillText(fit(ctx, name, tileW - 16), x + 8, y + photoH + 21);
    ctx.font = `600 17px ${font}`;
    if (past) { ctx.fillStyle = C.muted; ctx.fillText(R.ended, x + 8, y + photoH + 43); }
    else if (!lines.length) { ctx.fillStyle = C.muted; ctx.fillText(LEVELS[levelBefore(plan, "char", day, today)], x + 8, y + photoH + 43); }
    lines.forEach((k, i) => {
      const from = LEVELS[levelBefore(plan, k, day, today)], to = LEVELS[plan.goals[day][k]];
      const wheel = k === "wheel";
      ctx.font = `600 ${wheel ? 14 : 17}px ${font}`;
      const yy = y + photoH + 43 + i * 21;
      ctx.fillStyle = C.muted;
      const pre = `${wheel ? `${R.kindsShort.wheel} ` : ""}${from} → `;
      ctx.fillText(fit(ctx, pre, tileW - 60), x + 8, yy);
      ctx.fillStyle = C.gold;
      ctx.fillText(to, x + 8 + ctx.measureText(pre).width, yy);
    });
  });
  ctx.fillStyle = C.muted; ctx.font = `500 13px ${font}`;
  ctx.fillText(SITE_NAME, pad, H - pad + 14);
  // JPEG: the portraits make a PNG several MB
  return new Promise((ok) => out.toBlob(ok, "image/jpeg", 0.9));
}
