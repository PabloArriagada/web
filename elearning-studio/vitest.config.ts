import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "apps/*/test/**/*.test.tsx"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Las pruebas del servidor comparten una base de datos de pruebas.
    fileParallelism: false,
  },
});
