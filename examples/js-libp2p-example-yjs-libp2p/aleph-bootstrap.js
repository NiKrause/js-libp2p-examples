/* eslint-disable no-console */

import { discoverAlephBootstrapMultiaddrs } from '@le-space/aleph-bootstrap'
import { RELAY_BOOTSTRAP_FALLBACK, RELAY_BOOTSTRAP_PROFILE } from './constants.js'

const DISCOVERY_TIMEOUT_MS = 15000

/**
 * Fetch with a deadline, so an unreachable Aleph API costs a few seconds rather
 * than hanging the whole startup path in front of the spreadsheet UI.
 *
 * @param {number} timeoutMs
 */
function fetchWithTimeout (timeoutMs) {
  return (input, init = {}) =>
    fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) })
}

/**
 * Resolve the relay multiaddrs this browser can reach.
 *
 * Discovery runs first and the baked snapshot is the fallback, not the other
 * way round: a snapshot is a photograph of a relay set that rotates on every
 * deploy, and preferring it is how the previous hard-coded address survived
 * long after the relay behind it was gone.
 *
 * @param {object} [options]
 * @param {string} [options.profile]
 * @param {string[]} [options.fallback]
 * @returns {Promise<{ addresses: string[], source: 'aleph' | 'baked', error?: Error }>}
 */
export async function resolveRelayBootstrapAddrs ({
  profile = RELAY_BOOTSTRAP_PROFILE,
  fallback = RELAY_BOOTSTRAP_FALLBACK
} = {}) {
  try {
    const discovered = await discoverAlephBootstrapMultiaddrs({
      profile,
      browserDialableOnly: true,
      fetch: fetchWithTimeout(DISCOVERY_TIMEOUT_MS)
    })

    if (discovered.length > 0) {
      return { addresses: discovered, source: 'aleph' }
    }

    return { addresses: [...fallback], source: 'baked' }
  } catch (error) {
    return { addresses: [...fallback], source: 'baked', error }
  }
}

/**
 * Turn relay multiaddrs into circuit listen addresses.
 *
 * Only secure-WebSocket relays are listened on, and only once per relay. A
 * reservation is attempted for every address here and `start()` does not
 * resolve until all of them have settled, so the WebTransport variants — which
 * a browser cannot reserve a circuit over — stall startup for a minute without
 * buying any reachability, and a relay offered over both dns4 and dns6 only
 * needs the family this browser actually has.
 *
 * It is also capped at one relay by default, because `start()` does not resolve
 * until *every* listen address has settled: measured here with two, one relay
 * created its reservation in half a second while the other simply never
 * answered, and the app sat on "Connecting to UC network..." indefinitely. One
 * reservation is enough to be reachable; the other relays stay in the dial set.
 *
 * @param {string[]} addresses
 */
export function toCircuitListenAddrs (addresses, limit = 1) {
  const seen = new Set()
  const listenAddrs = []

  for (const address of addresses) {
    if (!address.includes('/tls/ws')) continue

    const peerId = address.split('/p2p/')[1]
    if (peerId != null && seen.has(peerId)) continue
    if (peerId != null) seen.add(peerId)

    listenAddrs.push(`${address}/p2p-circuit`)
    if (listenAddrs.length >= limit) break
  }

  return listenAddrs
}

/**
 * Pick the handful of addresses worth announcing.
 *
 * Listening on a circuit multiplies: the relay reports every address it has
 * (ws, raw ports, AutoTLS sni, dns4 and dns6), each becomes a circuit address,
 * and `/webrtc` doubles that again — measured here as 96 addresses, roughly
 * 21 KB of strings. Identify caps its message far below that, so the remote
 * side rejects the whole exchange with "message length too long" and learns
 * none of our protocols. Gossipsub's topology matches on `/meshsub/*` in that
 * protocol list, so the mesh never forms and, on UC's side, the extension is
 * never discovered — over a connection that otherwise pings fine.
 *
 * One browser-dialable address per relay is enough to be reached.
 *
 * @param {import('@multiformats/multiaddr').Multiaddr[]} multiaddrs
 * @param {number} [limit]
 */
export function selectAnnounceAddrs (multiaddrs, limit = 4) {
  const all = multiaddrs.map((ma) => ma.toString())
  const dialable = all.filter((addr) => addr.includes('/p2p-circuit/webrtc'))
  const preferred = dialable.filter((addr) => addr.startsWith('/dns4/') && addr.includes('/tls/ws'))

  const chosen = new Set()
  const seenRelays = new Set()

  for (const addr of [...preferred, ...dialable]) {
    if (chosen.size >= limit) break

    const relay = addr.split('/p2p-circuit')[0].split('/p2p/')[1]
    if (relay != null) {
      if (seenRelays.has(relay)) continue
      seenRelays.add(relay)
    }

    chosen.add(addr)
  }

  // Never announce nothing: an empty list would make us unreachable outright.
  return chosen.size > 0 ? multiaddrs.filter((ma) => chosen.has(ma.toString())) : multiaddrs
}
