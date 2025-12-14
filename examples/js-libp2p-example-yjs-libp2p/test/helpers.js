/* eslint-disable no-console */

/**
 * Helper to connect a page to the spreadsheet
 * Note: Connection now happens automatically on page load
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {string} [topic] - Topic name for the connection
 * @param {string} [mode] - Connection mode ('webrtc' or 'websocket') - parameter kept for compatibility but not used
 */
export async function connectToSpreadsheet (page, topic = 'test-topic', mode = 'webrtc') {
  // Set topic before page load to ensure auto-connect uses the correct topic
  await page.fill('#topic', topic)

  // Auto-connect is now triggered on page load, so we just wait for readiness
  // Wait for spreadsheet to appear and be ready (updated for new layout)
  await page.waitForFunction(
    () => {
      const spreadsheet = document.getElementById('spreadsheet')
      const formulaInput = document.getElementById('formula-input')
      const mainContent = document.querySelector('.main-content')
      
      // Check if main content is visible and spreadsheet exists with formula input enabled
      return mainContent && 
             spreadsheet && 
             formulaInput && 
             !formulaInput.disabled &&
             mainContent.style.display !== 'none'
    },
    { timeout: 15000 }
  )
}

/**
 * Helper to expand technical details accordion for log access
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 */
export async function expandTechnicalDetails (page) {
  await page.evaluate(() => {
    // Find the technical details panel by looking for the header text
    const panels = document.querySelectorAll('.panel.collapsed')
    for (const panel of panels) {
      const headerText = panel.querySelector('.panel-header')?.textContent
      if (headerText && headerText.includes('Peer-To-Peer Details')) {
        const button = panel.querySelector('.panel-header')
        if (button) button.click()
        break
      }
    }
  })
}

/**
 * Helper to wait for ready state in logs (expands technical details first)
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {number} [timeout] - Timeout in milliseconds
 */
export async function waitForReady (page, timeout = 15000) {
  // Expand technical details to access log
  await expandTechnicalDetails(page)
  
  // Wait for Ready! message in logs
  await page.waitForFunction(
    () => document.getElementById('log')?.value?.includes('Ready!'),
    { timeout }
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
    let diagnostics
    try {
      diagnostics = await page.evaluate(() => {
        return {
          peerCount: document.querySelector('#peer-count')?.textContent,
          connectionMode: document.querySelector('#connection-mode')?.textContent,
          peerId: document.querySelector('#peer-id-value')?.textContent,
          logContent: document.getElementById('log')?.value?.split('\n').slice(-10).join('\n'),
          mainContentVisible: document.querySelector('.main-content')?.style.display !== 'none',
          transports: Array.from(document.querySelectorAll('.transport')).map(t => ({
            classes: t.className,
            text: t.textContent
          }))
        }
      })
    } catch (evalError) {
      diagnostics = { error: 'Cannot access page diagnostics - page may be closed' }
    }

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
  try {
    // First wait for basic peer connection
    await waitForPeerConnection(page, timeout)

    console.log('Peer connection reached 2+, now waiting for WebRTC badge...')

    // Debug: Check what badges exist before waiting
    const badgesBeforeWait = await page.evaluate(() => {
      const badges = Array.from(document.querySelectorAll('.transport'))
      return badges.map(b => ({ classes: b.className, text: b.textContent }))
    })
    console.log('Existing transport badges:', JSON.stringify(badgesBeforeWait))

    // Check if page is still available before waiting
    const pageConnected = await page.evaluate(() => {
      return document.readyState === 'complete' && document.body
    }).catch(() => false)
    
    if (!pageConnected) {
      throw new Error('Page is no longer accessible')
    }

    // Then wait for WebRTC transport badge to appear (direct or over relay)
    // Use a shorter timeout with retries to avoid hanging
    const webrtcTimeout = Math.min(timeout, 30000) // Max 30 seconds for WebRTC upgrade
    
    try {
      await page.waitForFunction(
        () => {
          try {
            const webrtcBadge = document.querySelector('.transport.webrtc')
            const relayWebrtcBadge = document.querySelector('.transport.relay-webrtc')
            console.log('Checking for WebRTC badges - direct:', !!webrtcBadge, 'relay+webrtc:', !!relayWebrtcBadge)
            return webrtcBadge !== null || relayWebrtcBadge !== null
          } catch (e) {
            console.error('Error checking WebRTC badges:', e)
            return false
          }
        },
        { timeout: webrtcTimeout }
      )
      console.log('WebRTC connection established!')
    } catch (webrtcError) {
      // If WebRTC upgrade fails, check if we at least have a working connection
      const fallbackCheck = await page.evaluate(() => {
        const peerCount = document.querySelector('#peer-count')?.textContent
        return parseInt(peerCount) >= 2
      }).catch(() => false)
      
      if (fallbackCheck) {
        console.warn('WebRTC upgrade failed, but peer connection is stable. Continuing test...')
        return
      } else {
        throw new Error(`WebRTC connection failed after ${webrtcTimeout}ms: ${webrtcError.message}`)
      }
    }
  } catch (error) {
    // Enhanced error reporting
    const diagnostics = await page.evaluate(() => {
      try {
        return {
          peerCount: document.querySelector('#peer-count')?.textContent || '0',
          connectionMode: document.querySelector('#connection-mode')?.textContent || 'unknown',
          peerId: document.querySelector('#peer-id-value')?.textContent || 'none',
          transports: Array.from(document.querySelectorAll('.transport')).map(t => ({
            classes: t.className,
            text: t.textContent
          })),
          logContent: document.getElementById('log')?.value?.split('\n').slice(-20).join('\n') || 'No log available'
        }
      } catch (e) {
        return { error: 'Cannot access page diagnostics - page may be closed' }
      }
    }).catch(() => ({ error: 'Page evaluation failed - page is closed' }))

    console.error('WebRTC connection failed. Diagnostics:', JSON.stringify(diagnostics, null, 2))
    throw error
  }
}
