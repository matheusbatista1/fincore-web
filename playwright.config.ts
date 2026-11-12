import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const isCI = !!process.env.CI;
/** A browser already on the machine (e.g. `msedge`) instead of Playwright's own Chromium. */
const channel = process.env.PLAYWRIGHT_CHANNEL;

/**
 * Browser tests. They drive the demo area (`/demo`): the app's real screens over made-up data,
 * with no sign-in and no database — so they need no secret and run anywhere.
 *
 * Two projects: a desktop Chromium and an iPhone (WebKit), because the app is used on a phone.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [["html", { open: "never" }], ["github"]] : "list",
  use: {
    baseURL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    // The PWA's service worker would answer from its cache and outlive the page: each test must
    // see what the server sends, and end when the page does.
    serviceWorkers: "block",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], ...(channel ? { channel } : {}) } },
    { name: "mobile", use: { ...devices["iPhone 15 Pro"] } },
  ],
  webServer: {
    command: "pnpm build && pnpm start",
    url: `${baseURL}/demo/dashboard`,
    reuseExistingServer: !isCI,
    timeout: 240_000,
    env: {
      // The demo area on, and nothing else needed: no database, no auth provider.
      FINCORE_DEMO: "1",
      SKIP_ENV_VALIDATION: "1",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
