/* eslint-disable no-console */

/**
 * Helper to connect a page to the spreadsheet
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {string} [topic] - Topic name for the connection
 * @param {string} [mode] - Connection mode ('webrtc' or 'websocket')
 */
export async function connectToSpreadsheet (page, topic = 'test-topic', mode = 'webrtc') {
  await page.fill('#topic', topic)

  // Click the appropriate connect button based on mode
  if (mode === 'websocket') {
    await page.click('#connect-websocket')
  } else {
    await page.click('#connect-webrtc')
  }

  // Wait for spreadsheet to appear and be ready
  await page.waitForFunction(
    () => document.getElementById('spreadsheet').style.display !== 'none' &&
          document.getElementById('formula-input').disabled === false,
    { timeout: 15000 }
  )
}

/**
 * Helper to wait for any peer connection
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {number} [timeout] - Timeout in milliseconds
 */
export async function waitForPeerConnection (page, timeout = 60000) {
  // Increase timeout for CI environments where connections are slower
  const isCI = Boolean(process.env.CI)
  const effectiveTimeout = isCI ? Math.max(timeout, 180000) : timeout // 3 min for CI

  console.log(`Waiting for peer connection (timeout: ${effectiveTimeout}ms, CI: ${isCI})`)

  try {
    // Wait for peer count to be at least 2 (including relay)
    await page.waitForFunction(
      () => {
        const peerCountEl = document.querySelector('#peer-count')
        return peerCountEl && parseInt(peerCountEl.textContent) >= 2
      },
      { timeout: effectiveTimeout }
    )

    console.log('Peer connection established!')
  } catch (error) {
    // If timeout, capture diagnostic info
    const diagnostics = await page.evaluate(() => {
      return {
        peerCount: document.querySelector('#peer-count')?.textContent,
        connectionMode: document.querySelector('#connection-mode')?.textContent,
        peerId: document.querySelector('#peer-id-value')?.textContent,
        logContent: document.getElementById('log')?.value?.split('\n').slice(-10).join('\n')
      }
    })

    console.error('Failed to establish peer connection. Diagnostics:', diagnostics)
    throw error
  }
}

/**
 * Helper to wait for WebRTC connection (direct or over relay)
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {number} [timeout] - Timeout in milliseconds
 */
export async function waitForWebRTCConnection (page, timeout = 60000) {
  // First wait for basic peer connection
  await waitForPeerConnection(page, timeout)

  console.log('Peer connection reached 2+, now waiting for WebRTC badge...')

  // Debug: Check what badges exist before waiting
  const badgesBeforeWait = await page.evaluate(() => {
    const badges = Array.from(document.querySelectorAll('.transport'))
    return badges.map(b => ({ classes: b.className, text: b.textContent }))
  })
  console.log('Existing transport badges:', JSON.stringify(badgesBeforeWait))

  // Then wait for WebRTC transport badge to appear (direct or over relay)
  await page.waitForFunction(
    () => {
      const webrtcBadge = document.querySelector('.transport.webrtc')
      const relayWebrtcBadge = document.querySelector('.transport.relay-webrtc')
      console.log('Checking for WebRTC badges - direct:', webrtcBadge, 'relay+webrtc:', relayWebrtcBadge)
      return webrtcBadge !== null || relayWebrtcBadge !== null
    },
    { timeout }
  )

  console.log('WebRTC connection established!')
}
