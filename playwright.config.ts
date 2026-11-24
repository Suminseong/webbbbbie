import { defineConfig } from "@playwright/test";

const browserName =
  process.env.WEBBBBBIE_BROWSER_KIND === "firefox" ? "firefox" : "chromium";
const port = browserName === "firefox" ? 4174 : 4173;
const baseURL = "http://127.0.0.1:" + port;
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  workers: 2,
  timeout: 30_000,
  outputDir: "test-results/" + browserName,
  use: {
    baseURL,
    browserName,
    viewport: { width: 1440, height: 960 },
    launchOptions: { executablePath: process.env.WEBBBBBIE_BROWSER_EXECUTABLE },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run preview -- --port " + port + " --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 20000,
  },
});
