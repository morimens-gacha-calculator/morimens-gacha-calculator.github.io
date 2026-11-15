import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" makes the build work from any folder, including a GitHub Pages project page
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
});
