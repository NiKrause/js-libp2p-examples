/* eslint-disable no-console */

import { test, expect } from '@playwright/test'

const url = 'http://localhost:5173'

// Helper to connect a page to the spreadsheet
async function connectToSpreadsheet (page, topic = 'test-topic', mode = 'webrtc') {
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

// Helper to wait for any peer connection
async function waitForPeerConnection (page, timeout = 60000) {
  // Wait for peer count to be at least 2 (including relay)
  await page.waitForFunction(
    () => {
      const peerCountEl = document.querySelector('#peer-count')
      return peerCountEl && parseInt(peerCountEl.textContent) >= 2
    },
    { timeout }
  )

  console.log('Peer connection established!')
}

// Helper to wait for WebRTC connection (green badge)
async function waitForWebRTCConnection (page, timeout = 60000) {
  // First wait for basic peer connection
  await waitForPeerConnection(page, timeout)

  console.log('Peer connection reached 2+, now waiting for WebRTC badge...')
  
  // Debug: Check what badges exist before waiting
  const badgesBeforeWait = await page.evaluate(() => {
    const badges = Array.from(document.querySelectorAll('.transport'))
    return badges.map(b => ({ classes: b.className, text: b.textContent }))
  })
  console.log('Existing transport badges:', JSON.stringify(badgesBeforeWait))

  // Then wait for WebRTC transport badge to appear (green badge)
  await page.waitForFunction(
    () => {
      const webrtcBadge = document.querySelector('.transport.webrtc')
      console.log('Checking for WebRTC badge, found:', webrtcBadge)
      return webrtcBadge !== null
    },
    { timeout }
  )

  console.log('WebRTC connection established!')
}

test.describe('Collaborative Spreadsheet - WebRTC-Direct Bootstrap', () => {
  test.setTimeout(120000) // Increase timeout for all tests to 2 minutes
  test('should load spreadsheet page in two browsers', async ({ browser }) => {
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    await page1.goto(url)
    await page2.goto(url)

    const heading1 = await page1.locator('h1').textContent()
    const heading2 = await page2.locator('h1').textContent()

    expect(heading1).toBe('Collaborative Spreadsheet')
    expect(heading2).toBe('Collaborative Spreadsheet')

    await context1.close()
    await context2.close()
  })

  test('should sync spreadsheet data between two browsers', async ({ browser }) => {
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    // Enable console logging for debugging
    page1.on('console', msg => console.log('Page1:', msg.text()))
    page2.on('console', msg => console.log('Page2:', msg.text()))

    await page1.goto(url)
    await page2.goto(url)

    // Connect both pages with the same topic
    const testTopic = `test-${Date.now()}`
    await connectToSpreadsheet(page1, testTopic)
    await connectToSpreadsheet(page2, testTopic)

    // Wait for both to be connected and ready
    await page1.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )
    await page2.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )

    // Wait for WebRTC connection to be established (green badge appears)
    console.log('Waiting for WebRTC connections...')
    await waitForWebRTCConnection(page1, 60000)
    await waitForWebRTCConnection(page2, 60000)
    console.log('WebRTC connections established on both pages!')

    // Give Yjs extra time to fully sync after WebRTC connection
    await page1.waitForTimeout(2000)

    // Enter value in cell A1 on page 1
    await page1.locator('#cell-A1').click()
    await page1.locator('#cell-A1').fill('42')
    await page1.locator('#cell-A1').press('Enter')

    // Wait for sync to page 2
    await page2.waitForFunction(
      () => document.querySelector('#cell-A1')?.value === '42',
      { timeout: 10000 }
    )

    // Verify value synced
    const page2A1 = await page2.locator('#cell-A1').inputValue()
    expect(page2A1).toBe('42')

    // Enter value in B1 on page 2
    await page2.locator('#cell-B1').click()
    await page2.locator('#cell-B1').fill('8')
    await page2.locator('#cell-B1').press('Enter')

    // Wait for sync back to page 1
    await page1.waitForFunction(
      () => document.querySelector('#cell-B1')?.value === '8',
      { timeout: 5000 }
    )

    const page1B1 = await page1.locator('#cell-B1').inputValue()
    expect(page1B1).toBe('8')

    await context1.close()
    await context2.close()
  })

  test('should sync formulas and calculations', async ({ browser }) => {
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    await page1.goto(url)
    await page2.goto(url)

    const testTopic = `formula-test-${Date.now()}`
    await connectToSpreadsheet(page1, testTopic)
    await connectToSpreadsheet(page2, testTopic)

    await page1.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )
    await page2.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )

    // Wait for WebRTC connection to be established (green badge appears)
    console.log('Waiting for WebRTC connections...')
    await waitForWebRTCConnection(page1, 60000)
    await waitForWebRTCConnection(page2, 60000)
    console.log('WebRTC connections established on both pages!')

    // Give Yjs extra time to fully sync after WebRTC connection
    await page1.waitForTimeout(2000)

    // Test basic arithmetic: A1 + B1
    await page1.locator('#cell-A1').click()
    await page1.locator('#cell-A1').fill('10')
    await page1.locator('#cell-A1').press('Enter')

    await page1.locator('#cell-B1').click()
    await page1.locator('#cell-B1').fill('20')
    await page1.locator('#cell-B1').press('Enter')

    await page1.locator('#cell-C1').click()
    await page1.locator('#cell-C1').fill('=A1+B1')
    await page1.locator('#cell-C1').press('Enter')

    // Wait for formula calculation and sync
    await page2.waitForFunction(
      () => document.querySelector('#cell-C1')?.value === '30',
      { timeout: 10000 }
    )

    const page2C1 = await page2.locator('#cell-C1').inputValue()
    expect(page2C1).toBe('30')

    // Test SUM formula: SUM(A1:B1)
    await page2.locator('#cell-D1').click()
    await page2.locator('#cell-D1').fill('=SUM(A1:B1)')
    await page2.locator('#cell-D1').press('Enter')

    await page1.waitForFunction(
      () => document.querySelector('#cell-D1')?.value === '30',
      { timeout: 10000 }
    )

    const page1D1 = await page1.locator('#cell-D1').inputValue()
    expect(page1D1).toBe('30')

    // Test multiplication and division
    await page1.locator('#cell-A2').click()
    await page1.locator('#cell-A2').fill('=A1*2')
    await page1.locator('#cell-A2').press('Enter')

    await page2.waitForFunction(
      () => document.querySelector('#cell-A2')?.value === '20',
      { timeout: 5000 }
    )

    await page2.locator('#cell-B2').click()
    await page2.locator('#cell-B2').fill('=B1/2')
    await page2.locator('#cell-B2').press('Enter')

    await page1.waitForFunction(
      () => document.querySelector('#cell-B2')?.value === '10',
      { timeout: 5000 }
    )

    // Test complex formula with parentheses
    await page1.locator('#cell-C2').click()
    await page1.locator('#cell-C2').fill('=(A1+B1)*2/4')
    await page1.locator('#cell-C2').press('Enter')

    await page2.waitForFunction(
      () => document.querySelector('#cell-C2')?.value === '15',
      { timeout: 5000 }
    )

    const page2C2 = await page2.locator('#cell-C2').inputValue()
    expect(page2C2).toBe('15')

    await context1.close()
    await context2.close()
  })
})

test.describe('Collaborative Spreadsheet - WebSocket Bootstrap', () => {
  test.setTimeout(120000) // Increase timeout for all tests to 2 minutes
  
  test('should sync spreadsheet data via WebSocket bootstrap', async ({ browser }) => {
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    // Enable console logging for debugging
    page1.on('console', msg => console.log('Page1:', msg.text()))
    page2.on('console', msg => console.log('Page2:', msg.text()))

    await page1.goto(url)
    await page2.goto(url)

    // Connect both pages with WebSocket-only mode
    const testTopic = `ws-test-${Date.now()}`
    await connectToSpreadsheet(page1, testTopic, 'websocket')
    await connectToSpreadsheet(page2, testTopic, 'websocket')

    // Wait for both to be connected and ready
    await page1.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )
    await page2.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )

    // Wait for WebRTC connections (all transports are enabled, so WebRTC upgrade should happen)
    console.log('Waiting for WebRTC connections...')
    await waitForWebRTCConnection(page1, 60000)
    await waitForWebRTCConnection(page2, 60000)
    console.log('WebRTC connections established on both pages!')

    // Give Yjs extra time to fully sync
    await page1.waitForTimeout(2000)

    // Enter value in cell A1 on page 1
    await page1.locator('#cell-A1').click()
    await page1.locator('#cell-A1').fill('100')
    await page1.locator('#cell-A1').press('Enter')

    // Wait for sync to page 2
    await page2.waitForFunction(
      () => document.querySelector('#cell-A1')?.value === '100',
      { timeout: 10000 }
    )

    // Verify value synced
    const page2A1 = await page2.locator('#cell-A1').inputValue()
    expect(page2A1).toBe('100')

    // Enter value in B1 on page 2
    await page2.locator('#cell-B1').click()
    await page2.locator('#cell-B1').fill('50')
    await page2.locator('#cell-B1').press('Enter')

    // Wait for sync back to page 1
    await page1.waitForFunction(
      () => document.querySelector('#cell-B1')?.value === '50',
      { timeout: 5000 }
    )

    const page1B1 = await page1.locator('#cell-B1').inputValue()
    expect(page1B1).toBe('50')

    await context1.close()
    await context2.close()
  })

  test('should sync formulas via WebSocket bootstrap', async ({ browser }) => {
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    await page1.goto(url)
    await page2.goto(url)

    const testTopic = `ws-formula-test-${Date.now()}`
    await connectToSpreadsheet(page1, testTopic, 'websocket')
    await connectToSpreadsheet(page2, testTopic, 'websocket')

    await page1.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )
    await page2.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )

    // Wait for WebRTC connections (all transports are enabled, so WebRTC upgrade should happen)
    console.log('Waiting for WebRTC connections...')
    await waitForWebRTCConnection(page1, 60000)
    await waitForWebRTCConnection(page2, 60000)
    console.log('WebRTC connections established on both pages!')

    // Give Yjs time to sync
    await page1.waitForTimeout(2000)

    // Enter values on page 1
    await page1.locator('#cell-A1').click()
    await page1.locator('#cell-A1').fill('25')
    await page1.locator('#cell-A1').press('Tab')

    await page1.locator('#cell-B1').fill('15')
    await page1.locator('#cell-B1').press('Enter')

    // Wait for sync to page 2
    await page2.waitForFunction(
      () => document.querySelector('#cell-A1')?.value === '25' &&
            document.querySelector('#cell-B1')?.value === '15',
      { timeout: 5000 }
    )

    // Create formula on page 2
    await page2.locator('#cell-C1').click()
    await page2.locator('#cell-C1').fill('=A1+B1')
    await page2.locator('#cell-C1').press('Enter')

    // Formula should calculate to 40
    await page2.waitForFunction(
      () => document.querySelector('#cell-C1')?.value === '40',
      { timeout: 5000 }
    )

    // Wait for formula to sync back to page 1
    await page1.waitForFunction(
      () => document.querySelector('#cell-C1')?.value === '40',
      { timeout: 5000 }
    )

    const page1C1 = await page1.locator('#cell-C1').inputValue()
    expect(page1C1).toBe('40')

    await context1.close()
    await context2.close()
  })
})
