// Shareable links: the setup (banner, pity and memory, pull plan, budget or target) packed into
// the address after "#s=", so nothing is sent to the server. An unchanged built-in banner is
// stored by its key only (short links; names in the reader's language); an edited or custom
// banner is stored in full. Settings are not shared: they're the reader's own, for every banner.
import { applyNames, fmtInt, fmtPct, freshState, fromEngineTree, newId, planTitle, presets, reqLabel, stagesOf, stageView } from "./model.js";

const VERSION = 2; // 1: banner in the editor's own form (still read)

// Item lists of the built-in banners, so a custom banner reusing one stores "@key/path" instead
// of every name (the reader's language then names them, as for built-in banners)
function presetPools() {
  const byNames = new Map(), byRef = new Map();
  for (const [key, p] of Object.entries(presets())) {
    (function walk(n, path) {
      n.alts.forEach((a, i) => {
        const at = [...path, i];
        if (a.children) return walk(a.children, at);
        const names = namesOf(a);
        if (names.length < 2) return;
        const ref = `@${key}/${at.join(",")}`;
        if (!byNames.has(names.join("\n"))) byNames.set(names.join("\n"), ref);
        byRef.set(ref, names);
      });
    })(p.banner, []);
  }
  return { byNames, byRef };
}
const namesOf = (a) => (typeof a.items === "string" ? a.items.split(",").map((x) => x.trim()).filter(Boolean) : Array.isArray(a.items) ? a.items : []);

// The banner, short: only what differs from the defaults; chances as typed ("1/33")
function packBanner(n, pools) {
  const alts = n.alts.map((a) => {
    const o = { name: a.name, p: a.p };
    if (Number(a.pity) > 0) o.pity = a.pity;
    if (a.pityYields) o.pityYields = true;
    if (a.pityResetBy === "above") o.pityResetBy = "above";
    if (a.onPreempt === "lose") o.onPreempt = "lose";
    if (a.softStart !== "" && a.softStart != null) o.soft = { start: Number(a.softStart), step: a.softStep };
    if (a.children) o.children = packBanner(a.children, pools);
    else if (Number(a.count) > 1) {
      o.count = Number(a.count);
      const names = namesOf(a);
      if (names.length) o.items = pools.byNames.get(names.join("\n")) ?? names;
    }
    return o;
  });
  return n.streak > 0 ? { streak: n.streak, alts } : alts;
}
function unpackBanner(raw, pools) {
  const fix = (n) => {
    const alts = Array.isArray(n) ? n : n.alts;
    for (const a of alts) {
      if (typeof a.items === "string" && a.items.startsWith("@")) {
        const names = pools.byRef.get(a.items);
        if (names) a.items = names; else delete a.items; // a built-in banner that changed since
      }
      if (a.children) fix(a.children);
    }
  };
  fix(raw);
  return fromEngineTree(raw);
}
const ROW_DEFAULTS = { type: "total", item: 0, k: 1, copies: 1, from: "" };

// One banner of the plan: its banner (a built-in one by key), goals, goal mode and pity
function bannerPayload(state) {
  const preset = presets()[state.preset];
  // a built-in banner with only your own names (Edit names) is still that banner: its key and the names
  const names = preset && state.names ? state.names : null;
  const unchanged = preset && JSON.stringify(state.banner) === JSON.stringify(applyNames(preset.banner, names));
  const rows = state.goal.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) if (k !== "id" && v != null && JSON.stringify(v) !== JSON.stringify(ROW_DEFAULTS[k])) out[k] = v;
    if (row.type !== "specific") delete out.item;
    if (row.type !== "distinct") delete out.k;
    return out;
  });
  const start = Object.fromEntries(Object.entries(state.start ?? {}).filter(([, v]) => v && Object.keys(v).length));
  return {
    p: unchanged ? state.preset : "custom",
    ...(unchanged ? {} : { b: packBanner(state.banner, presetPools()) }),
    g: rows,
    ...(state.goalMode === "any" ? { gm: "any" } : {}),
    ...(Object.keys(start).length ? { s: start } : {}),
    ...(String(state.title ?? "").trim() ? { t: String(state.title).trim() } : {}),
    ...(unchanged && names ? { n: names } : {}),
  };
}
// The whole plan: banner 1 at the top level (as links have always had it), the other banners in
// "st" with their own pulls ("bu"), and "sp": "fixed" when each banner has its own pulls
function payloadOf(state) {
  const stages = stagesOf(state);
  return {
    v: VERSION,
    ...bannerPayload(state),
    ...(state.mode === "pulls" ? { m: "pulls", d: state.desired } : { bu: state.budget }),
    ...(stages.length ? { st: stages.map((_, k) => { const v = stageView(state, k + 1); return { ...bannerPayload(v), bu: v.budget }; }) } : {}),
    ...(stages.length && state.spend === "fixed" ? { sp: "fixed" } : {}),
  };
}

// base64url without padding
const toB64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64 = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}
const canCompress = () => typeof CompressionStream === "function" && typeof DecompressionStream === "function";

// "z…" deflated JSON, "j…" plain JSON (browsers without compression streams)
export async function encodeSetup(state) {
  const json = new TextEncoder().encode(JSON.stringify(payloadOf(state)));
  return canCompress() ? "z" + toB64(await pipe(json, new CompressionStream("deflate-raw"))) : "j" + toB64(json);
}

export async function makeShareLink(state) {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}#s=${await encodeSetup(state)}`;
}

// The setup in a link's "#s=…", as a full app state; null when there is none; throws when broken
export async function decodeSetup(code) {
  const kind = code[0], bytes = fromB64(code.slice(1));
  const json = kind === "z" ? await pipe(bytes, new DecompressionStream("deflate-raw")) : kind === "j" ? bytes : null;
  if (!json) throw new Error("unknown link format");
  const p = JSON.parse(new TextDecoder().decode(json));
  if (!p || (p.v !== 1 && p.v !== VERSION) || !Array.isArray(p.g)) throw new Error("not a setup");
  const first = bannerFromPayload(p, p.v);
  const stages = Array.isArray(p.st) ? p.st.map((x) => {
    if (!x || !Array.isArray(x.g)) throw new Error("not a setup");
    const b = bannerFromPayload(x, VERSION);
    return { id: newId(), ...b, pulls: Number.isFinite(x.bu) ? x.bu : freshState(b.preset).budget };
  }) : [];
  const base = freshState(first.preset);
  return {
    ...base,
    ...first,
    mode: p.m === "pulls" ? "pulls" : "budget",
    budget: Number.isFinite(p.bu) ? p.bu : base.budget,
    desired: Number.isFinite(p.d) ? p.d : base.desired,
    stages,
    spend: p.sp === "fixed" && stages.length ? "fixed" : "shared",
    // settings are the reader's own (they're shared by every banner), so a link doesn't carry them
  };
}
function bannerFromPayload(p, version) {
  const known = presets()[p.p];
  if (p.b && version === VERSION) p.b = unpackBanner(p.b, presetPools());
  if (!known && !(p.b && Array.isArray(p.b.alts))) throw new Error("no banner");
  const base = freshState(known && !p.b ? p.p : "custom");
  const names = known && !p.b && p.n && typeof p.n === "object" ? { o: p.n.o ?? undefined, i: p.n.i ?? undefined } : null;
  return {
    preset: known && !p.b ? p.p : "custom",
    banner: p.b ?? applyNames(base.banner, names),
    ...(typeof p.t === "string" && p.t.trim() ? { title: p.t.trim().slice(0, 80) } : {}),
    ...(names ? { names } : {}),
    goal: p.g.map((row) => ({ ...ROW_DEFAULTS, ...row, id: newId() })),
    goalMode: p.gm === "any" ? "any" : "all",
    start: { ...base.start, ...(p.s && typeof p.s === "object" ? p.s : {}) },
  };
}

// What a shared link says, for the message it's pasted into (chat previews can't read the setup:
// it sits after "#", which never reaches a server). The answer comes first, then what was asked:
//
//   59.6% chance with 300 pulls
//   • Limited character banner: limited character ×4
//   • Limited wheel banner: limited wheel ×4
//   Average: 287 pulls
//
// (one banner plan: its line without the bullet). Each banner plan on its own pulls: "… chance to
// get everything", with each plan's pulls on its line.
function shareLines(state, result, T) {
  const X = T.share;
  const fixed = result?.spend === "fixed";
  const views = [state, ...stagesOf(state).map((_, k) => stageView(state, k + 1))];
  const plans = views.map((v) => ({
    name: planTitle(v),
    goals: v.goal.map((g) => reqLabel(v.banner, g)).join(v.goalMode === "all" ? T.goalLabel.joinAll : T.goalLabel.joinAny),
    pulls: fixed ? Math.max(0, Math.floor(Number(v.budget) || 0)) : null,
  }));
  let headline = "", extra = "";
  if (result) {
    const average = Number.isFinite(result.mean) ? X.average(Math.round(result.mean), fmtInt(result.mean)) : "";
    if (fixed) headline = X.chanceAll(fmtPct(result.chanceAll));
    else if (state.mode === "budget" && result.budget) {
      const b = Math.max(0, Math.floor(Number(state.budget) || 0));
      headline = X.chanceWith(fmtPct(result.budget.chanceGoal), b, fmtInt(b));
      extra = average;
    } else if (result.requiredPulls != null) {
      const want = `${Number(state.desired).toLocaleString(T.numberLocale, { maximumFractionDigits: 2 })}%`;
      headline = X.pullsFor(result.requiredPulls, fmtInt(result.requiredPulls), want);
      extra = average;
    } else headline = average;
  }
  const line = (p) => (p.pulls != null ? X.planPulls(p.name, X.pulls(p.pulls, fmtInt(p.pulls)), p.goals) : X.plan(p.name, p.goals));
  return { headline, plans, extra, line };
}

// For the preview card: title = the answer, detail = what was asked (one plan: its banner and goals;
// several: their names in order) and the average
export function shareParts(state, result, T) {
  const { headline, plans, extra, line } = shareLines(state, result, T);
  const setup = plans.length === 1 ? line(plans[0]) : plans.map((p) => p.name).join(T.share.then);
  if (!headline) return { title: setup, detail: "" };
  return { title: headline, detail: [setup, extra].filter(Boolean).join(" · ") };
}
// For the message: one thing per line
export function shareSummary(state, result, T) {
  const { headline, plans, extra, line } = shareLines(state, result, T);
  const asked = plans.length === 1 ? [line(plans[0])] : plans.map((p) => `• ${line(p)}`);
  return [headline, ...asked, extra].filter(Boolean).join("\n");
}

// A short link (/s/k7Fq2aB) from the site's own server functions (functions/api/share.js), with
// the preview card's text and image; null where there are none (a local build, GitHub Pages, no
// storage set up) or they don't answer in 5 seconds: then the long "#s=" link is used
export async function makeShortLink(state, parts, image) {
  return postShortLink({ calc: "banners", code: await encodeSetup(state), title: parts.title, detail: parts.detail, image });
}
// The same for any calculator: calc = its key (functions/s/[id].js sends the link there), code =
// its setup as in its own long link
export async function postShortLink({ calc, code, title, detail, image }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(new URL("api/share", window.location.origin + "/"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ calc, code, title, detail, image }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const { id } = await res.json();
    return typeof id === "string" ? new URL(`s/${id}`, window.location.origin + "/").href : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const linkCode = (hash) => (hash.startsWith("#s=") ? hash.slice(3) : null);
