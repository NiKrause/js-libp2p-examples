/* eslint-disable no-console */

import { readFileSync } from 'fs'
import path from 'path'
import { test, expect } from '@playwright/test'

const url = 'http://localhost:5173'

// Helper to connect a page to the relay
async function connectToRelay (page, relayMultiaddr, topic = 'test-topic') {
  await page.fill('#relay', relayMultiaddr)
  await page.fill('#topic', topic)
  await page.click('#connect')

  // Wait for connection to establish
  await page.waitForFunction(
    () => document.getElementById('editor').disabled === false,
    { timeout: 10000 }
  )
}

test.describe('Yjs + libp2p example', () => {
  let relayMultiaddr

  test.beforeAll(() => {
    // Load relay multiaddr from global setup
    const relayInfo = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'test/relay-info.json'), 'utf8')
    )
    relayMultiaddr = relayInfo.multiaddr
  })

  test('should load page in two browsers', async ({ browser }) => {
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    await page1.goto(url)
    await page2.goto(url)

    const heading1 = await page1.locator('h1').textContent()
    const heading2 = await page2.locator('h1').textContent()

    expect(heading1).toBe('Yjs + libp2p')
    expect(heading2).toBe('Yjs + libp2p')

    await context1.close()
    await context2.close()
  })

  test('should sync text between two browsers', async ({ browser }) => {
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    // Enable console logging for debugging
    page1.on('console', msg => console.log('Page1:', msg.text()))
    page2.on('console', msg => console.log('Page2:', msg.text()))

    await page1.goto(url)
    await page2.goto(url)

    // Connect both pages to the relay with the same topic
    const testTopic = `test-${Date.now()}`
    await connectToRelay(page1, relayMultiaddr, testTopic)
    await connectToRelay(page2, relayMultiaddr, testTopic)

    // Wait for both to be connected to relay and ready
    // The log shows "Ready!" when connection is established
    await page1.waitForFunction(
      () => document.getElementById('log').textContent.includes('Ready!'),
      { timeout: 10000 }
    )
    await page2.waitForFunction(
      () => document.getElementById('log').textContent.includes('Ready!'),
      { timeout: 10000 }
    )

    // Wait for peers to discover each other via pubsub
    // Even without direct P2P connection, pubsub through relay should work
    // Wait for sync-request/response to complete
    await page1.waitForTimeout(3000)

    // Click into editor and type in page 1
    await page1.click('#editor')
    const testText = 'Hello!'
    await page1.type('#editor', testText)

    // Wait for text to sync to page 2 via pubsub (through relay)
    await page2.waitForFunction(
      (text) => document.getElementById('editor').value.includes(text),
      testText,
      { timeout: 10000 }
    )

    // Verify text synced
    const page2Text = await page2.inputValue('#editor')
    expect(page2Text).toBe(testText)

    // Type additional text in page 2
    await page2.click('#editor')
    const additionalText = ' Bye!'
    await page2.type('#editor', additionalText)

    // Wait for sync back to page 1
    const expectedText = testText + additionalText
    await page1.waitForFunction(
      (text) => document.getElementById('editor').value === text,
      expectedText,
      { timeout: 5000 }
    )

    const page1Text = await page1.inputValue('#editor')
    expect(page1Text).toBe(expectedText)

    await context1.close()
    await context2.close()
  })
})
