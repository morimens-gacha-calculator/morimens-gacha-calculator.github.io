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
// The page's colours and font, for drawing
function theme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => cs.getPropertyValue(n).trim() || d;
  return {
    font: v("--font", "system-ui, sans-serif"),
    C: { bg: v("--bg", "#12181e"), tile: v("--surface-2", "#1c242d"), line: v("--line", "#2c3843"), ink: v("--ink", "#e8ebe7"), ink2: v("--ink-2", "#c3cac8"), muted: v("--muted", "#8d9a9c"), gold: v("--gold", "#e8b04f") },
  };
}
const roundRect = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
// a level too long for its column goes on two lines; then every tile gets the room for it
function textHeight(plan, today, days, tileW, font) {
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = `600 15px ${font}`;
  const tooLong = days.some((day) => KINDS.some((k) => copiesOn(plan, k, day, today) > 0
    && probe.measureText(`${LEVELS[levelBefore(plan, k, day, today)]} → ${LEVELS[plan.goals[day][k]]}`).width > tileW / 2 - 14));
  return tooLong ? 94 : 76;
}

// One day as a tile, as in the compact view: the portrait (grey unless planned), the date, the
// name, and Character | Wheel side by side
function drawTile(ctx, { x, y, tileW, photoH, textH, day, im, plan, today, T, C, font }) {
  const R = T.reruns, L = T.numberLocale;
  const name = CHARACTERS[day];
  const past = day < today;
  const lines = KINDS.filter((k) => copiesOn(plan, k, day, today) > 0);
  roundRect(ctx, x, y, tileW, photoH + textH, 10);
  ctx.fillStyle = C.tile; ctx.fill();
  ctx.save();
  // the photo, cut to the top of the tile (its corners rounded with the tile's)
  roundRect(ctx, x, y, tileW, photoH + textH, 10); ctx.clip();
  ctx.beginPath(); ctx.rect(x, y, tileW, photoH); ctx.clip();
  if (im) {
    const s = Math.max(tileW / im.width, photoH / im.height), w = im.width * s, h = im.height * s;
    ctx.filter = past || !lines.length ? "grayscale(1) brightness(0.6)" : "none";
    ctx.drawImage(im, x + (tileW - w) / 2, y + (photoH - h) / 2, w, h);
    ctx.filter = "none";
  }
  ctx.restore();
  roundRect(ctx, x + 0.5, y + 0.5, tileW - 1, photoH + textH - 1, 10);
  ctx.strokeStyle = lines.length ? C.gold : C.line; ctx.lineWidth = lines.length ? 1.5 : 1; ctx.stroke();
  // date
  ctx.font = `500 13px ${font}`;
  const date = fmtDate(dateOf(day), L);
  const dw = ctx.measureText(date).width + 10;
  roundRect(ctx, x + 5, y + 5, dw, 20, 6); ctx.fillStyle = "rgba(18, 24, 30, 0.85)"; ctx.fill();
  ctx.fillStyle = C.ink; ctx.fillText(date, x + 10, y + 19);
  // name and levels, close under the photo
  ctx.fillStyle = C.ink;
  ctx.font = `600 16px ${font}`;
  ctx.fillText(fit(ctx, name, tileW - 16), x + 8, y + photoH + 21);
  if (past) { ctx.font = `600 15px ${font}`; ctx.fillStyle = C.muted; ctx.fillText(R.ended, x + 8, y + photoH + 45); return; }
  // character | wheel, side by side, split by a thin line; the side with no plan dim
  const colW = tileW / 2;
  ctx.strokeStyle = C.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + colW + 0.5, y + photoH + 31); ctx.lineTo(x + colW + 0.5, y + photoH + textH - 9); ctx.stroke();
  KINDS.forEach((k, i) => {
    const cx = x + i * colW + 8, w = colW - 14;
    const from = LEVELS[levelBefore(plan, k, day, today)], to = LEVELS[plan.goals[day][k]];
    const on = lines.includes(k);
    ctx.font = `500 12.5px ${font}`; ctx.fillStyle = C.muted;
    ctx.fillText(fit(ctx, R.kindsShort[k], w), cx, y + photoH + 44);
    ctx.font = `600 15px ${font}`;
    ctx.globalAlpha = on ? 1 : 0.6;
    if (!on) { ctx.fillStyle = C.muted; ctx.fillText(fit(ctx, from, w), cx, y + photoH + 64); }
    else {
      const pre = `${from} → `;
      const pw = ctx.measureText(pre).width;
      ctx.fillStyle = C.muted; ctx.fillText(pre, cx, y + photoH + 64);
      ctx.fillStyle = C.gold;
      if (pw + ctx.measureText(to).width <= w) ctx.fillText(to, cx + pw, y + photoH + 64);
      else ctx.fillText(fit(ctx, to, w), cx, y + photoH + 82);
    }
    ctx.globalAlpha = 1;
  });
}

export async function planImage({ plan, today, T, summary, portrait }) {
  const R = T.reruns, L = T.numberLocale;
  const { font, C } = theme();
  const cols = 7, rows = Math.ceil(DAYS / cols);
  const pad = 40, gap = 10, tileW = 180, photoH = 180;
  const textH = textHeight(plan, today, CHARACTERS.map((_, d) => d), tileW, font);
  const W = pad * 2 + cols * tileW + (cols - 1) * gap;
  const head = 144; // title, summary, then the weekdays over the columns
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
  // Mon … Sun over the columns, as on the page (the first rerun day is a Monday)
  ctx.fillStyle = C.muted; ctx.font = `500 13px ${font}`; ctx.textAlign = "center";
  for (let i = 0; i < cols; i++) {
    const wd = dateOf(i).toLocaleDateString(L, { weekday: "short" });
    ctx.fillText(wd, pad + i * (tileW + gap) + tileW / 2, head - 10);
  }
  ctx.textAlign = "left";
  const images = await Promise.all(CHARACTERS.map((n) => loadImage(portrait(n))));
  CHARACTERS.forEach((_, day) => drawTile(ctx, {
    x: pad + (day % cols) * (tileW + gap), y: head + Math.floor(day / cols) * (photoH + textH + gap),
    tileW, photoH, textH, day, im: images[day], plan, today, T, C, font,
  }));
  ctx.fillStyle = C.muted; ctx.font = `500 13px ${font}`;
  ctx.fillText(SITE_NAME, pad, H - pad + 14);
  // JPEG: the portraits make a PNG several MB
  return new Promise((ok) => out.toBlob(ok, "image/jpeg", 0.9));
}

// The preview card for a short link (1200×630, like the other pages' cards): the answer and the
// numbers on top, the planned days under them as tiles. It is drawn from the plan, so it's the
// same whichever view is open. Planned days that don't fit: "+N more".
export async function shareCardImage({ title, detail }, { plan, today, T, portrait }) {
  const { font, C } = theme();
  const W = 1200, H = 630, pad = 56, gap = 12, maxTiles = 6;
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const ctx = out.getContext("2d");
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";
  // the answer, big; the numbers under it (each up to two lines, cut with "…")
  const wrap = (text, maxLines, width) => {
    const out = [""];
    for (const w of String(text).split(" ")) {
      const last = out[out.length - 1], next = last ? `${last} ${w}` : w;
      if (ctx.measureText(next).width <= width || !last) out[out.length - 1] = next;
      else if (out.length < maxLines) out.push(w);
      else { out[out.length - 1] = fit(ctx, `${last} ${w}`, width); break; }
    }
    return out;
  };
  ctx.fillStyle = C.ink; ctx.font = `700 44px ${font}`;
  const head = wrap(title, 2, W - 2 * pad);
  head.forEach((l, i) => ctx.fillText(l, pad, pad + 40 + i * 52));
  let y = pad + 40 + (head.length - 1) * 52;
  if (detail) {
    ctx.fillStyle = C.ink2; ctx.font = `500 24px ${font}`;
    const lines = wrap(detail, 2, W - 2 * pad);
    lines.forEach((l, i) => ctx.fillText(l, pad, y + 40 + i * 32));
    y += 40 + (lines.length - 1) * 32;
  }
  // the planned days still to come (or, with none, the next ones), as tiles
  const first = Math.max(0, today);
  const planned = CHARACTERS.map((_, d) => d).filter((d) => d >= first && KINDS.some((k) => copiesOn(plan, k, d, today) > 0));
  const days = planned.length ? planned : CHARACTERS.map((_, d) => d).filter((d) => d >= first).slice(0, maxTiles);
  const shown = days.length > maxTiles ? days.slice(0, maxTiles - 1) : days;
  const more = days.length - shown.length;
  const footer = 34;
  const top = y + 28, room = H - top - footer - 20;
  // as large as the room allows: fewer days, bigger tiles
  const slots = shown.length + (more ? 1 : 0);
  const tileW = Math.min(240, (W - 2 * pad - (slots - 1) * gap) / slots);
  const textH = textHeight(plan, today, shown, tileW, font);
  const photoH = Math.max(80, Math.min(Math.round(tileW * 1.3), room - textH)); // a bit taller than wide, to fill the card
  const images = await Promise.all(shown.map((d) => loadImage(portrait(CHARACTERS[d]))));
  shown.forEach((day, i) => drawTile(ctx, { x: pad + i * (tileW + gap), y: top, tileW, photoH, textH, day, im: images[i], plan, today, T, C, font }));
  if (more) {
    const x = pad + shown.length * (tileW + gap);
    roundRect(ctx, x + 0.5, top + 0.5, tileW - 1, photoH + textH - 1, 10);
    ctx.fillStyle = C.tile; ctx.fill(); ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = C.ink2; ctx.font = `600 28px ${font}`; ctx.textAlign = "center";
    ctx.fillText(T.reruns.compact.more(more), x + tileW / 2, top + (photoH + textH) / 2 + 10);
    ctx.textAlign = "left";
  }
  ctx.fillStyle = C.muted; ctx.font = `500 20px ${font}`;
  ctx.fillText(T.app.title, pad, H - pad / 2 - 4);
  return out.toDataURL("image/jpeg", 0.85);
}
