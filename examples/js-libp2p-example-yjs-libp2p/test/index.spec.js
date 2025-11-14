/* eslint-disable no-console */

import { test, expect } from '@playwright/test'
import {
  connectToSpreadsheet,
  waitForWebRTCConnection
} from './helpers.js'

const url = 'http://localhost:5173'

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

  test('should recalculate formulas when dependencies change (two browsers)', async ({ browser }) => {
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    // Enable console logging for debugging
    page1.on('console', msg => console.log('Page1:', msg.text()))
    page2.on('console', msg => console.log('Page2:', msg.text()))

    await page1.goto(url)
    await page2.goto(url)

    const testTopic = `recalc-test-${Date.now()}`
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

    // Wait for WebRTC connection to be established
    console.log('Waiting for WebRTC connections...')
    await waitForWebRTCConnection(page1, 60000)
    await waitForWebRTCConnection(page2, 60000)
    console.log('WebRTC connections established on both pages!')

    // Give Yjs extra time to fully sync after WebRTC connection
    await page1.waitForTimeout(2000)

    // Step 1: Set A1 = 1 on page 1
    console.log('Step 1: Setting A1 = 1')
    await page1.locator('#cell-A1').click()
    await page1.locator('#cell-A1').fill('1')
    await page1.locator('#cell-A1').press('Enter')

    // Wait for sync to page 2
    await page2.waitForFunction(
      () => document.querySelector('#cell-A1')?.value === '1',
      { timeout: 5000 }
    )

    // Step 2: Set A2 = 2 on page 1
    console.log('Step 2: Setting A2 = 2')
    await page1.locator('#cell-A2').click()
    await page1.locator('#cell-A2').fill('2')
    await page1.locator('#cell-A2').press('Enter')

    // Wait for sync to page 2
    await page2.waitForFunction(
      () => document.querySelector('#cell-A2')?.value === '2',
      { timeout: 5000 }
    )

    // Step 3: Set A3 = A1+A2 on page 1 (should calculate to 3)
    console.log('Step 3: Setting A3 = A1+A2')
    await page1.locator('#cell-A3').click()
    await page1.locator('#cell-A3').fill('=A1+A2')
    await page1.locator('#cell-A3').press('Enter')

    // Wait for formula to calculate
    await page1.waitForFunction(
      () => document.querySelector('#cell-A3')?.value === '3',
      { timeout: 5000 }
    )

    // Verify on page 1
    let page1A3 = await page1.locator('#cell-A3').inputValue()
    expect(page1A3).toBe('3')
    console.log('✓ A3 = 3 on page 1')

    // Wait for sync to page 2 and verify
    await page2.waitForFunction(
      () => document.querySelector('#cell-A3')?.value === '3',
      { timeout: 5000 }
    )
    let page2A3 = await page2.locator('#cell-A3').inputValue()
    expect(page2A3).toBe('3')
    console.log('✓ A3 = 3 on page 2')

    // Step 4: Set A4 = A1*A2 on page 2 (should calculate to 2)
    console.log('Step 4: Setting A4 = A1*A2 on page 2')
    await page2.locator('#cell-A4').click()
    await page2.waitForTimeout(300) // Wait for focus
    await page2.locator('#cell-A4').fill('=A1*A2')
    await page2.locator('#cell-A4').press('Tab') // Tab to trigger save and move

    // Wait for formula to calculate on page 2
    await page2.waitForTimeout(1000)
    await page2.waitForFunction(
      () => document.querySelector('#cell-A4')?.value === '2',
      { timeout: 10000 }
    )
    let page2A4 = await page2.locator('#cell-A4').inputValue()
    expect(page2A4).toBe('2')
    console.log('✓ A4 = 2 on page 2')

    // Wait for Yjs sync to page 1
    await page1.waitForTimeout(3000)

    // Blur any focused input to allow UI updates
    // The UI intentionally skips updating focused inputs to avoid interfering with user editing.
    // During testing, inputs can remain focused from previous interactions, preventing sync updates
    // from appearing. This blur ensures the UI reflects the synced data.
    await page1.evaluate(() => {
      if (document.activeElement && document.activeElement.tagName === 'INPUT') {
        document.activeElement.blur()
      }
    })
    await page1.waitForTimeout(100)

    await page1.waitForFunction(
      () => document.querySelector('#cell-A4')?.value === '2',
      { timeout: 10000 }
    )
    let page1A4 = await page1.locator('#cell-A4').inputValue()
    expect(page1A4).toBe('2')
    console.log('✓ A4 = 2 on page 1')

    // Step 5: Change A1 to 5 on page 1
    console.log('Step 5: Changing A1 to 5')
    await page1.locator('#cell-A1').click()
    await page1.locator('#cell-A1').fill('5')
    await page1.locator('#cell-A1').press('Enter')

    // Wait for A1 to update
    await page1.waitForFunction(
      () => document.querySelector('#cell-A1')?.value === '5',
      { timeout: 5000 }
    )

    // Step 6: Verify A3 recalculates to 7 (5+2) on page 1
    console.log('Step 6: Verifying A3 recalculates to 7')
    await page1.waitForFunction(
      () => document.querySelector('#cell-A3')?.value === '7',
      { timeout: 5000 }
    )
    page1A3 = await page1.locator('#cell-A3').inputValue()
    expect(page1A3).toBe('7')
    console.log('✓ A3 recalculated to 7 on page 1')

    // Step 7: Verify A4 recalculates to 10 (5*2) on page 1
    console.log('Step 7: Verifying A4 recalculates to 10')
    await page1.waitForFunction(
      () => document.querySelector('#cell-A4')?.value === '10',
      { timeout: 5000 }
    )
    page1A4 = await page1.locator('#cell-A4').inputValue()
    expect(page1A4).toBe('10')
    console.log('✓ A4 recalculated to 10 on page 1')

    // Step 8: Verify changes synced to page 2 (A1=5, A3=7, A4=10)
    console.log('Step 8: Verifying sync to page 2')
    await page2.waitForFunction(
      () => document.querySelector('#cell-A1')?.value === '5' &&
            document.querySelector('#cell-A3')?.value === '7' &&
            document.querySelector('#cell-A4')?.value === '10',
      { timeout: 5000 }
    )

    const page2A1 = await page2.locator('#cell-A1').inputValue()
    page2A3 = await page2.locator('#cell-A3').inputValue()
    page2A4 = await page2.locator('#cell-A4').inputValue()

    expect(page2A1).toBe('5')
    expect(page2A3).toBe('7')
    expect(page2A4).toBe('10')
    console.log('✓ All values synced to page 2: A1=5, A3=7, A4=10')

    // Step 9: Change A2 to 3 on page 2
    console.log('Step 9: Changing A2 to 3 on page 2')
    // Click somewhere else first to ensure clean focus state
    await page2.locator('#cell-B1').click()
    await page2.waitForTimeout(200)

    await page2.locator('#cell-A2').click()
    await page2.waitForTimeout(200)
    await page2.locator('#cell-A2').fill('3')
    await page2.locator('#cell-A2').press('Tab') // Use Tab instead of Enter

    // Give time for recalculation
    await page2.waitForTimeout(1000)

    // Step 10: Verify formulas recalculate on page 2 (A3=8, A4=15)
    console.log('Step 10: Verifying formulas recalculate on page 2')
    await page2.waitForFunction(
      () => document.querySelector('#cell-A3')?.value === '8' &&
            document.querySelector('#cell-A4')?.value === '15',
      { timeout: 5000 }
    )

    page2A3 = await page2.locator('#cell-A3').inputValue()
    page2A4 = await page2.locator('#cell-A4').inputValue()
    expect(page2A3).toBe('8')
    expect(page2A4).toBe('15')
    console.log('✓ Formulas recalculated on page 2: A3=8, A4=15')

    // Step 11: Verify sync back to page 1
    console.log('Step 11: Verifying sync back to page 1')
    await page1.waitForTimeout(3000) // Give extra time for sync

    // Blur focused inputs to ensure synced values are displayed
    await page1.evaluate(() => {
      if (document.activeElement && document.activeElement.tagName === 'INPUT') {
        document.activeElement.blur()
      }
    })
    await page1.waitForTimeout(100)

    await page1.waitForFunction(
      () => document.querySelector('#cell-A2')?.value === '3' &&
            document.querySelector('#cell-A3')?.value === '8' &&
            document.querySelector('#cell-A4')?.value === '15',
      { timeout: 10000 }
    )

    const page1A2 = await page1.locator('#cell-A2').inputValue()
    page1A3 = await page1.locator('#cell-A3').inputValue()
    page1A4 = await page1.locator('#cell-A4').inputValue()

    expect(page1A2).toBe('3')
    expect(page1A3).toBe('8')
    expect(page1A4).toBe('15')
    console.log('✓ All values synced back to page 1: A2=3, A3=8, A4=15')

    console.log('✅ Formula recalculation test passed!')

    await context1.close()
    await context2.close()
  })

  test('should recalculate formulas when values change (single browser)', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto(url)

    const testTopic = `single-recalc-${Date.now()}`
    await connectToSpreadsheet(page, testTopic)

    await page.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )

    // Set up: A1=1, A2=2
    await page.locator('#cell-A1').click()
    await page.locator('#cell-A1').fill('1')
    await page.locator('#cell-A1').press('Enter')

    await page.locator('#cell-A2').click()
    await page.locator('#cell-A2').fill('2')
    await page.locator('#cell-A2').press('Enter')

    // Create A3 = A1+A2 (should be 3)
    await page.locator('#cell-A3').click()
    await page.locator('#cell-A3').fill('=A1+A2')
    await page.locator('#cell-A3').press('Enter')

    await page.waitForFunction(
      () => document.querySelector('#cell-A3')?.value === '3',
      { timeout: 5000 }
    )
    console.log('✓ A3 = 3 (1+2)')

    // Create A4 = A1*A2 (should be 2)
    console.log('Creating A4 formula...')
    await page.locator('#cell-A4').click()
    await page.locator('#cell-A4').fill('=A1*A2')
    await page.locator('#cell-A4').press('Enter')

    console.log('Waiting for A4 to calculate to 2...')
    await page.waitForFunction(
      () => {
        const val = document.querySelector('#cell-A4')?.value
        console.log('A4 value is:', val)
        return val === '2'
      },
      { timeout: 10000 }
    )
    console.log('✓ A4 = 2 (1*2)')

    // Change A1 to 5
    await page.locator('#cell-A1').click()
    await page.locator('#cell-A1').fill('5')
    await page.locator('#cell-A1').press('Enter')

    // Wait for recalculation: A3 should be 7 (5+2)
    await page.waitForFunction(
      () => document.querySelector('#cell-A3')?.value === '7',
      { timeout: 5000 }
    )
    const a3 = await page.locator('#cell-A3').inputValue()
    expect(a3).toBe('7')
    console.log('✓ A3 recalculated to 7 (5+2)')

    // A4 should be 10 (5*2)
    await page.waitForFunction(
      () => document.querySelector('#cell-A4')?.value === '10',
      { timeout: 5000 }
    )
    const a4 = await page.locator('#cell-A4').inputValue()
    expect(a4).toBe('10')
    console.log('✓ A4 recalculated to 10 (5*2)')

    // Change A2 to 3
    console.log('Changing A2 to 3...')
    // Click somewhere else first to ensure clean focus state
    await page.locator('#cell-B1').click()
    await page.waitForTimeout(200)

    await page.locator('#cell-A2').click()
    await page.waitForTimeout(200)
    await page.locator('#cell-A2').fill('3')
    await page.locator('#cell-A2').press('Tab') // Use Tab instead of Enter
    console.log('A2 changed, waiting for recalculation...')

    // Wait for recalculation: A3 should be 8 (5+3)
    await page.waitForFunction(
      () => {
        const a3 = document.querySelector('#cell-A3')?.value
        console.log('Checking A3, current value:', a3, 'expecting: 8')
        return a3 === '8'
      },
      { timeout: 10000 }
    )
    const a3Final = await page.locator('#cell-A3').inputValue()
    expect(a3Final).toBe('8')
    console.log('✓ A3 recalculated to 8 (5+3)')

    // A4 should be 15 (5*3)
    await page.waitForFunction(
      () => document.querySelector('#cell-A4')?.value === '15',
      { timeout: 5000 }
    )
    const a4Final = await page.locator('#cell-A4').inputValue()
    expect(a4Final).toBe('15')
    console.log('✓ A4 recalculated to 15 (5*3)')

    console.log('✅ Formula recalculation test passed!')

    await context.close()
  })

  test('should preserve formulas when focusing cells', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto(url)

    const testTopic = `formula-preserve-${Date.now()}`
    await connectToSpreadsheet(page, testTopic)

    await page.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )

    // Set up test data
    await page.locator('#cell-A1').click()
    await page.locator('#cell-A1').fill('10')
    await page.locator('#cell-A1').press('Enter')

    await page.locator('#cell-A2').click()
    await page.locator('#cell-A2').fill('20')
    await page.locator('#cell-A2').press('Enter')

    // Create formula in A3
    await page.locator('#cell-A3').click()
    await page.locator('#cell-A3').fill('=A1+A2')
    await page.locator('#cell-A3').press('Enter')

    // Wait for formula to calculate
    await page.waitForFunction(
      () => document.querySelector('#cell-A3')?.value === '30',
      { timeout: 5000 }
    )

    // Click on A3 - should show formula in input
    await page.locator('#cell-A3').click()
    const a3FocusedValue = await page.locator('#cell-A3').inputValue()
    expect(a3FocusedValue).toBe('=A1+A2')
    console.log('✓ Formula shown when focused: =A1+A2')

    // Click away without editing - should restore result
    await page.locator('#cell-A4').click()
    await page.waitForTimeout(500) // Give time for blur to process

    const a3BlurredValue = await page.locator('#cell-A3').inputValue()
    expect(a3BlurredValue).toBe('30')
    console.log('✓ Result shown when blurred: 30')

    // Focus again to verify formula is still there
    await page.locator('#cell-A3').click()
    const a3FocusedAgain = await page.locator('#cell-A3').inputValue()
    expect(a3FocusedAgain).toBe('=A1+A2')
    console.log('✓ Formula preserved after blur: =A1+A2')

    // Test Escape key
    await page.locator('#cell-A3').click()
    await page.locator('#cell-A3').press('Escape')
    await page.waitForTimeout(500)

    const a3AfterEscape = await page.locator('#cell-A3').inputValue()
    expect(a3AfterEscape).toBe('30')
    console.log('✓ Result shown after Escape: 30')

    console.log('✅ Formula preservation test passed!')

    await context.close()
  })
})

test.describe('Collaborative Spreadsheet - WebSocket Bootstrap', () => {
  test.setTimeout(120000) // Increase timeout for all tests to 2 minutes

  // Skip WebSocket Bootstrap tests on WebKit due to known limitation:
  // WebKit's WebRTC DataChannel gets stuck in "connecting" state when upgrading
  // from WebSocket relay connections. Direct WebRTC works fine in WebKit.
  // TODO Fix: https://github.com/libp2p/js-libp2p/issues/3347
  // test.skip(({ browserName }) => browserName === 'webkit', 'WebKit does not support WebSocket→WebRTC upgrade')
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

    // Clean up libp2p connections
    await page1.evaluate(async () => window.libp2pNode?.stop()).catch(() => {})
    await page2.evaluate(async () => window.libp2pNode?.stop()).catch(() => {})

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

    // Clean up libp2p connections
    await page1.evaluate(async () => window.libp2pNode?.stop()).catch(() => {})
    await page2.evaluate(async () => window.libp2pNode?.stop()).catch(() => {})

    await context1.close()
    await context2.close()
  })
})

// Separate test suite for late joiner test due to timing/resource conflicts
// TODO: This test is working when running isolated, but fails when running with other tests.
test.describe.skip('Collaborative Spreadsheet - Late Joiner', () => {
  test.setTimeout(process.env.CI ? 300000 : 180000) // 5 min for CI, 3 min for local

  test('late joiner should receive all existing data', async ({ browser }) => {
    // This test specifically validates the fix for late joiners
    // Browser 1 connects, adds data, then Browser 2 connects later and should see everything

    // Give relay server time to recover from previous tests
    console.log('Waiting 3s for relay to stabilize...')
    await new Promise(resolve => setTimeout(resolve, 3000))

    const context1 = await browser.newContext()
    const page1 = await context1.newPage()

    // Enable console logging for debugging
    page1.on('console', msg => console.log('Page1:', msg.text()))

    await page1.goto(url)

    const testTopic = `late-join-test-${Date.now()}`
    await connectToSpreadsheet(page1, testTopic, 'webrtc')

    await page1.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )

    // Browser 1 adds data to multiple cells BEFORE Browser 2 connects
    console.log('Page1: Adding initial data...')
    await page1.locator('#cell-A1').click()
    await page1.locator('#cell-A1').fill('10')
    await page1.locator('#cell-A1').press('Tab')

    await page1.locator('#cell-B1').fill('20')
    await page1.locator('#cell-B1').press('Tab')

    await page1.locator('#cell-C1').fill('=A1+B1')
    await page1.locator('#cell-C1').press('Enter')

    // Wait for formula to calculate
    await page1.waitForFunction(
      () => document.querySelector('#cell-C1')?.value === '30',
      { timeout: 5000 }
    )

    // Add more data in different cells
    await page1.locator('#cell-A2').click()
    await page1.locator('#cell-A2').fill('100')
    await page1.locator('#cell-A2').press('Enter')

    console.log('Page1: Initial data added. Now connecting Page2...')

    // NOW Browser 2 connects (late joiner scenario)
    const context2 = await browser.newContext()
    const page2 = await context2.newPage()

    page2.on('console', msg => console.log('Page2:', msg.text()))

    await page2.goto(url)
    await connectToSpreadsheet(page2, testTopic, 'webrtc')

    await page2.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )

    console.log('Page2: Connected. Waiting for WebRTC and sync...')

    // Wait for WebRTC connections (longer timeout for relay-only connection)
    await waitForWebRTCConnection(page1, 120000) // 2 min for late joiner scenario
    await waitForWebRTCConnection(page2, 120000)

    console.log('WebRTC connections established! Checking if Page2 received all data...')

    // Give more time for Yjs sync to complete (gossipsub + Yjs processing)
    await page2.waitForTimeout(5000)

    // Debug: Check Yjs document state in Page2
    const yjsState = await page2.evaluate(() => {
      const doc = window.spreadsheetUI?.engine?.cells
      if (!doc) { return 'No Yjs doc found' }
      const cells = {}
      for (const [key, value] of doc.entries()) {
        cells[key] = {
          value: value.get('value'),
          formula: value.get('formula')
        }
      }
      return cells
    })
    console.log('Page2 Yjs doc state:', yjsState)

    // Browser 2 should see ALL the data that Browser 1 added
    console.log('Verifying Page2 received all cells...')

    // Check each cell value
    const page2A1 = await page2.locator('#cell-A1').inputValue()
    const page2B1 = await page2.locator('#cell-B1').inputValue()
    const page2C1 = await page2.locator('#cell-C1').inputValue()
    const page2A2 = await page2.locator('#cell-A2').inputValue()

    console.log('Page2 values:', { A1: page2A1, B1: page2B1, C1: page2C1, A2: page2A2 })

    // THE KEY ASSERTIONS - late joiner should have ALL the data
    expect(page2A1).toBe('10')
    expect(page2B1).toBe('20')
    expect(page2C1).toBe('30') // Calculated formula result
    expect(page2A2).toBe('100')

    // Bonus: Verify formula is actually there (click cell to see formula in input)
    await page2.locator('#cell-C1').click()
    await page2.waitForTimeout(500) // Wait for focus handler
    const page2C1WithFormula = await page2.locator('#cell-C1').inputValue()
    expect(page2C1WithFormula).toBe('=A1+B1')

    console.log('✅ Late joiner test passed! All data received.')

    // Explicitly stop libp2p nodes to clean up relay connections
    await page1.evaluate(async () => {
      if (window.libp2pNode) {
        await window.libp2pNode.stop()
      }
    }).catch(() => {}) // Ignore errors if already stopped

    await page2.evaluate(async () => {
      if (window.libp2pNode) {
        await window.libp2pNode.stop()
      }
    }).catch(() => {}) // Ignore errors if already stopped

    await context1.close()
    await context2.close()

    // Give extra time for cleanup
    await new Promise(resolve => setTimeout(resolve, 1000))
  })
})
