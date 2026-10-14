import { withBitswap } from '@helia/bitswap'
import { withLibp2p } from '@helia/libp2p'
import { MemoryBlockstore } from 'blockstore-core'
import { MemoryDatastore } from 'datastore-core'
import { createHeliaLight } from 'helia'
import { CID } from 'multiformats/cid'
import * as raw from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'
import { toString as bytesToString } from 'uint8arrays'
import * as Y from 'yjs'

/**
 * Snapshots: the sheet frozen at a moment, addressed by its content.
 *
 * Yjs is the living document — every browser holds a copy, edits merge, and
 * there is only ever "now". A snapshot is the opposite: the document's state
 * as one block of bytes, and the block's hash as its address (a CID). Anyone
 * who has the CID can fetch the bytes from any peer that holds them, check
 * them against the CID, and know they are looking at exactly this version.
 *
 * The blocks live in a Helia node on top of the sheet's own libp2p node, so a
 * peer fetches a snapshot it does not have over Bitswap, on the connection it
 * already has. The list of snapshots lives in the Yjs document itself, so it
 * replicates with the sheet; the blocks do not — they travel on request.
 */

/**
 * @param {object} init
 * @param {import('libp2p').Libp2p} init.libp2p - the sheet's node
 * @param {Y.Doc} init.doc - the sheet's document
 * @param {import('./spreadsheet-engine.js').SpreadsheetEngine} init.engine
 * @param {string} init.topic
 */
export async function startSnapshots ({ libp2p, doc, engine, topic }) {
  const helia = await withBitswap(
    withLibp2p(
      createHeliaLight({ blockstore: new MemoryBlockstore(), datastore: new MemoryDatastore() }),
      libp2p
    ),
    {
      // Two browsers usually only share a relayed ("limited") connection, and
      // Bitswap refuses those by default — so a peer that had not managed the
      // WebRTC upgrade could not fetch a snapshot at all (seen as
      // LoadBlockFailedError in CI). A snapshot is a few KB; the relay's data
      // limit is not a concern for it.
      runOnLimitedConnections: true
    }
  ).start()
  const list = doc.getArray('snapshots')

  /**
   * The CID a block of bytes has: raw codec, sha2-256.
   *
   * @param bytes
   */
  async function address (bytes) {
    const digest = await sha256.digest(bytes)
    return { cid: CID.createV1(raw.code, digest), sha256: bytesToString(digest.digest, 'base16') }
  }

  /**
   * Freeze the sheet as it is. The state goes into the blockstore, the entry
   * into the document's own list.
   *
   * @param {{ by?: string }} [options] - who asked — the caller's PeerId, or ours
   */
  async function take ({ by = libp2p.peerId.toString() } = {}) {
    const bytes = Y.encodeStateAsUpdate(doc)
    const { cid, sha256: hash } = await address(bytes)
    await helia.blockstore.put(cid, bytes)
    const entry = {
      cid: cid.toString(),
      bytes: bytes.length,
      sha256: hash,
      cells: doc.getMap('cells').size,
      topic,
      at: new Date().toISOString(),
      by
    }
    list.push([entry])
    return entry
  }

  /** Every snapshot taken on this sheet, newest first — as the document replicates them. */
  function entries () {
    return list.toArray().slice().reverse()
  }

  /**
   * The bytes behind a CID: from this node's own blocks, or over Bitswap from
   * a connected peer that has them. Verified against the CID either way.
   *
   * @param {string} cidString
   * @param {{ signal?: AbortSignal }} [options]
   */
  async function fetch (cidString, { signal = AbortSignal.timeout(30_000) } = {}) {
    const cid = CID.parse(cidString)
    // Helia 7 streams a block in chunks; a block fetched over Bitswap is
    // checked against its CID by Helia before it is handed out. Checked once
    // more here, on the assembled bytes — the whole point of a CID.
    const chunks = []
    let size = 0
    for await (const chunk of helia.blockstore.get(cid, { signal })) {
      chunks.push(chunk)
      size += chunk.byteLength
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const { cid: actual } = await address(bytes)
    if (!actual.equals(cid)) { throw new Error(`block does not match its CID: got ${actual}, wanted ${cid}`) }
    return bytes
  }

  /**
   * The cells a snapshot holds, read in a scratch document — the sheet is not touched.
   *
   * @param {string} cidString
   * @param {{ signal?: AbortSignal }} [options]
   */
  async function peek (cidString, options) {
    const bytes = await fetch(cidString, options)
    const scratch = new Y.Doc()
    Y.applyUpdate(scratch, bytes)
    /** @type {Record<string, { value: unknown, formula: string | null }>} */
    const cells = {}
    scratch.getMap('cells').forEach((cell, coord) => {
      cells[coord] = { value: cell.get('value'), formula: cell.get('formula') ?? null }
    })
    scratch.destroy()
    return { cells, bytes: bytes.length }
  }

  /**
   * Put the sheet back to a snapshot: every cell as it was then, cells added
   * since cleared. A CRDT cannot be rewound — applying an old update changes
   * nothing — so this writes the old values as new edits, in one transaction,
   * which every peer receives like any other edit.
   *
   * @param {string} cidString
   * @param {{ signal?: AbortSignal }} [options]
   */
  async function restore (cidString, options) {
    const { cells } = await peek(cidString, options)
    const live = doc.getMap('cells')
    doc.transact(() => {
      for (const coord of [...live.keys()]) { if (!(coord in cells)) { engine.clearCell(coord) } }
      for (const [coord, cell] of Object.entries(cells)) { engine.setCell(coord, cell.formula ?? cell.value) }
    })
    return { cells: Object.keys(cells).length }
  }

  return {
    helia,
    take,
    entries,
    fetch,
    peek,
    restore,
    /**
     * Fires whenever the list changes — ours or a peer's.
     *
     * @param {() => void} fn
     */
    onChange (fn) {
      list.observe(fn)
      return () => list.unobserve(fn)
    },
    stop: () => helia.stop()
  }
}
