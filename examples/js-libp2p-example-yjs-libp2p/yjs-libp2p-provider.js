/* eslint-disable no-console, default-case */

import { fromString, toString } from 'uint8arrays'
import * as Y from 'yjs'

/**
 * Yjs connection provider using libp2p for peer-to-peer connectivity
 * This replaces y-webrtc and uses libp2p's pubsub for synchronization
 */
export class Libp2pProvider {
  /**
   * @param {string} topic - The pubsub topic to use for this document
   * @param {Y.Doc} doc - The Yjs document to sync
   * @param {import('libp2p').Libp2p} libp2p - The libp2p instance
   * @param {object} options - Provider options
   */
  constructor (topic, doc, libp2p, options = {}) {
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
   * Subscribe to the pubsub topic for this document
   */
  async _subscribeToPubsub () {
    try {
      await this.libp2p.services.pubsub.subscribe(this.topic)
      this.libp2p.services.pubsub.addEventListener('message', this._onPubsubMessage)
      this.connected = true
      console.log(`✅ Subscribed to Yjs topic: ${this.topic}`)

      // Log current subscriptions
      const topics = this.libp2p.services.pubsub.getTopics()
      console.log('All subscribed topics:', topics)

      // Check peers multiple times as gossipsub mesh forms
      const checkPeers = () => {
        const peers = this.libp2p.services.pubsub.getSubscribers(this.topic)
        console.log(`Peers subscribed to ${this.topic}:`, peers.map(p => p.toString()))

        if (peers.length === 0) {
          console.warn('⚠️ No peers subscribed to this topic yet. Waiting for gossipsub mesh...')
        } else {
          console.log('✅ Gossipsub mesh formed!')
        }
      }

      setTimeout(checkPeers, 2000)
      setTimeout(checkPeers, 5000)
      setTimeout(checkPeers, 10000)
    } catch (err) {
      console.error('Failed to subscribe to pubsub topic:', err)
    }
  }

  /**
   * Set up peer discovery to connect to discovered peers
   */
  _setupPeerDiscovery () {
    // Listen for peer discovery events from pubsubPeerDiscovery
    this.libp2p.addEventListener('peer:discovery', this._onPeerDiscovered)

    // Track connections
    this.libp2p.addEventListener('peer:connect', async (evt) => {
      const peerId = evt.detail.toString()
      console.log(`Connected to peer: ${peerId}`)
      this.connectedPeers.add(peerId)
    })

    this.libp2p.addEventListener('peer:disconnect', (evt) => {
      const peerId = evt.detail.toString()
      console.log(`Disconnected from peer: ${peerId}`)
      this.connectedPeers.delete(peerId)
    })
  }

  /**
   * Handle peer discovery events
   *
   * @param {any} evt
   */
  async _handlePeerDiscovered (evt) {
    const peer = evt.detail
    const peerId = peer.id.toString()
    console.log(`[Provider] Discovered peer: ${peerId}`)

    // Don't dial ourselves
    if (this.libp2p.peerId.equals(peer.id)) {
      console.log(`[Provider] Skipping self: ${peerId}`)
      return
    }

    // Check if we're already connected to this peer
    const connections = this.libp2p.getConnections(peer.id)
    if (connections && connections.length > 0) {
      console.log(`[Provider] Already connected to peer: ${peerId} (${connections.length} connections)`)
      return
    }

    console.log(`[Provider] Dialing new peer: ${peerId}`)
    console.log('[Provider] Peer addresses:', peer.multiaddrs.map(ma => ma.toString()))

    try {
      // Dial the peer ID directly - libp2p will handle finding the best route
      await this.libp2p.dial(peer.id)
      console.log(`[Provider] ✅ Successfully dialed peer: ${peerId}`)
    } catch (error) {
      console.error(`[Provider] ❌ Failed to dial peer ${peerId}:`, error.message)
    }
  }

  /**
   * Request initial document state from connected peers
   */
  async _requestInitialState () {
    // Wait a bit for peers to connect
    setTimeout(() => {
      const stateVector = Y.encodeStateVector(this.doc)
      this._publishMessage({
        type: 'sync-request',
        stateVector: toString(stateVector, 'base64')
      })
    }, 1000)
  }

  /**
   * Handle Yjs document updates
   *
   * @param {Uint8Array} update
   * @param {any} origin
   */
  _handleDocUpdate (update, origin) {
    // Don't broadcast updates that came from the network
    if (origin === this) {
      return
    }

    console.log('Broadcasting Yjs update to peers')
    // Broadcast the update to all peers via pubsub
    this._publishMessage({
      type: 'update',
      update: toString(update, 'base64')
    })
  }

  /**
   * Handle incoming pubsub messages
   *
   * @param {any} evt
   */
  _handlePubsubMessage (evt) {
    // Ignore our own messages
    if (evt.detail.topic !== this.topic) {
      return
    }
    if (this.libp2p.peerId.equals(evt.detail.from)) {
      return
    }

    console.log(`Received pubsub message from ${evt.detail.from.toString()}, type: ${evt.detail.topic}`)

    try {
      const message = JSON.parse(toString(evt.detail.data, 'utf8'))
      console.log(`Message type: ${message.type}`)

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
      }
    } catch (err) {
      console.error('Failed to process pubsub message:', err)
    }
  }

  /**
   * Apply an update to the document
   *
   * @param {string} updateBase64
   */
  _applyUpdate (updateBase64) {
    console.log('Applying Yjs update from network')
    const update = fromString(updateBase64, 'base64')
    Y.applyUpdate(this.doc, update, this)

    if (!this.synced) {
      this.synced = true
      console.log('Document synced with network')
    }
  }

  /**
   * Handle sync request from a peer
   *
   * @param {string} stateVectorBase64
   */
  _handleSyncRequest (stateVectorBase64) {
    const stateVector = fromString(stateVectorBase64, 'base64')
    const update = Y.encodeStateAsUpdate(this.doc, stateVector)

    this._publishMessage({
      type: 'sync-response',
      update: toString(update, 'base64')
    })
  }

  /**
   * Handle sync response from a peer
   *
   * @param {string} updateBase64
   */
  _handleSyncResponse (updateBase64) {
    this._applyUpdate(updateBase64)
  }

  /**
   * Publish a message to the pubsub topic
   *
   * @param {object} message
   */
  async _publishMessage (message) {
    try {
      const data = fromString(JSON.stringify(message), 'utf8')

      // Check peers subscribed to this topic
      const subscribers = this.libp2p.services.pubsub.getSubscribers(this.topic)
      console.log(`Publishing message type: ${message.type} to topic: ${this.topic}`)
      console.log(`Subscribers to ${this.topic}:`, subscribers.map(p => p.toString()))
      console.log('Total connected peers:', this.libp2p.getConnections().length)

      const result = await this.libp2p.services.pubsub.publish(this.topic, data)
      console.log('Message published successfully', result)
    } catch (err) {
      console.error('Failed to publish message:', err)
    }
  }

  /**
   * Destroy the provider and clean up resources
   */
  destroy () {
    this.doc.off('update', this._onUpdate)
    this.libp2p.services.pubsub.removeEventListener('message', this._onPubsubMessage)
    this.libp2p.removeEventListener('peer:discovery', this._onPeerDiscovered)

    // Unsubscribe from topic
    this.libp2p.services.pubsub.unsubscribe(this.topic).catch(err => {
      console.error('Failed to unsubscribe from topic:', err)
    })

    this.connected = false
    this.synced = false
  }
}
