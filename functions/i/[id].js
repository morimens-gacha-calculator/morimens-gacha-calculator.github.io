// GET /i/<id>.jpg: a short link's preview card image (made in the browser when it was shared)
export async function onRequestGet({ params, env, request }) {
  const id = String(params.id).replace(/\.jpg$/, "");
  const bytes = env.LINKS && /^[0-9A-Za-z]{7,12}$/.test(id) ? await env.LINKS.get(`i:${id}`, "arrayBuffer") : null;
  if (!bytes) return Response.redirect(`${new URL(request.url).origin}/og-image.png`, 302);
  return new Response(bytes, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
}
