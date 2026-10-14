/* eslint-disable no-console */

// A snapshot is a CID: the sheet frozen as a block. Another peer learns the
// CID over UCEP, fetches the block over Bitswap on the connection it already
// has, verifies it against the CID — and may put the sheet back to it once it
// has paired for the scope that rewrites cells.
import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { connectToSpreadsheet, waitForPeerConnection } from './helpers.js'

const url = `http://127.0.0.1:${process.env.E2E_PORT || 5174}`

/**
 * The suite's own relay (test/global-setup.js) and the sheet, handed to the app by URL.
 *
 * @param topic
 */
const pageUrl = (topic) => `${url}/?relay=${encodeURIComponent(JSON.parse(readFileSync('test/relay-info.json', 'utf8')).multiaddr)}&topic=${encodeURIComponent(topic)}`

/**
 * Whether `page` holds a libp2p connection to the peer with id `peer`.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} peer
 */
const isConnectedTo = (page, peer) =>
  page.evaluate((p) => window.libp2pNode.getPeers().some((id) => id.toString() === p), peer)

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} coord
 */
const cellValue = (page, coord) =>
  page.evaluate((c) => window.sheet.engine.getCell(c).value, coord)

test.describe('Snapshots as CIDs over UCEP', () => {
  // Two browsers find each other through the relay's pubsub, then upgrade;
  // on a laptop that takes a minute or two.
  test.setTimeout(480_000)

  test('a peer fetches a snapshot by CID, verifies it, and restores the sheet after pairing', async ({ browser }) => {
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()
    const page1 = await context1.newPage()
    const page2 = await context2.newPage()
    page1.on('console', (msg) => { if (msg.type() === 'error') { console.log('Page1:', msg.text()) } })
    page2.on('console', (msg) => { if (msg.type() === 'error') { console.log('Page2:', msg.text()) } })

    try {
      const topic = `snap-${Date.now()}`
      await page1.goto(pageUrl(topic))
      await page2.goto(pageUrl(topic))
      await connectToSpreadsheet(page1, topic)
      await connectToSpreadsheet(page2, topic)
      await waitForPeerConnection(page1, 180_000)
      await waitForPeerConnection(page2, 180_000)
      const peer1 = await page1.evaluate(() => window.libp2pNode.peerId.toString())
      // Not just "some peer": page 2 is connected to page 1 itself.
      await expect.poll(() => isConnectedTo(page2, peer1), { timeout: 120_000 }).toBe(true)
      console.log('both pages connected; transports:', await page2.evaluate((p) =>
        window.libp2pNode.getConnections().filter((c) => c.remotePeer.toString() === p).map((c) => c.remoteAddr.toString()), peer1))

      // Page 1 writes; page 2 sees it.
      await page1.evaluate(() => {
        window.sheet.engine.setCell('A1', 42)
        window.sheet.engine.setCell('A2', '=A1*2')
      })
      await expect.poll(() => cellValue(page2, 'A2'), { timeout: 30_000 }).toBe(84)

      // Page 1 takes a snapshot with the button: an entry with a CID.
      await page1.click('#snapshot-btn')
      await expect(page1.locator('#snapshot-list .snapshot')).toHaveCount(1)
      const entry = await page1.evaluate(() => window.sheet.snapshots.entries()[0])
      expect(entry.cid).toMatch(/^bafkrei/)
      expect(entry.cells).toBe(2)

      // The list replicates with the sheet: page 2 shows the same entry …
      await expect(page2.locator('#snapshot-list .snapshot')).toHaveCount(1, { timeout: 30_000 })
      // … and asks page 1 over UCEP, as any app would.
      const listed = await page2.evaluate(
        ([peer, t]) => window.testExtension(peer, 'snapshots', { topic: t }),
        [peer1, topic]
      )
      expect(listed.snapshots.map((s) => s.cid)).toEqual([entry.cid])

      // The sheet moves on.
      await page1.evaluate(() => window.sheet.engine.setCell('A1', 7))
      await expect.poll(() => cellValue(page2, 'A2'), { timeout: 30_000 }).toBe(14)

      // Page 2 does not hold the block: it comes over Bitswap from page 1, and
      // is checked against the CID before anything is read from it.
      const peeked = await page2.evaluate((cid) => window.sheet.snapshots.peek(cid), entry.cid)
      expect(peeked.cells.A1.value).toBe(42)
      expect(peeked.cells.A2.formula).toBe('=A1*2')
      expect(peeked.bytes).toBe(entry.bytes)

      // Restoring rewrites the sheet, so it needs the scope: without pairing, refused.
      await expect(
        page2.evaluate(([peer, t, cid]) => window.testExtension(peer, 'restore', { topic: t, cid }), [peer1, topic, entry.cid])
      ).rejects.toThrow(/PAIRING_REQUIRED/)

      // Page 1 hands out an invitation for the scope; page 2 pairs with it.
      const invitation = await page1.evaluate(() =>
        window.sheet.extension.provider.createInvitation({ scopes: ['sheet:cells:write'] })
      )
      await page2.evaluate((uri) => window.sheet.consumer.pairWithInvitation(uri), invitation.uri)
      const restored = await page2.evaluate(
        ([peer, t, cid]) => window.testExtension(peer, 'restore', { topic: t, cid }),
        [peer1, topic, entry.cid]
      )
      expect(restored.cells).toBe(2)

      // The sheet is back to the snapshot — on both.
      await expect.poll(() => cellValue(page1, 'A1')).toBe(42)
      await expect.poll(() => cellValue(page2, 'A2'), { timeout: 30_000 }).toBe(84)
    } finally {
      await context1.close()
      await context2.close()
    }
  })
})
