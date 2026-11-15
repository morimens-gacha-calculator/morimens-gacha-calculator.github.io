// Shareable links: the setup (banner, pity and memory, pull plan, budget or target, calculation
// settings) packed into the address after "#s=", so nothing is sent to the server. An unchanged
// built-in banner is stored by its key only (short links; names in the reader's language); an
// edited or custom banner is stored in full. Display preferences (theme, decimals, chart lines)
// are not shared.
import { DEFAULT_SETTINGS, freshState, newId, presets } from "./model.js";

const VERSION = 1;
const CALC_SETTINGS = ["method", "eps", "maxPulls", "maxStates", "noLimits", "pct"];

function payloadOf(state) {
  const preset = presets()[state.preset];
  const unchanged = preset && JSON.stringify(state.banner) === JSON.stringify(preset.banner);
  const settings = {};
  for (const k of CALC_SETTINGS) if (state.settings?.[k] !== undefined && state.settings[k] !== DEFAULT_SETTINGS[k]) settings[k] = state.settings[k];
  return {
    v: VERSION,
    p: unchanged ? state.preset : "custom",
    ...(unchanged ? {} : { b: state.banner }),
    g: state.goal.map(({ id, ...row }) => row), // eslint-disable-line no-unused-vars
    gm: state.goalMode,
    s: state.start,
    m: state.mode,
    bu: state.budget,
    d: state.desired,
    ...(Object.keys(settings).length ? { st: settings } : {}),
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
  if (!p || p.v !== VERSION || !Array.isArray(p.g)) throw new Error("not a setup");
  const known = presets()[p.p];
  if (!known && !(p.b && Array.isArray(p.b.alts))) throw new Error("no banner");
  const base = freshState(known && !p.b ? p.p : "custom");
  return {
    ...base,
    preset: known && !p.b ? p.p : "custom",
    banner: p.b ?? base.banner,
    goal: p.g.map((row) => ({ ...row, id: newId() })),
    goalMode: p.gm === "any" ? "any" : "all",
    start: p.s && typeof p.s === "object" ? p.s : base.start,
    mode: p.m === "pulls" ? "pulls" : "budget",
    budget: Number.isFinite(p.bu) ? p.bu : base.budget,
    desired: Number.isFinite(p.d) ? p.d : base.desired,
    settings: { ...base.settings, ...(p.st ?? {}) },
  };
}

export const linkCode = (hash) => (hash.startsWith("#s=") ? hash.slice(3) : null);
