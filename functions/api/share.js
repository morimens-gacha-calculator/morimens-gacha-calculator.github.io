// POST /api/share: keep a setup under a short code, for links like /s/k7Fq2aB.
// Body: { calc?, code, title, detail, image? }. calc = the calculator ("banners", the default,
// "covenant", "income" or "reruns"); code = the setup as in its long links ("#s=…", "#c=…",
// "#i=…", "#r=…"); title, detail = the preview
// card's text; image = the card as a JPEG data URL (made in the browser).
// Storage: the KV namespace bound as LINKS (s:<id> = the record, i:<id> = the card image).
// The same setup always gets the same code, so sharing it again writes nothing.
const MAX_CODE = 8000;      // characters; a big custom banner packs to ~1–2k
const MAX_TEXT = 300;       // characters per text field
const MAX_IMAGE = 400_000;  // bytes; a 1200×630 JPEG card is ~60–120 KB
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
// what each calculator's setup codes look like (functions/s/[id].js has where each one opens)
const CODES = { banners: /^[zj][A-Za-z0-9_-]+$/, covenant: /^1(?:[0-7][1-8]){3,6}$/, income: /^1[A-Za-z0-9_-]{2,6000}$/, reruns: /^1(?:-\d{1,8}){7}-[0-9a-g]{138}$/ };

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

async function idFor(code, len) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)));
  let id = "";
  for (let i = 0; i < len; i++) id += B62[hash[i] % 62];
  return id;
}

export async function onRequestPost({ request, env }) {
  if (!env.LINKS) return json({ error: "short links are not set up (no LINKS storage bound)" }, 503);
  // only the calculator's own pages may create links
  const origin = new URL(request.url).origin;
  const from = request.headers.get("origin");
  if (from && from !== origin) return json({ error: "not allowed" }, 403);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const { code, title, detail, image } = body ?? {};
  const calc = body?.calc ?? "banners";
  if (!CODES[calc]) return json({ error: "unknown calculator" }, 400);
  if (typeof code !== "string" || code.length > MAX_CODE || !CODES[calc].test(code)) return json({ error: "bad setup" }, 400);
  const text = (v) => (typeof v === "string" ? v.slice(0, MAX_TEXT) : "");

  // a short code from the setup's hash; longer only if it clashes with a different setup.
  // A reruns plan's numbers also depend on the sharer's income and the date, which its code
  // doesn't hold: there the card's text is part of the hash too, so new numbers get a new link
  // (and card) instead of the first one ever made for that plan.
  const seed = calc === "banners" ? code : calc === "reruns" ? `${calc}:${code}:${text(title)}:${text(detail)}` : `${calc}:${code}`;
  const same = (r) => r.code === code && (r.calc ?? "banners") === calc && (calc !== "reruns" || (r.title === text(title) && r.detail === text(detail)));
  let id = null;
  for (let len = 7; len <= 12 && !id; len++) {
    const candidate = await idFor(seed, len);
    const existing = await env.LINKS.get(`s:${candidate}`, "json");
    if (!existing) id = candidate;
    else if (same(existing)) return json({ id: candidate });
  }
  if (!id) return json({ error: "no free code" }, 500);

  let hasImage = false;
  const prefix = "data:image/jpeg;base64,";
  if (typeof image === "string" && image.startsWith(prefix) && image.length < MAX_IMAGE * 1.4) {
    try {
      const bytes = Uint8Array.from(atob(image.slice(prefix.length)), (c) => c.charCodeAt(0));
      if (bytes.length <= MAX_IMAGE) { await env.LINKS.put(`i:${id}`, bytes); hasImage = true; }
    } catch { /* no card image then */ }
  }
  await env.LINKS.put(`s:${id}`, JSON.stringify({ calc, code, title: text(title), detail: text(detail), image: hasImage, created: Date.now() }));
  return json({ id });
}
