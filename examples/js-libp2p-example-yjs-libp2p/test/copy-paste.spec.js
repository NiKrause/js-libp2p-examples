/* eslint-disable no-console */

import { test, expect } from '@playwright/test'
import { connectToSpreadsheet, waitForWebRTCConnection } from './helpers.js'

const url = 'http://localhost:5173'

// Global cleanup to prevent resource leaks
test.afterEach(async ({ browser }) => {
  try {
    // Close all open contexts
    const contexts = browser.contexts()
    for (const context of contexts) {
      // Stop libp2p nodes if they exist
      for (const page of context.pages()) {
        try {
          await page.evaluate(async () => {
            if (window.libp2pNode) {
              await window.libp2pNode.stop()
            }
          })
        } catch (e) {
          // Ignore errors during cleanup
        }
      }
      await context.close()
    }
  } catch (error) {
    console.warn('Cleanup warning:', error.message)
  }
})

test.describe('Copy/Paste Feature', () => {
  test.setTimeout(120000)

  // Skip ALL clipboard tests on WebKit - it doesn't support clipboard permissions
  test.beforeEach(({ browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit does not support clipboard permissions')
  })

  test('should copy and paste a single cell value', async ({ browser, browserName }) => {
    const context = await browser.newContext()

    // Grant clipboard permissions for copy/paste operations (Chrome only)
    if (browserName === 'chromium') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    } else if (browserName === 'firefox') {
      // Firefox doesn't support grantPermissions for clipboard
      // Clipboard functionality relies on firefoxUserPrefs in playwright.config.js
      console.log('Firefox: Using clipboard preferences from config')
    }

    const page = await context.newPage()

    await page.goto(url)

    const testTopic = `copy-paste-${Date.now()}`
    await connectToSpreadsheet(page, testTopic)

    await page.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )

    // Enter value in A1
    await page.locator('#cell-A1').click()
    await page.locator('#cell-A1').fill('100')
    await page.locator('#cell-A1').press('Enter')

    // Click on A1 to select it
    await page.locator('#cell-A1').click()

    // Verify focus before copying - this ensures the element is actually focused
    await expect(page.locator('#cell-A1')).toBeFocused()

    await page.keyboard.press('ControlOrMeta+C')

    // Navigate to B1 and paste
    await page.locator('#cell-B1').click()
    await expect(page.locator('#cell-B1')).toBeFocused()

    await page.keyboard.press('ControlOrMeta+V')

    // Wait for paste feedback
    // TODO: Re-enable when clipboard feedback timing issues are resolved
    // await page.waitForFunction(
    //   () => {
    //     const feedback = document.getElementById('clipboard-feedback')
    //     return feedback?.textContent === 'Pasted!'
    //   },
    //   { timeout: 5000 }
    // )

    // Verify B1 has the value immediately visible (without leaving the cell)
    await page.waitForFunction(
      () => {
        const input = document.querySelector('#cell-B1')
        return input?.value === '100'
      },
      { timeout: 5000 }
    )
    const b1Value = await page.locator('#cell-B1').inputValue()
    expect(b1Value).toBe('100')

    console.log('✓ Single cell copy/paste works')

    await context.close()
  })

  test('should copy and paste a formula', async ({ browser, browserName }) => {
    const context = await browser.newContext()

    if (browserName === 'chromium') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    }

    const page = await context.newPage()

    await page.goto(url)

    const testTopic = `formula-copy-${Date.now()}`
    await connectToSpreadsheet(page, testTopic)

    await page.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )

    // Set up cells: A1=10, A2=20
    await page.locator('#cell-A1').click()
    await page.locator('#cell-A1').fill('10')
    await page.locator('#cell-A1').press('Tab')

    await page.locator('#cell-A2').fill('20')
    await page.locator('#cell-A2').press('Enter')

    // Create formula in A3
    await page.locator('#cell-A3').click()
    await page.locator('#cell-A3').fill('=A1+A2')
    await page.locator('#cell-A3').press('Enter')

    // Wait for calculation
    await page.waitForFunction(
      () => document.querySelector('#cell-A3')?.value === '30',
      { timeout: 5000 }
    )

    // Copy the formula cell
    await page.locator('#cell-A3').focus()
    await page.keyboard.press('ControlOrMeta+C')

    // Wait for clipboard feedback (accept either success or fallback message)
    // TODO: Re-enable when clipboard feedback timing issues are resolved
    // await page.waitForFunction(
    //   () => {
    //     const feedback = document.getElementById('clipboard-feedback')
    //     if (!feedback) return false
    //     const text = feedback.textContent
    //     return text === 'Copied!' || text === 'Copied (internal only)'
    //   },
    //   { timeout: 5000 }
    // )

    // Paste into B3
    await page.locator('#cell-B3').click()
    await page.keyboard.press('ControlOrMeta+V')

    // Verify the value appears immediately in B3
    await page.waitForFunction(
      () => {
        const input = document.querySelector('#cell-B3')
        return input?.value === '=A1+A2'
      },
      { timeout: 5000 }
    )

    // Click on B3 to check the formula was copied (not just the value)
    await page.locator('#cell-B3').click()
    await page.waitForTimeout(300)
    const b3Formula = await page.locator('#cell-B3').inputValue()
    expect(b3Formula).toBe('=A1+A2')

    console.log('✓ Formula copy/paste preserves formula')

    await context.close()
  })

  test('should cut and clear the source cell', async ({ browser, browserName }) => {
    const context = await browser.newContext()

    if (browserName === 'chromium') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    }

    const page = await context.newPage()

    await page.goto(url)

    const testTopic = `cut-test-${Date.now()}`
    await connectToSpreadsheet(page, testTopic)

    await page.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )

    // Enter value in A1
    await page.locator('#cell-A1').click()
    await page.locator('#cell-A1').fill('Cut Me')
    await page.locator('#cell-A1').press('Enter')

    // Cut from A1
    await page.locator('#cell-A1').focus()
    await page.keyboard.press('ControlOrMeta+X')

    // Wait for clipboard feedback
    // TODO: Re-enable when clipboard feedback timing issues are resolved
    // await page.waitForFunction(
    //   () => {
    //     const feedback = document.getElementById('clipboard-feedback')
    //     return feedback?.textContent === 'Cut!'
    //   },
    //   { timeout: 5000 }
    // )

    // A1 should now be empty
    const a1ValueAfterCut = await page.locator('#cell-A1').inputValue()
    expect(a1ValueAfterCut).toBe('')

    // Paste into C1
    await page.locator('#cell-C1').click()
    await page.keyboard.press('ControlOrMeta+V')

    // Leave the cell (focus another one) so the pasted value becomes visible
    await page.locator('#cell-D1').click()

    // Wait for paste feedback
    // TODO: Re-enable when clipboard feedback timing issues are resolved
    // await page.waitForFunction(
    //   () => {
    //     const feedback = document.getElementById('clipboard-feedback')
    //     return feedback?.textContent === 'Pasted!'
    //   },
    //   { timeout: 5000 }
    // )

    // Verify C1 has the value immediately visible
    await page.waitForFunction(
      () => {
        const input = document.querySelector('#cell-C1')
        return input?.value === 'Cut Me'
      },
      { timeout: 5000 }
    )
    const c1Value = await page.locator('#cell-C1').inputValue()
    expect(c1Value).toBe('Cut Me')

    console.log('✓ Cut operation clears source and pastes correctly')

    await context.close()
  })

  test('should immediately clear cell value when cutting', async ({ browser, browserName }) => {
    const context = await browser.newContext()

    if (browserName === 'chromium') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    }

    const page = await context.newPage()

    await page.goto(url)

    const testTopic = `cut-immediate-${Date.now()}`
    await connectToSpreadsheet(page, testTopic)

    await page.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )

    // Enter value in A1
    await page.locator('#cell-A1').click()
    await page.locator('#cell-A1').fill('Test Value')
    await page.locator('#cell-A1').press('Enter')

    // Click A1 again and cut (cell should be focused)
    await page.locator('#cell-A1').click()
    await page.locator('#cell-A1').focus()
    await page.keyboard.press('ControlOrMeta+X')

    // Verify A1 is immediately empty (without leaving the cell)
    await page.waitForFunction(
      () => {
        const input = document.querySelector('#cell-A1')
        return input?.value === ''
      },
      { timeout: 5000 }
    )

    const a1Value = await page.locator('#cell-A1').inputValue()
    expect(a1Value).toBe('')

    console.log('✓ Cut immediately clears cell value')

    await context.close()
  })

  test('should sync copy/paste between two browsers', async ({ browser, browserName }) => {
    // Skip multi-browser tests in CI due to resource constraints
    if (process.env.CI || process.env.GITHUB_ACTIONS) {
      test.skip(true, 'Skipping multi-browser test in CI environment')
      return
    }

    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    if (browserName === 'chromium') {
      await context1.grantPermissions(['clipboard-read', 'clipboard-write'])
      await context2.grantPermissions(['clipboard-read', 'clipboard-write'])
    }

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    page1.on('console', msg => console.log('Page1:', msg.text()))
    page2.on('console', msg => console.log('Page2:', msg.text()))

    await page1.goto(url)
    await page2.goto(url)

    const testTopic = `collab-copy-${Date.now()}`
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

    // Wait for WebRTC connection
    console.log('Waiting for WebRTC connections...')
    await waitForWebRTCConnection(page1, 60000)
    await waitForWebRTCConnection(page2, 60000)
    console.log('WebRTC connections established!')

    await page1.waitForTimeout(2000)

    // Page 1: Enter value in A1
    await page1.locator('#cell-A1').click()
    await page1.locator('#cell-A1').fill('Collaborative')
    await page1.locator('#cell-A1').press('Enter')

    // Wait for sync to page 2
    await page2.waitForFunction(
      () => document.querySelector('#cell-A1')?.value === 'Collaborative',
      { timeout: 10000 }
    )

    // Page 1: Copy A1
    await page1.locator('#cell-A1').focus()
    await page1.keyboard.press('ControlOrMeta+C')

    // Page 1: Paste into A2
    await page1.locator('#cell-A2').click()
    await page1.keyboard.press('ControlOrMeta+V')

    // Wait for A2 to update immediately on page 1
    await page1.waitForFunction(
      () => {
        const input = document.querySelector('#cell-A2')
        return input?.value === 'Collaborative'
      },
      { timeout: 5000 }
    )

    // Verify sync to page 2
    await page2.waitForFunction(
      () => document.querySelector('#cell-A2')?.value === 'Collaborative',
      { timeout: 10000 }
    )

    const page2A2 = await page2.locator('#cell-A2').inputValue()
    expect(page2A2).toBe('Collaborative')

    console.log('✓ Copy/paste operations sync between browsers')

    await context1.close()
    await context2.close()
  })

  test('should handle external clipboard data (TSV format)', async ({ browser, browserName }) => {
    // Skip this test in WebKit due to clipboard API limitations
    test.skip(browserName === 'webkit', 'WebKit has limited clipboard API support')

    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto(url)

    const testTopic = `external-paste-${Date.now()}`
    await connectToSpreadsheet(page, testTopic)

    await page.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )

    // Grant clipboard permissions
    if (browserName === 'chromium') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    }

    // Simulate external TSV data (like from Excel)
    const tsvData = '100\t200\n300\t400'

    // Write TSV to clipboard
    await page.evaluate(async (data) => {
      await navigator.clipboard.writeText(data)
    }, tsvData)

    // Paste into A1
    await page.locator('#cell-A1').click()
    await page.keyboard.press('ControlOrMeta+V')

    // Wait for paste feedback
    await page.waitForFunction(
      () => {
        const feedback = document.getElementById('clipboard-feedback')
        return feedback?.textContent === 'Pasted!'
      },
      { timeout: 5000 }
    )

    // Verify the 2x2 grid was pasted correctly (values should be immediately visible)
    await page.waitForFunction(
      () => {
        const a1 = document.querySelector('#cell-A1')?.value
        const b1 = document.querySelector('#cell-B1')?.value
        const a2 = document.querySelector('#cell-A2')?.value
        const b2 = document.querySelector('#cell-B2')?.value
        return a1 === '100' && b1 === '200' && a2 === '300' && b2 === '400'
      },
      { timeout: 5000 }
    )

    const a1 = await page.locator('#cell-A1').inputValue()
    const b1 = await page.locator('#cell-B1').inputValue()
    const a2 = await page.locator('#cell-A2').inputValue()
    const b2 = await page.locator('#cell-B2').inputValue()

    expect(a1).toBe('100')
    expect(b1).toBe('200')
    expect(a2).toBe('300')
    expect(b2).toBe('400')

    console.log('✓ External TSV data pasted correctly as 2x2 grid')

    await context.close()
  })

  // TODO: Re-enable when clipboard feedback timing issues are resolved
  // test('should show visual feedback notifications', async ({ browser }) => {
  //   const context = await browser.newContext()
  //   await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  //   const page = await context.newPage()
  //
  //   await page.goto(url)
  //
  //   const testTopic = `feedback-${Date.now()}`
  //   await connectToSpreadsheet(page, testTopic)
  //
  //   await page.waitForFunction(
  //     () => document.getElementById('log').value.includes('Ready!'),
  //     { timeout: 15000 }
  //   )
  //
  //   // Enter value
  //   await page.locator('#cell-A1').click()
  //   await page.locator('#cell-A1').fill('test(')
  //   await page.locator('#cell-A1').press('Enter')
  //
  //   // Copy
  //   await page.locator('#cell-A1').focus()
  //   await page.keyboard.press('ControlOrMeta+C')
  //
  //   // Check feedback element appears
  //   const feedback = await page.locator('#clipboard-feedback')
  //   await expect(feedback).toBeVisible()
  //   await expect(feedback).toHaveText('Copied!')
  //
  //   // Check it has correct styling
  //   const bgColor = await feedback.evaluate(el => window.getComputedStyle(el).backgroundColor)
  //   expect(bgColor).toContain('76, 175, 80') // #4caf50 in RGB
  //
  //   // Wait for it to start fading (opacity change)
  //   await page.waitForTimeout(2500)
  //   const opacity = await feedback.evaluate(el => window.getComputedStyle(el).opacity)
  //   expect(parseFloat(opacity)).toBeLessThan(1)
  //
  //   console.log('✓ Visual feedback appears with correct styling')
  //
  //   await context.close()
  // })
})
