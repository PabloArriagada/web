import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite: SPA de edición sin necesidad de SSR; build rápido y HMR.
// En desarrollo /api se redirige al servidor Fastify (mismo origen para el
// iframe de preview, que necesita acceder a la API SCORM simulada del padre).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: `http://localhost:${process.env["PORT"] ?? 3000}`, changeOrigin: false } },
  },
  build: { outDir: "dist", sourcemap: true },
});
