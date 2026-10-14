import { defineConfig, devices } from '@playwright/test'

// A port of this suite's own, and never a server it did not start: 5173 is
// what every Vite app on the machine listens on, and a suite once tested a
// different app's dev server that happened to be up there.
export const port = Number(process.env.E2E_PORT || 5174)

export default defineConfig({
  testDir: './test',
  timeout: 120000, // Increased timeout for CI environments
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  globalSetup: './test/global-setup.js',
  globalTeardown: './test/global-teardown.js',
  // The dev server, started by the suite rather than by hand.
  webServer: {
    // Bound to 127.0.0.1: Vite's default binds [::1] only, which Chromium's
    // `localhost` does not reach.
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
    timeout: 120_000
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['clipboard-read', 'clipboard-write']
      }
    }
    // {
    //   name: 'firefox',
    //   use: {
    //     ...devices['Desktop Firefox'],
    //     permissions: ['clipboard-read', 'clipboard-write'],
    //     // Enable WebRTC and STUN in Firefox for Playwright
    //     // Note: Firefox doesn't support Playwright's permissions API like Chromium
    //     // Instead, we use firefoxUserPrefs to configure permissions
    //     launchOptions: {
    //       firefoxUserPrefs: {
    //         // Core WebRTC enablement
    //         'media.peerconnection.enabled': true,
    //         'media.navigator.enabled': true,
    //         'media.navigator.permission.disabled': true,

    //         // CRITICAL: Allow host candidates and disable obfuscation
    //         'media.peerconnection.ice.default_address_only': false,
    //         'media.peerconnection.ice.no_host': false,
    //         'media.peerconnection.ice.obfuscate_host_addresses': false,  // NEW! Critical for host IPs
    //         'media.peerconnection.ice.obfuscate_host_addresses.blocklist': '',  // NEW! Empty blocklist

    //         // Enable ICE protocols
    //         'media.peerconnection.ice.tcp': true,
    //         'media.peerconnection.ice.relay_only': false,
    //         'media.peerconnection.ice.loopback': true,  // Enable loopback candidates for localhost
    //         'media.peerconnection.ice.link_local': true,  // Enable link-local addresses

    //         // Disable ALL privacy protections that interfere with ICE
    //         'media.peerconnection.ice.proxy_only_if_behind_proxy': false,
    //         'media.peerconnection.identity.enabled': true,
    //         'privacy.resistFingerprinting': false,  // NEW! Disable fingerprinting protection

    //         // Allow insecure connections for localhost testing
    //         'media.getusermedia.insecure.enabled': true,  // NEW! Allow getUserMedia on http://

    //         // Connection settings
    //         'media.peerconnection.use_document_iceservers': true,

    //         // Enable necessary permissions without prompts
    //         'permissions.default.camera': 1,
    //         'permissions.default.microphone': 1,
    //         'permissions.default.desktop-notification': 1,

    //         // Disable security restrictions for testing
    //         'network.http.referer.disallowCrossSiteRelaxingDefault': false,  // NEW!
    //         'security.fileuri.strict_origin_policy': false  // NEW!
    //       }
    //     }
    //   }
    // },
    // {
    //   name: 'webkit',
    //   use: {
    //     ...devices['Desktop Safari'],
    //     permissions: ['clipboard-read', 'clipboard-write']
    //   }
    // }
  ]
})
