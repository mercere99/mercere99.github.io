/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Keep the editable entry separate from index.html published by Pages.
  root: "web",
  envDir: "..",
  build: { outDir: "../dist", emptyOutDir: true },
  // Relative base so the build works from GitHub Pages or any subpath.
  base: "./",
  test: { root: ".", environment: "node" },
});
