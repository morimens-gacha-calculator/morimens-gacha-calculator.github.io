import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// base "./" makes the build work from any folder, including a GitHub Pages project page
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  // one page per calculator (the same app; each address opens its own calculator), and the
  // start page, which sends you to banners/
  build: { rollupOptions: { input: Object.fromEntries(["index.html", "banners/index.html", "covenant/index.html", "income/index.html", "reruns/index.html"].map((f) => [f.replace(/\/?index\.html$/, "") || "start", resolve(import.meta.dirname, f)])) } },
});
