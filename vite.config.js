import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// base "./" makes the build work from any folder, including a GitHub Pages project page
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  // one page per calculator (the same app; each address opens its own calculator)
  build: { rollupOptions: { input: { main: resolve(import.meta.dirname, "index.html"), covenant: resolve(import.meta.dirname, "covenant/index.html") } } },
});
