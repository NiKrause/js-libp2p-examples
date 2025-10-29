import { fromString, toString } from 'uint8arrays'
import * as Y from 'yjs'
import { DEBUG, INTERVALS } from './constants.js'

/**
 * Yjs connection provider using libp2p for peer-to-peer connectivity.
 * This replaces y-webrtc and uses libp2p's pubsub for synchronization.
 */
export class Libp2pProvider {
  /**
   * Creates a new Libp2pProvider for Yjs document synchronization.
   *
   * @param {string} topic - The pubsub topic to use for this document
   * @param {Y.Doc} doc - The Yjs document to sync
   * @param {import('libp2p').Libp2p} libp2p - The libp2p instance
   * @param {object} [options] - Provider options
   * @param {object} [options.awareness] - Yjs awareness instance for cursor/selection sharing
   * @throws {Error} If topic is empty or libp2p node is not initialized
   */
  constructor (topic, doc, libp2p, options = {}) {
    if (!topic || typeof topic !== 'string') {
      throw new Error('Topic must be a non-empty string')
    }
    if (!doc || !(doc instanceof Y.Doc)) {
      throw new Error('doc must be a valid Yjs document')
    }
    if (!libp2p) {
      throw new Error('libp2p node must be provided')
    }
    this.topic = topic
    this.doc = doc
    this.libp2p = libp2p
    this.awareness = options.awareness
    this.synced = false
    this.connected = false

    // Track connected peers
    this.connectedPeers = new Set()

    // Bind event handlers
    this._onUpdate = this._handleDocUpdate.bind(this)
    this._onPubsubMessage = this._handlePubsubMessage.bind(this)
    this._onPeerDiscovered = this._handlePeerDiscovered.bind(this)

    // Subscribe to document updates
    this.doc.on('update', this._onUpdate)

    // Subscribe to pubsub topic
    this._subscribeToPubsub()

    // Set up peer discovery
    this._setupPeerDiscovery()

    // Request initial state from peers
    this._requestInitialState()
  }

  /**
   * Subscribe to the pubsub topic for this document.
   * @private
   * @returns {Promise<void>}
   */
  async _subscribeToPubsub () {
    try {
      await this.libp2p.services.pubsub.subscribe(this.topic)
      this.libp2p.services.pubsub.addEventListener('message', this._onPubsubMessage)
      this.connected = true

      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.log(`✅ Subscribed to Yjs topic: ${this.topic}`)
        const topics = this.libp2p.services.pubsub.getTopics()
        // eslint-disable-next-line no-console
        console.log('All subscribed topics:', topics)

        // Check peers as gossipsub mesh forms
        const checkPeers = () => {
          const peers = this.libp2p.services.pubsub.getSubscribers(this.topic)
          // eslint-disable-next-line no-console
          console.log(`Peers on ${this.topic}:`, peers.map((p) => p.toString()))
        }

        setTimeout(checkPeers, INTERVALS.PEER_CHECK)
        setTimeout(checkPeers, INTERVALS.PEER_CHECK * 2.5)
        setTimeout(checkPeers, INTERVALS.PEER_CHECK * 5)
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to subscribe to pubsub topic:', err)
      throw err
    }
  }

  /**
   * Set up peer discovery to connect to discovered peers.
   * @private
   */
  _setupPeerDiscovery () {
    this.libp2p.addEventListener('peer:discovery', this._onPeerDiscovered)

    this.libp2p.addEventListener('peer:connect', (evt) => {
      const peerId = evt.detail.toString()
      this.connectedPeers.add(peerId)
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.log(`Connected to peer: ${peerId}`)
      }
    })

    this.libp2p.addEventListener('peer:disconnect', (evt) => {
      const peerId = evt.detail.toString()
      this.connectedPeers.delete(peerId)
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.log(`Disconnected from peer: ${peerId}`)
      }
    })
  }

  /**
   * Handle peer discovery events.
   * @private
   * @param {CustomEvent} evt - Peer discovery event
   * @returns {Promise<void>}
   */
  async _handlePeerDiscovered (evt) {
    const peer = evt.detail
    const peerId = peer.id.toString()

    if (this.libp2p.peerId.equals(peer.id)) {
      return
    }

    const connections = this.libp2p.getConnections(peer.id)
    if (connections && connections.length > 0) {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.log(`Already connected to peer: ${peerId}`)
      }
      return
    }

    try {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.log(`Dialing peer: ${peerId}`)
      }
      await this.libp2p.dial(peer.id)
    } catch (error) {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.warn(`Failed to dial peer ${peerId}:`, error.message)
      }
    }
  }

  /**
   * Request initial document state from connected peers.
   * @private
   * @returns {Promise<void>}
   */
  async _requestInitialState () {
    setTimeout(() => {
      const stateVector = Y.encodeStateVector(this.doc)
      this._publishMessage({
        type: 'sync-request',
        stateVector: toString(stateVector, 'base64')
      }).catch((err) => {
        if (DEBUG) {
          // eslint-disable-next-line no-console
          console.error('Failed to send sync request:', err)
        }
      })
    }, INTERVALS.INITIAL_SYNC_REQUEST)
  }

  /**
   * Handle Yjs document updates.
   * @private
   * @param {Uint8Array} update - The document update
   * @param {any} origin - Origin of the update
   */
  _handleDocUpdate (update, origin) {
    if (origin === this) {
      return
    }

    this._publishMessage({
      type: 'update',
      update: toString(update, 'base64')
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Failed to broadcast update:', err)
    })
  }

  /**
   * Handle incoming pubsub messages.
   * @private
   * @param {CustomEvent} evt - Pubsub message event
   */
  _handlePubsubMessage (evt) {
    if (evt.detail.topic !== this.topic || this.libp2p.peerId.equals(evt.detail.from)) {
      return
    }

    try {
      const message = JSON.parse(toString(evt.detail.data, 'utf8'))

      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.log(`Received ${message.type} from ${evt.detail.from.toString()}`)
      }

      switch (message.type) {
      case 'update':
        this._applyUpdate(message.update)
        break
      case 'sync-request':
        this._handleSyncRequest(message.stateVector)
        break
      case 'sync-response':
        this._handleSyncResponse(message.update)
        break
      default:
        if (DEBUG) {
          // eslint-disable-next-line no-console
          console.warn(`Unknown message type: ${message.type}`)
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to process pubsub message:', err)
    }
  }

  /**
   * Apply an update to the document.
   * @private
   * @param {string} updateBase64 - Base64-encoded Yjs update
   */
  _applyUpdate (updateBase64) {
    const update = fromString(updateBase64, 'base64')
    Y.applyUpdate(this.doc, update, this)

    if (!this.synced) {
      this.synced = true
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.log('Document synced with network')
      }
    }
  }

  /**
   * Handle sync request from a peer.
   * @private
   * @param {string} stateVectorBase64 - Base64-encoded state vector
   */
  _handleSyncRequest (stateVectorBase64) {
    const stateVector = fromString(stateVectorBase64, 'base64')
    const update = Y.encodeStateAsUpdate(this.doc, stateVector)

    this._publishMessage({
      type: 'sync-response',
      update: toString(update, 'base64')
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Failed to send sync response:', err)
    })
  }

  /**
   * Handle sync response from a peer.
   * @private
   * @param {string} updateBase64 - Base64-encoded Yjs update
   */
  _handleSyncResponse (updateBase64) {
    this._applyUpdate(updateBase64)
  }

  /**
   * Publish a message to the pubsub topic.
   * @private
   * @param {object} message - Message object to publish
   * @param {string} message.type - Message type (update, sync-request, sync-response)
   * @returns {Promise<void>}
   */
  async _publishMessage (message) {
    try {
      const data = fromString(JSON.stringify(message), 'utf8')

      if (DEBUG) {
        const subscribers = this.libp2p.services.pubsub.getSubscribers(this.topic)
        // eslint-disable-next-line no-console
        console.log(`Publishing ${message.type} to ${this.topic} (${subscribers.length} subscribers)`)
      }

      await this.libp2p.services.pubsub.publish(this.topic, data)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to publish message:', err)
      throw err
    }
  }

  /**
   * Destroy the provider and clean up resources.
   * @returns {Promise<void>}
   */
  async destroy () {
    try {
      this.doc.off('update', this._onUpdate)
      this.libp2p.services.pubsub.removeEventListener('message', this._onPubsubMessage)
      this.libp2p.removeEventListener('peer:discovery', this._onPeerDiscovered)

      await this.libp2p.services.pubsub.unsubscribe(this.topic)

      this.connected = false
      this.synced = false
      this.connectedPeers.clear()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error during provider cleanup:', err)
      throw err
    }
  }
}
