import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  timeout: 60000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  globalSetup: './test/global-setup.js',
  globalTeardown: './test/global-teardown.js',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        // Enable WebRTC and STUN in Firefox for Playwright
        // Note: Firefox doesn't support Playwright's permissions API like Chromium
        // Instead, we use firefoxUserPrefs to configure permissions
        launchOptions: {
          firefoxUserPrefs: {
            // Core WebRTC enablement
            'media.peerconnection.enabled': true,
            'media.navigator.enabled': true,
            'media.navigator.permission.disabled': true,
            
            // CRITICAL: Allow host candidates and disable obfuscation
            'media.peerconnection.ice.default_address_only': false,
            'media.peerconnection.ice.no_host': false,
            'media.peerconnection.ice.obfuscate_host_addresses': false,  // NEW! Critical for host IPs
            'media.peerconnection.ice.obfuscate_host_addresses.blocklist': '',  // NEW! Empty blocklist
            
            // Enable ICE protocols
            'media.peerconnection.ice.tcp': true,
            'media.peerconnection.ice.relay_only': false,
            'media.peerconnection.ice.loopback': true,  // Enable loopback candidates for localhost
            'media.peerconnection.ice.link_local': true,  // Enable link-local addresses
            
            // Disable ALL privacy protections that interfere with ICE
            'media.peerconnection.ice.proxy_only_if_behind_proxy': false,
            'media.peerconnection.identity.enabled': true,
            'privacy.resistFingerprinting': false,  // NEW! Disable fingerprinting protection
            
            // Allow insecure connections for localhost testing
            'media.getusermedia.insecure.enabled': true,  // NEW! Allow getUserMedia on http://
            
            // Connection settings
            'media.peerconnection.use_document_iceservers': true,
            
            // Enable necessary permissions without prompts
            'permissions.default.camera': 1,
            'permissions.default.microphone': 1,
            'permissions.default.desktop-notification': 1,
            
            // Disable security restrictions for testing
            'network.http.referer.disallowCrossSiteRelaxingDefault': false,  // NEW!
            'security.fileuri.strict_origin_policy': false  // NEW!
          }
        }
      }
    },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] }
    // }
  ],
  webServer: {
    command: 'npx vite preview --port 5173',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  }
})
