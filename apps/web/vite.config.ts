import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [react()],
  envDir: "../..",
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4187",
      "/private/researcher": "http://127.0.0.1:4192",
      "/private/organization": "http://127.0.0.1:4193",
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
