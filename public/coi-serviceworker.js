/* Makes the page "cross-origin isolated" on hosts that can't send their own headers (like
   GitHub Pages), so the calculator may split big calculations across CPU cores
   (SharedArrayBuffer). It only adds two headers to responses; nothing is cached or changed.
   If the browser doesn't support it, the calculator simply runs on one core. */
if (typeof window === "undefined") {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
  self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;
    event.respondWith(fetch(req).then((res) => {
      if (res.status === 0) return res; // opaque responses can't be changed
      const headers = new Headers(res.headers);
      headers.set("Cross-Origin-Embedder-Policy", "require-corp");
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("Cross-Origin-Resource-Policy", "cross-origin");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }));
  });
} else {
  (() => {
    if (window.crossOriginIsolated || !window.isSecureContext || !navigator.serviceWorker) return;
    const flag = "coi-reloaded";
    navigator.serviceWorker.register(document.currentScript.src).then((reg) => {
      // reload once so the page loads with the headers; never loop
      if (sessionStorage.getItem(flag)) return;
      const reload = () => { sessionStorage.setItem(flag, "1"); window.location.reload(); };
      if (navigator.serviceWorker.controller) { reload(); return; }
      const sw = reg.installing || reg.waiting || reg.active;
      if (sw && sw.state === "activated") reload();
      else sw?.addEventListener("statechange", () => { if (sw.state === "activated") reload(); });
    }, () => { /* not allowed here: one core */ });
  })();
}
