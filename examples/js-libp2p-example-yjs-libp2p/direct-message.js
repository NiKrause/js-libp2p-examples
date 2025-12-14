/* eslint-disable no-console */

import { peerIdFromString } from '@libp2p/peer-id'
import { pbStream } from 'it-protobuf-stream'
import { dm } from './protobuf/direct-message.js'
import { DEBUG } from './constants.js'

/**
 * Direct Message Service for Universal Connectivity
 * 
 * Provides private peer-to-peer messaging between libp2p nodes.
 * Uses protobuf streams for reliable request-response communication.
 * 
 * Protocol: /universal-connectivity/dm/1.0.0
 * Pattern: Request-Response with acknowledgment
 */

const DIRECT_MESSAGE_PROTOCOL = '/universal-connectivity/dm/1.0.0'
const DM_CLIENT_VERSION = '0.0.1'
const MIME_TEXT_PLAIN = 'text/plain'

const ERRORS = {
  EMPTY_MESSAGE: 'Message cannot be empty',
  NO_CONNECTION: 'Failed to create connection',
  NO_STREAM: 'Failed to create stream',
  NO_RESPONSE: 'No response received',
  NO_METADATA: 'No metadata in response',
  STATUS_NOT_OK: (status) => `Received status: ${status}, expected OK`
}

/**
 * Direct Message Service
 * 
 * This service handles:
 * - Sending private messages to specific peers
 * - Receiving and acknowledging incoming messages
 * - Dispatching received messages as events
 */
export class DirectMessage {
  /**
   * @param {object} components - libp2p components
   * @param {object} components.libp2p - libp2p instance
   */
  constructor (components) {
    this.libp2p = components.libp2p
    this.dmPeers = new Set()
    this.topologyId = null
  }

  /**
   * Start the direct message service
   */
  async start () {
    if (DEBUG) {
      console.log('🔐 Direct Message: Starting service...')
    }

    // Register topology to track peers that support this protocol
    this.topologyId = await this.libp2p.register(DIRECT_MESSAGE_PROTOCOL, {
      onConnect: (peerId) => {
        this.dmPeers.add(peerId.toString())
      },
      onDisconnect: (peerId) => {
        this.dmPeers.delete(peerId.toString())
      }
    })

    if (DEBUG) {
      console.log(`✅ Direct Message: Registered topology for ${DIRECT_MESSAGE_PROTOCOL}`)
    }
  }

  /**
   * After start hook - register protocol handler
   */
  async afterStart () {
    // Register protocol handler for incoming messages
    await this.libp2p.handle(DIRECT_MESSAGE_PROTOCOL, async ({ stream, connection }) => {
      await this.receive(stream, connection)
    })

    if (DEBUG) {
      console.log(`✅ Direct Message: Registered protocol handler ${DIRECT_MESSAGE_PROTOCOL}`)
    }
  }

  /**
   * Stop the direct message service
   */
  stop () {
    if (this.topologyId != null) {
      this.libp2p.unregister(this.topologyId)
    }
    this.dmPeers.clear()
    if (DEBUG) {
      console.log('✅ Direct Message: Service stopped')
    }
  }

  /**
   * Check if a peer supports direct messaging
   * @param {string} peerIdStr - Peer ID as string
   * @returns {boolean}
   */
  isDMPeer (peerIdStr) {
    return this.dmPeers.has(peerIdStr)
  }

  /**
   * Send a direct message to a peer
   * 
   * @param {string} peerIdStr - Target peer ID as string
   * @param {string} message - Message content
   * @returns {Promise<boolean>} Success status
   */
  async send (peerIdStr, message) {
    if (!message) {
      throw new Error(ERRORS.EMPTY_MESSAGE)
    }

    let stream

    try {
      // Convert string to PeerId object
      let peerId
      try {
        peerId = peerIdFromString(peerIdStr)
      } catch (err) {
        throw new Error(`Invalid peer ID: ${peerIdStr}`)
      }

      if (DEBUG) {
        console.log(`📤 [DM] Sending to ${peerIdStr.slice(0, 8)}...`)
      }

      // openConnection will return the current open connection if it already exists, or create a new one
      const conn = await this.libp2p.dial(peerId, { signal: AbortSignal.timeout(5000) })
      
      if (!conn) {
        throw new Error(ERRORS.NO_CONNECTION)
      }

      // Single protocols can skip full negotiation
      stream = await conn.newStream(DIRECT_MESSAGE_PROTOCOL, {
        negotiateFully: false
      })

      if (!stream) {
        throw new Error(ERRORS.NO_STREAM)
      }

      const datastream = pbStream(stream)

      const req = {
        content: message,
        type: MIME_TEXT_PLAIN,
        metadata: {
          clientVersion: DM_CLIENT_VERSION,
          timestamp: BigInt(Date.now())
        }
      }

      const signal = AbortSignal.timeout(5000)

      await datastream.write(req, dm.DirectMessageRequest, { signal })

      const res = await datastream.read(dm.DirectMessageResponse, { signal })

      if (!res) {
        throw new Error(ERRORS.NO_RESPONSE)
      }

      if (!res.metadata) {
        throw new Error(ERRORS.NO_METADATA)
      }

      if (res.status !== dm.Status.OK) {
        throw new Error(ERRORS.STATUS_NOT_OK(res.status))
      }

      if (DEBUG) {
        console.log(`✅ Direct Message: Sent successfully to ${peerIdStr.slice(0, 8)}...`)
      }

      return true
    } catch (e) {
      stream?.abort(e)
      throw e
    } finally {
      try {
        await stream?.close({
          signal: AbortSignal.timeout(5000)
        })
      } catch (err) {
        stream?.abort(err)
        throw err
      }
    }
  }

  /**
   * Receive and handle incoming direct message
   * 
   * @param {object} stream - Incoming stream
   * @param {object} connection - Connection object
   */
  async receive (stream, connection) {
    try {
      const datastream = pbStream(stream)

      const signal = AbortSignal.timeout(5000)

      const req = await datastream.read(dm.DirectMessageRequest, { signal })

      const res = {
        status: dm.Status.OK,
        metadata: {
          clientVersion: DM_CLIENT_VERSION,
          timestamp: BigInt(Date.now())
        }
      }

      await datastream.write(res, dm.DirectMessageResponse, { signal })

      const detail = {
        content: req.content,
        type: req.type,
        stream: stream,
        connection: connection
      }

      // Dispatch message event
      const event = new CustomEvent('dm:message', {
        detail: {
          content: req.content,
          type: req.type,
          peerId: connection.remotePeer.toString(),
          timestamp: Number(req.metadata.timestamp)
        }
      })

      this.libp2p.dispatchEvent(event)

      if (DEBUG) {
        console.log(`✅ Direct Message: Received from ${connection.remotePeer.toString().slice(0, 8)}...`)
      }
    } catch (e) {
      stream?.abort(e)
      throw e
    } finally {
      try {
        await stream?.close({
          signal: AbortSignal.timeout(5000)
        })
      } catch (err) {
        stream?.abort(err)
        throw err
      }
    }
  }
}

/**
 * Factory function to create direct message service
 * Follows libp2p service pattern
 * 
 * @param {object} options - Service options
 * @returns {Function} Service factory
 */
export function directMessage (options = {}) {
  return (components) => {
    const service = new DirectMessage({ ...components, ...options })
    return service
  }
}
