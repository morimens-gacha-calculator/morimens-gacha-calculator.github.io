// GET /s/<id>: a short link. Chat apps read this page's preview tags (the setup's own title,
// text and card image); people are sent on to the calculator with the setup at once.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SITE = "Morimens Gacha Calculator";
// where each calculator's links open, and its setup's place in the address
const OPEN = { banners: (code) => `/banners/#s=${code}`, covenant: (code) => `/covenant/#c=${code}`, income: (code) => `/income/#i=${code}` };

function page({ title, description, image, url, target, refresh }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<meta name="robots" content="noindex" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${esc(SITE)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(url)}" />
<meta property="og:image" content="${esc(image)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="theme-color" content="#15172a" />
${refresh ? `<meta http-equiv="refresh" content="${refresh}" />` : `<script>location.replace(${JSON.stringify(target)});</script>
<noscript><meta http-equiv="refresh" content="0; url=${esc(target)}" /></noscript>`}
</head>
<body style="font-family: system-ui, sans-serif; background: #15172a; color: #eceef6; padding: 24px">
<p>${refresh ? "This link is still being set up. Trying again…" : `Opening <a style="color:#9fc6ff" href="${esc(target)}">${esc(title)}</a>…`}</p>
</body>
</html>`;
}

export async function onRequestGet({ params, env, request }) {
  const url = new URL(request.url);
  const id = String(params.id);
  const record = env.LINKS && /^[0-9A-Za-z]{7,12}$/.test(id) ? await env.LINKS.get(`s:${id}`, "json") : null;
  const html = (body, status, cache) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": cache } });

  if (!record) {
    // A new link can take up to a minute to reach every Cloudflare location: retry for a minute,
    // then go to the calculator's start page
    const tries = Number(url.searchParams.get("t") || 0);
    if (tries >= 12) return Response.redirect(`${url.origin}/banners/`, 302);
    return html(page({
      title: SITE, description: "Exact pull odds for gacha banners with pity, soft pity, guarantees and memory rules.",
      image: `${url.origin}/og-image.png`, url: url.href, refresh: `5; url=${url.pathname}?t=${tries + 1}`,
    }), 404, "no-store");
  }
  return html(page({
    title: record.title || SITE,
    description: record.detail ? `${record.detail} · ${SITE}` : SITE,
    image: record.image ? `${url.origin}/i/${id}.jpg` : `${url.origin}/og-image.png`,
    url: `${url.origin}/s/${id}`,
    target: url.origin + (OPEN[record.calc] ?? OPEN.banners)(record.code),
  }), 200, "public, max-age=3600");
}
