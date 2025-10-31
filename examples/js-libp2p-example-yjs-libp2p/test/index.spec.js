/* eslint-disable no-console */

import { test, expect } from '@playwright/test'

const url = 'http://localhost:5173'

// Helper to connect a page to the spreadsheet
async function connectToSpreadsheet (page, topic = 'test-topic') {
  await page.fill('#topic', topic)
  await page.click('#connect')

  // Wait for spreadsheet to appear and be ready
  await page.waitForFunction(
    () => document.getElementById('spreadsheet').style.display !== 'none' &&
          document.getElementById('formula-input').disabled === false,
    { timeout: 15000 }
  )
}

test.describe('Collaborative Spreadsheet - Yjs + libp2p', () => {
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
      () => document.getElementById('log').textContent.includes('Ready!'),
      { timeout: 15000 }
    )
    await page2.waitForFunction(
      () => document.getElementById('log').textContent.includes('Ready!'),
      { timeout: 15000 }
    )

    // Wait for peer discovery and connection (can take up to 30 seconds)
    await page1.waitForFunction(
      () => document.querySelector('#peer-count')?.textContent === '2',
      { timeout: 35000 }
    )
    await page2.waitForFunction(
      () => document.querySelector('#peer-count')?.textContent === '2',
      { timeout: 35000 }
    )
    
    // Give Yjs extra time to fully sync
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
      () => document.getElementById('log').textContent.includes('Ready!'),
      { timeout: 15000 }
    )
    await page2.waitForFunction(
      () => document.getElementById('log').textContent.includes('Ready!'),
      { timeout: 15000 }
    )

    // Wait for peer discovery and connection (can take up to 30 seconds)
    await page1.waitForFunction(
      () => document.querySelector('#peer-count')?.textContent === '2',
      { timeout: 35000 }
    )
    await page2.waitForFunction(
      () => document.querySelector('#peer-count')?.textContent === '2',
      { timeout: 35000 }
    )
    
    // Give Yjs extra time to fully sync
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
