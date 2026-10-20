/* eslint-disable no-console */
// The spreadsheet demo, recorded: two browsers share a sheet over libp2p
// through the suite's own relay; one freezes it as a snapshot — a block on
// Helia, addressed by its CID — and the other lists it over UCEP, fetches it
// over Bitswap, is refused `restore` until it has paired, pairs with an
// invitation, and puts the sheet back. Nothing leaves the machine. The
// captions are baked into the recording (captions.js); the pauses are for
// the viewer. The connection takes a while on a laptop; timing.json tells
// compose.sh where the action starts, so the wait is cut.
import { writeFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { pageUrl, connectToSpreadsheet, waitForPeerConnection } from '../test/helpers.js'
import { installCaptions, say } from './captions.js'

const SIZE = { width: 960, height: 720 }

const RESULT_STYLE = {
  position: 'fixed',
  top: '12px',
  right: '12px',
  maxWidth: '46%',
  maxHeight: '58%',
  overflow: 'hidden',
  padding: '12px 14px',
  background: 'rgba(255, 251, 235, 0.97)',
  border: '2px solid #d97706',
  borderRadius: '10px',
  color: '#1f2937',
  font: '13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  zIndex: '2147483646',
  pointerEvents: 'none',
  boxShadow: '0 6px 24px rgba(0,0,0,0.18)'
}

/**
 * A box on the page with what a call answered, as the viewer's console.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} title
 * @param {unknown} value - `null` removes the box
 */
async function show (page, title, value) {
  await page.evaluate(({ title, text, style }) => {
    let box = document.getElementById('demo-result')
    if (text === null) { box?.remove(); return }
    if (!box) {
      box = document.createElement('pre')
      box.id = 'demo-result'
      Object.assign(box.style, style)
      document.body.appendChild(box)
    }
    box.textContent = `${title}\n${text}`
  }, { title, text: value === null ? null : JSON.stringify(value, null, 2), style: RESULT_STYLE })
}

/**
 * @param {import('@playwright/test').Page} page - @param {string} coord @param {string} value
 * @param coord
 * @param value
 */
async function type (page, coord, value) {
  const cell = page.locator(`#cell-${coord}`)
  await cell.click()
  await page.waitForTimeout(350)
  await cell.fill(value)
  await page.waitForTimeout(250)
  await cell.press('Enter')
}

const cellValue = (page, coord) => page.evaluate((c) => window.sheet.engine.getCell(c).value, coord)
const isConnectedTo = (page, peer) =>
  page.evaluate((p) => window.libp2pNode.getPeers().some((id) => id.toString() === p), peer)

test('the sheet, a snapshot by CID, and a peer that restores it after pairing', async ({ browser }, testInfo) => {
  const started = Date.now()
  const a = await browser.newContext({ viewport: SIZE, recordVideo: { dir: testInfo.outputPath('a'), size: SIZE } })
  const b = await browser.newContext({ viewport: SIZE, recordVideo: { dir: testInfo.outputPath('b'), size: SIZE } })
  await installCaptions(a)
  await installCaptions(b)
  const A = await a.newPage()
  const B = await b.newPage()
  try {
    const topic = `demo-${Date.now()}`
    await A.goto(pageUrl(topic))
    await B.goto(pageUrl(topic))
    await connectToSpreadsheet(A, topic)
    await connectToSpreadsheet(B, topic)
    await say(A, 'A spreadsheet in the browser: a Yjs CRDT, replicated over libp2p. No server holds the document.', 0)
    await say(B, 'A second browser on the same topic, finding the first through a relay.', 0)
    await waitForPeerConnection(A, 240_000)
    await waitForPeerConnection(B, 240_000)
    const peerA = await A.evaluate(() => window.libp2pNode.peerId.toString())
    await expect.poll(() => isConnectedTo(B, peerA), { timeout: 120_000 }).toBe(true)
    const connectedAt = (Date.now() - started) / 1000
    writeFileSync(testInfo.outputPath('timing.json'), JSON.stringify({ connectedAt }))
    const transports = await B.evaluate((p) =>
      window.libp2pNode.getConnections().filter((c) => c.remotePeer.toString() === p).map((c) => c.remoteAddr.toString()), peerA)
    console.log('connected after', connectedAt, 's; transports:', transports)
    const direct = transports.some((t) => t.includes('/webrtc') && !t.includes('/p2p-circuit'))
    await say(A, 'Connected. The other browser is a peer, not a client.', 4000)
    await say(B, direct ? 'Connected: through the relay first, then directly over WebRTC.' : 'Connected through the relay.', 4000)

    // A types; B sees it.
    await say(A, 'Cells typed here …', 1280)
    await type(A, 'A1', 'Q1')
    await type(A, 'B1', '1200')
    await type(A, 'A2', 'Q2')
    await type(A, 'B2', '1500')
    await type(A, 'A3', 'Total')
    await type(A, 'B3', '=B1+B2')
    await expect.poll(() => cellValue(B, 'B3'), { timeout: 30_000 }).toBe(2700)
    await say(B, '… appear here, cell by cell, as CRDT updates over gossipsub.', 5600)
    await say(A, 'Every edit is an update every peer receives; there is no "save".', 3000)

    // A snapshot: the sheet frozen as a block, addressed by its CID.
    await say(A, 'Snapshot: the sheet frozen as one block on Helia, addressed by its CID.', 2400)
    await A.click('#snapshot-btn')
    await expect(A.locator('#snapshot-list .snapshot')).toHaveCount(1)
    const entry = await A.evaluate(() => window.sheet.snapshots.entries()[0])
    await show(A, 'snapshot', { cid: entry.cid, bytes: entry.bytes, cells: entry.cells })

    await say(A, `A CID for this moment of the sheet: ${entry.cid.slice(0, 38)}…`, 4000)
    await expect(B.locator('#snapshot-list .snapshot')).toHaveCount(1, { timeout: 30_000 })
    await say(B, 'The list of snapshots lives in the document, so it replicates like a cell.', 4800)

    // B asks over UCEP, as any app would.
    await say(B, 'Any libp2p app can ask the sheet over UCEP, discovered through identify: "snapshots".', 2400)
    const listed = await B.evaluate(([peer, t]) => window.testExtension(peer, 'snapshots', { topic: t }), [peerA, topic])
    await show(B, `ucep → ${peerA.slice(-8)}: snapshots`, { ...listed, snapshots: listed.snapshots.map((x) => ({ cid: x.cid, bytes: x.bytes, sha256: `${x.sha256.slice(0, 16)}…`, cells: x.cells, at: x.at })) })
    await say(B, 'The answer: the CIDs this sheet froze itself into.', 6400)

    // The sheet moves on.
    await show(A, '', null)
    await say(A, 'The sheet moves on: Q2 is corrected …', 1280)
    await type(A, 'B2', '1800')
    await expect.poll(() => cellValue(B, 'B3'), { timeout: 30_000 }).toBe(3000)
    await say(B, '… and the total follows. The snapshot does not: it is a block.', 5600)

    // B does not hold the block: Bitswap from A, verified against the CID.
    await say(B, '"peek": this browser never had the block. It comes over Bitswap from the other, and is verified against the CID.', 2400)
    const peeked = await B.evaluate((cid) => window.sheet.snapshots.peek(cid), entry.cid)
    await show(B, `peek ${entry.cid.slice(0, 16)}…`, {
      bytes: peeked.bytes,
      verified: 'sha2-256 matches the CID',
      cells: Object.fromEntries(Object.entries(peeked.cells).map(([k, v]) => [k, v.formula ?? v.value]))
    })
    await say(B, 'Fetched and verified: the cells as they were, Total 2700.', 7200)

    // Restore rewrites the sheet: refused without the scope.
    await say(B, '"restore" rewrites the sheet, so it needs a scope. Without pairing …', 2400)
    let refusal = ''
    try {
      await B.evaluate(([peer, t, cid]) => window.testExtension(peer, 'restore', { topic: t, cid }), [peerA, topic, entry.cid])
    } catch (e) { refusal = String(e.message) }
    expect(refusal).toMatch(/PAIRING_REQUIRED/)
    await show(B, `ucep → ${peerA.slice(-8)}: restore`, { error: 'PAIRING_REQUIRED', scope: 'sheet:cells:write' })
    await say(B, '… refused: PAIRING_REQUIRED. The sheet decides who may rewrite it.', 6400)

    // An invitation from A; B pairs and restores.
    await say(A, 'The sheet hands out an invitation for the scope "sheet:cells:write".', 2400)
    const invitation = await A.evaluate(() => window.sheet.extension.provider.createInvitation({ scopes: ['sheet:cells:write'] }))
    await show(A, 'invitation', { scopes: ['sheet:cells:write'], uri: `${invitation.uri.slice(0, 48)}…` })
    await say(A, 'An invitation is a URI; shown to the other side, or sent in band.', 3500)
    await B.evaluate((uri) => window.sheet.consumer.pairWithInvitation(uri), invitation.uri)
    await say(B, 'Paired with the invitation. Now: restore.', 3200)
    const restored = await B.evaluate(([peer, t, cid]) => window.testExtension(peer, 'restore', { topic: t, cid }), [peerA, topic, entry.cid])
    await show(B, `ucep → ${peerA.slice(-8)}: restore`, { ...restored, cid: `${restored.cid.slice(0, 20)}…` })
    await expect.poll(() => cellValue(A, 'B3'), { timeout: 30_000 }).toBe(2700)
    await expect.poll(() => cellValue(B, 'B3'), { timeout: 30_000 }).toBe(2700)
    await say(A, 'Restored from the CID: Q2 is 1500 again, on both browsers — written as edits every peer receives.', 8000)
    await say(B, 'A CRDT has no "undo to a version". A snapshot gives it one: content-addressed, verifiable, restorable.', 8000)
    await show(A, '', null)
    await show(B, '', null)
    await say(A, 'P2P Spreadsheet + UCEP — github.com/Le-Space/ucep-spec', 4800)
    await say(B, 'P2P Spreadsheet + UCEP — github.com/Le-Space/ucep-spec', 4800)
  } finally {
    await a.close()
    await b.close()
  }
})
