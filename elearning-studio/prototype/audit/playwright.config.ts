import { defineConfig, devices } from "@playwright/test";

// Auditoría del prototipo: se abre por file:// (como lo usaría el autor).
export default defineConfig({
  testDir: ".",
  timeout: 90_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    launchOptions: process.env["CHROMIUM_PATH"] ? { executablePath: process.env["CHROMIUM_PATH"] } : {},
  },
});
