// vite.config.js
import { defineConfig } from "vite";

export default defineConfig({
  root: "public",          // onde está seu index.html
  build: {
    outDir: "../dist",     // saída na raiz (dist/)
    emptyOutDir: true
  },
  server: {
    port: 5173
  }
});
