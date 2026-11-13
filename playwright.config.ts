import { defineConfig, devices } from '@playwright/test'

// Browser tests run against the production build (`bun run build` first), served with the
// security headers from netlify.toml, using the Test API so no keys or network calls are needed.
export default defineConfig({
    testDir: './e2e',
    timeout: 30_000,
    retries: process.env.CI ? 1 : 0,
    use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: 'node scripts/serve-static.mjs out netlify.toml 4173',
        url: 'http://localhost:4173',
        reuseExistingServer: !process.env.CI,
    },
})
