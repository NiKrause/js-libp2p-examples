/* eslint-disable no-console */

import { pipe } from 'it-pipe'
import { fromString, toString } from 'uint8arrays'

const PEER_EXCHANGE_PROTOCOL = '/webrtc-peer-exchange/1.0.0'

/**
 * WebRTC Peer Exchange Service
 *
 * Enables browser-to-browser WebRTC mesh formation by sharing peer addresses
 * when new WebRTC connections are established.
 */
export class WebRTCPeerExchange {
  constructor (components, options = {}) {
    this.components = components
    this.enabled = options.enabled !== false
    this.seenPeers = new Set()
    this.started = false

    if (options.debug) {
      this.debug = true
    }
  }

  async start () {
    if (this.started) {
      return
    }

    this.started = true

    // Register protocol handler
    await this.components.registrar.handle(PEER_EXCHANGE_PROTOCOL, this.handlePeerExchange.bind(this))

    // Listen for new connections
    this.components.events.addEventListener('connection:open', this.onConnectionOpen.bind(this))

    if (this.debug) {
      console.log('📡 WebRTC Peer Exchange service started')
    }
  }

  async stop () {
    if (!this.started) {
      return
    }

    this.started = false

    // Unregister protocol handler
    await this.components.registrar.unhandle(PEER_EXCHANGE_PROTOCOL)

    // Remove event listener
    this.components.events.removeEventListener('connection:open', this.onConnectionOpen.bind(this))

    this.seenPeers.clear()

    if (this.debug) {
      console.log('📡 WebRTC Peer Exchange service stopped')
    }
  }

  /**
   * Try to dial a peer using its WebRTC addresses
   *
   * @param {string} peerId
   * @param {string[]} webrtcAddrs
   * @returns {Promise<boolean>}
   */
  async dialPeerWebRTC (peerId, webrtcAddrs) {
    const peerIdShort = peerId.slice(0, 8) + '...' + peerId.slice(-4)

    if (this.debug) {
      console.log(`📡 Peer exchange: Trying to connect to ${peerIdShort}`)
      console.log('WebRTC addresses received:', webrtcAddrs)
    }

    for (const addr of webrtcAddrs) {
      try {
        if (this.debug) {
          console.log(`Attempting to dial: ${addr}`)
        }
        await this.components.dial(addr)
        if (this.debug) {
          console.log(`✅ Successfully connected to ${peerIdShort} via peer exchange!`)
        }
        return true
      } catch (err) {
        if (this.debug) {
          console.log(`Failed to dial ${addr}:`, err.message)
        }
      }
    }
    return false
  }

  /**
   * Process a single peer from peer exchange
   *
   * @param {object} peerInfo
   */
  async processPeerInfo (peerInfo) {
    const peerId = peerInfo.id

    // Skip if we've already seen this peer
    if (this.seenPeers.has(peerId)) {
      return
    }

    // Skip if we're already connected
    const existingConnections = this.components.connectionManager.getConnections()
    if (existingConnections.some(c => c.remotePeer.toString() === peerId)) {
      return
    }

    this.seenPeers.add(peerId)

    // Try to dial the peer's WebRTC addresses
    const webrtcAddrs = peerInfo.addrs.filter(addr => addr.includes('/webrtc'))

    if (webrtcAddrs.length > 0) {
      await this.dialPeerWebRTC(peerId, webrtcAddrs)
    }
  }

  /**
   * Handle incoming peer exchange messages
   *
   * @param root0
   * @param root0.stream
   */
  async handlePeerExchange ({ stream }) {
    if (!this.enabled) {
      return
    }

    try {
      await pipe(
        stream,
        async (source) => {
          for await (const data of source) {
            const message = JSON.parse(toString(data.subarray()))

            if (this.debug) {
              console.log('Received peer exchange:', message.peers.length, 'peers')
            }

            // Process each peer
            for (const peerInfo of message.peers) {
              await this.processPeerInfo(peerInfo)
            }
          }
        }
      )
    } catch (err) {
      if (this.debug) {
        console.log('Error handling peer exchange:', err.message)
      }
    }
  }

  /**
   * Send peer information to a connected peer
   *
   * @param targetPeerId
   * @param peersToShare
   */
  async sendPeerExchange (targetPeerId, peersToShare) {
    if (!this.enabled) {
      return
    }

    try {
      const stream = await this.components.dialProtocol(targetPeerId, PEER_EXCHANGE_PROTOCOL)

      const peerData = {
        peers: peersToShare.map(peer => ({
          id: peer.id.toString(),
          addrs: peer.addrs.map(addr => addr.toString())
        }))
      }

      await pipe(
        [fromString(JSON.stringify(peerData))],
        stream,
        async (source) => {
          // Consume response (if any)
          // eslint-disable-next-line no-unused-vars
          for await (const _msg of source) {
            // Do nothing, just consume
          }
        }
      )
    } catch (err) {
      if (this.debug) {
        console.log(`Failed to send peer exchange to ${targetPeerId.toString().slice(0, 8)}:`, err.message)
      }
    }
  }

  /**
   * Handle new connections - trigger peer exchange for WebRTC connections
   *
   * @param evt
   */
  onConnectionOpen (evt) {
    if (!this.enabled) {
      return
    }

    const connection = evt.detail
    const addr = connection.remoteAddr.toString()

    // Only handle WebRTC connections
    if (!addr.includes('/webrtc')) {
      return
    }

    if (this.debug) {
      console.log('🔄 New WebRTC connection detected, triggering peer exchange')
    }

    this.shareWebRTCPeersOnConnection(connection)
  }

  /**
   * Share WebRTC peers when a new WebRTC connection is established
   *
   * @param newWebRTCConnection
   */
  shareWebRTCPeersOnConnection (newWebRTCConnection) {
    const connections = this.components.connectionManager.getConnections()

    // Find all WebRTC connections
    const webrtcConnections = connections.filter(conn =>
      conn.remoteAddr.toString().includes('/webrtc')
    )

    // Get peer info for all WebRTC-connected peers with their actual WebRTC addresses
    const webrtcPeers = webrtcConnections.map(conn => ({
      id: conn.remotePeer,
      addrs: [conn.remoteAddr]
    }))

    const newPeerId = newWebRTCConnection.remotePeer
    const newPeerIdStr = newPeerId.toString()

    // Tell all existing WebRTC peers about the new peer
    const newPeerInfo = [{
      id: newPeerId,
      addrs: [newWebRTCConnection.remoteAddr]
    }]

    for (const peer of webrtcPeers) {
      if (peer.id.toString() !== newPeerIdStr) {
        if (this.debug) {
          console.log(`Telling ${peer.id.toString().slice(0, 8)} about new peer ${newPeerIdStr.slice(0, 8)}`)
        }
        this.sendPeerExchange(peer.id, newPeerInfo)
      }
    }

    // Tell the new peer about all existing WebRTC peers
    const existingPeers = webrtcPeers.filter(p => p.id.toString() !== newPeerIdStr)
    if (existingPeers.length > 0) {
      if (this.debug) {
        console.log(`Telling new peer ${newPeerIdStr.slice(0, 8)} about ${existingPeers.length} existing WebRTC peers`)
        existingPeers.forEach(p => {
          console.log(`  - ${p.id.toString().slice(0, 8)}: ${p.addrs[0]?.toString()}`)
        })
      }
      this.sendPeerExchange(newPeerId, existingPeers)
    }
  }
}

export function webrtcPeerExchange (init = {}) {
  return (components) => new WebRTCPeerExchange(components, init)
}
