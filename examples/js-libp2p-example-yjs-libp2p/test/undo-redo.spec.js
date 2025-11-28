/* eslint-disable no-console */

import { test, expect } from '@playwright/test'
import { connectToSpreadsheet, waitForWebRTCConnection } from './helpers.js'

const url = 'http://localhost:5173'

test.describe.skip('undo/redo feature', () => {
  test.setTimeout(120000)

  test('should undo and redo a single cell value change', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto(url)

    const testTopic = `undo-test-${Date.now()}`
    await connectToSpreadsheet(page, testTopic)

    await page.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )

    // Enter value in A1
    await page.locator('#cell-A1').click()
    await page.locator('#cell-A1').fill('Original')
    await page.locator('#cell-A1').press('Enter')

    // Verify value is set
    let a1Value = await page.locator('#cell-A1').inputValue()
    expect(a1Value).toBe('Original')
    console.log('✓ Initial value set: Original')

    // Click on A1 and undo
    await page.locator('#cell-A1').click()
    await page.keyboard.press('ControlOrMeta+Z')

    // Wait for undo feedback
    await page.waitForFunction(
      () => document.getElementById('clipboard-feedback')?.textContent === 'Undo',
      { timeout: 2000 }
    )

    // A1 should be empty after undo
    await page.waitForTimeout(500)
    a1Value = await page.locator('#cell-A1').inputValue()
    expect(a1Value).toBe('')
    console.log('✓ After undo: cell is empty')

    // Redo
    await page.keyboard.press('ControlOrMeta+Y')

    // Wait for redo feedback
    await page.waitForFunction(
      () => document.getElementById('clipboard-feedback')?.textContent === 'Redo',
      { timeout: 2000 }
    )

    // A1 should have the value again
    await page.waitForTimeout(500)
    a1Value = await page.locator('#cell-A1').inputValue()
    expect(a1Value).toBe('Original')
    console.log('✓ After redo: value restored')

    await context.close()
  })

  test('should undo multiple changes in order', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto(url)

    const testTopic = `multi-undo-${Date.now()}`
    await connectToSpreadsheet(page, testTopic)

    await page.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )

    // Make three changes
    await page.locator('#cell-A1').click()
    await page.locator('#cell-A1').fill('First')
    await page.locator('#cell-A1').press('Enter')
    await page.waitForTimeout(600) // Wait for undo capture timeout

    await page.locator('#cell-A2').click()
    await page.locator('#cell-A2').fill('Second')
    await page.locator('#cell-A2').press('Enter')
    await page.waitForTimeout(600)

    await page.locator('#cell-A3').click()
    await page.locator('#cell-A3').fill('Third')
    await page.locator('#cell-A3').press('Enter')
    await page.waitForTimeout(600)

    console.log('✓ Three values entered')

    // Undo once - should remove 'Third'
    await page.locator('#cell-A3').click()
    await page.keyboard.press('ControlOrMeta+Z')
    await page.waitForTimeout(500)

    let a3Value = await page.locator('#cell-A3').inputValue()
    expect(a3Value).toBe('')
    console.log('✓ First undo: A3 is empty')

    // Undo again - should remove 'Second'
    await page.keyboard.press('ControlOrMeta+Z')
    await page.waitForTimeout(500)

    let a2Value = await page.locator('#cell-A2').inputValue()
    expect(a2Value).toBe('')
    console.log('✓ Second undo: A2 is empty')

    // Undo again - should remove 'First'
    await page.keyboard.press('ControlOrMeta+Z')
    await page.waitForTimeout(500)

    let a1Value = await page.locator('#cell-A1').inputValue()
    expect(a1Value).toBe('')
    console.log('✓ Third undo: A1 is empty')

    // Redo all three
    await page.keyboard.press('ControlOrMeta+Y')
    await page.waitForTimeout(500)
    a1Value = await page.locator('#cell-A1').inputValue()
    expect(a1Value).toBe('First')
    console.log('✓ First redo: A1 restored')

    await page.keyboard.press('ControlOrMeta+Y')
    await page.waitForTimeout(500)
    a2Value = await page.locator('#cell-A2').inputValue()
    expect(a2Value).toBe('Second')
    console.log('✓ Second redo: A2 restored')

    await page.keyboard.press('ControlOrMeta+Y')
    await page.waitForTimeout(500)
    a3Value = await page.locator('#cell-A3').inputValue()
    expect(a3Value).toBe('Third')
    console.log('✓ Third redo: A3 restored')

    await context.close()
  })

  test('should undo and redo formula changes', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto(url)

    const testTopic = `formula-undo-${Date.now()}`
    await connectToSpreadsheet(page, testTopic)

    await page.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )

    // Set up: A1=10, A2=20
    await page.locator('#cell-A1').click()
    await page.locator('#cell-A1').fill('10')
    await page.locator('#cell-A1').press('Tab')
    await page.waitForTimeout(600)

    await page.locator('#cell-A2').fill('20')
    await page.locator('#cell-A2').press('Enter')
    await page.waitForTimeout(600)

    // Create formula in A3
    await page.locator('#cell-A3').click()
    await page.locator('#cell-A3').fill('=A1+A2')
    await page.locator('#cell-A3').press('Enter')

    // Wait for formula calculation
    await page.waitForFunction(
      () => document.querySelector('#cell-A3')?.value === '30',
      { timeout: 5000 }
    )
    console.log('✓ Formula calculated: 30')

    // Undo formula
    await page.locator('#cell-A3').click()
    await page.keyboard.press('ControlOrMeta+Z')
    await page.waitForTimeout(500)

    // A3 should be empty
    const a3Value = await page.locator('#cell-A3').inputValue()
    expect(a3Value).toBe('')
    console.log('✓ Formula undone: A3 is empty')

    // Redo formula
    await page.keyboard.press('ControlOrMeta+Y')
    await page.waitForTimeout(500)

    // Formula should be back and calculated
    await page.waitForFunction(
      () => document.querySelector('#cell-A3')?.value === '30',
      { timeout: 5000 }
    )
    console.log('✓ Formula redone: A3 = 30')

    // Click to check formula
    await page.locator('#cell-A3').click()
    await page.waitForTimeout(300)
    const a3Formula = await page.locator('#cell-A3').inputValue()
    expect(a3Formula).toBe('=A1+A2')
    console.log('✓ Formula preserved: =A1+A2')

    await context.close()
  })

  test('should show "Nothing to undo" when history is empty', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto(url)

    const testTopic = `empty-undo-${Date.now()}`
    await connectToSpreadsheet(page, testTopic)

    await page.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )

    // Try to undo with no changes
    await page.locator('#cell-A1').click()
    await page.keyboard.press('ControlOrMeta+Z')

    // Should show "Nothing to undo"
    await page.waitForFunction(
      () => document.getElementById('clipboard-feedback')?.textContent === 'Nothing to undo',
      { timeout: 2000 }
    )
    console.log('✓ Shows "Nothing to undo" feedback')

    await context.close()
  })

  test('should work with Ctrl+Shift+Z for redo', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto(url)

    const testTopic = `shift-redo-${Date.now()}`
    await connectToSpreadsheet(page, testTopic)

    await page.waitForFunction(
      () => document.getElementById('log').value.includes('Ready!'),
      { timeout: 15000 }
    )

    // Enter value
    await page.locator('#cell-A1').click()
    await page.locator('#cell-A1').fill('Test')
    await page.locator('#cell-A1').press('Enter')

    // Undo
    await page.locator('#cell-A1').click()
    await page.keyboard.press('ControlOrMeta+Z')
    await page.waitForTimeout(500)

    // Redo with Shift+Z
    await page.keyboard.press('ControlOrMeta+Shift+Z')

    await page.waitForFunction(
      () => document.getElementById('clipboard-feedback')?.textContent === 'Redo',
      { timeout: 2000 }
    )

    await page.waitForTimeout(500)
    const a1Value = await page.locator('#cell-A1').inputValue()
    expect(a1Value).toBe('Test')
    console.log('✓ Ctrl+Shift+Z works for redo')

    await context.close()
  })

  test('should sync changes but not undo/redo history between browsers', async ({ browser }) => {
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    page1.on('console', msg => console.log('Page1:', msg.text()))
    page2.on('console', msg => console.log('Page2:', msg.text()))

    await page1.goto(url)
    await page2.goto(url)

    const testTopic = `collab-undo-${Date.now()}`
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

    // Page 1: Enter value
    await page1.locator('#cell-A1').click()
    await page1.locator('#cell-A1').fill('From Page 1')
    await page1.locator('#cell-A1').press('Enter')

    // Wait for sync to page 2
    await page2.waitForFunction(
      () => document.querySelector('#cell-A1')?.value === 'From Page 1',
      { timeout: 10000 }
    )
    console.log('✓ Value synced to Page 2')

    // Page 1: Undo
    await page1.locator('#cell-A1').click()
    await page1.keyboard.press('ControlOrMeta+Z')
    await page1.waitForTimeout(500)

    // Page 1 should have empty A1
    const page1A1 = await page1.locator('#cell-A1').inputValue()
    expect(page1A1).toBe('')
    console.log('✓ Page 1: Undo worked, A1 is empty')

    // Page 2 should also sync to empty (undo is a change that gets synced)
    await page2.waitForFunction(
      () => document.querySelector('#cell-A1')?.value === '',
      { timeout: 10000 }
    )
    const page2A1 = await page2.locator('#cell-A1').inputValue()
    expect(page2A1).toBe('')
    console.log('✓ Page 2: Undo synced, A1 is empty')

    // Page 2: Try to undo (should show "Nothing to undo" because it wasn't Page 2's change)
    await page2.locator('#cell-A1').click()
    await page2.keyboard.press('ControlOrMeta+Z')

    // Should show "Nothing to undo" on Page 2
    await page2.waitForFunction(
      () => document.getElementById('clipboard-feedback')?.textContent === 'Nothing to undo',
      { timeout: 2000 }
    )
    console.log('✓ Page 2: Cannot undo Page 1\'s changes (separate history)')

    await context1.close()
    await context2.close()
  })
})
