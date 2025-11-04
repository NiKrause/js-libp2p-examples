/* eslint-disable no-console */

import { peerIdFromString } from '@libp2p/peer-id'

/**
 * Handles manual SDP offer/answer exchange for WebRTC connections
 * This allows establishing direct WebRTC connections without circuit relay
 * by manually exchanging SDP offers and answers between peers.
 */
export class SDPExchangeManager {
  constructor (libp2pNode) {
    this.node = libp2pNode
    this.pendingOffers = new Map()
    this.peerConnections = new Map()
    this.onConnectionEstablished = null
    this.onMessage = null
    
    // Set up protocol handler for receiving SDP answers via libp2p
    this.setupLibp2pSignaling()
  }
  
  /**
   * No longer needed - using WebRTC data channel for signaling
   */
  setupLibp2pSignaling () {
    // Not used anymore - WebRTC data channel handles answer exchange
  }

  /**
   * Create an SDP offer and return it as a base64 string
   * @returns {Promise<string>} Base64-encoded SDP offer with peer ID
   */
  async createOffer () {
    this.log?.('📝 Step 1: Creating RTCPeerConnection...')
    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }

    const pc = new RTCPeerConnection(config)
    this.peerConnections.set(pc, { type: 'initiator' })
    this.log?.(`   ✓ Peer connection created (using ${config.iceServers.length} STUN servers)`)

    // Create data channel for communication
    this.log?.('📝 Step 2: Creating data channel...')
    const dataChannel = pc.createDataChannel('libp2p', {
      ordered: true
    })
    this.log?.('   ✓ Data channel "libp2p" created')

    // Set up connection state handlers
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState
      this.log?.(`🔌 ICE connection state: ${state}`)
      
      if (state === 'connected') {
        this.log?.('   ✓ ICE connection established!')
      } else if (state === 'checking') {
        this.log?.('   ⏳ Checking ICE connectivity...')
      } else if (state === 'failed') {
        this.log?.('   ❌ ICE connection failed')
        this.peerConnections.delete(pc)
      } else if (state === 'closed') {
        this.log?.('   🔒 ICE connection closed')
        this.peerConnections.delete(pc)
      }
    }

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      this.log?.(`📡 Peer connection state: ${state}`)
      
      if (state === 'connected') {
        this.log?.('   ✓ Peer connection fully established!')
      } else if (state === 'connecting') {
        this.log?.('   ⏳ Establishing peer connection...')
      } else if (state === 'failed') {
        this.log?.('   ❌ Peer connection failed')
      } else if (state === 'disconnected') {
        this.log?.('   ⚠️  Peer connection disconnected')
      } else if (state === 'closed') {
        this.log?.('   🔒 Peer connection closed')
      }
    }

    // Set up data channel event handlers
    this.setupDataChannelHandlers(pc, dataChannel)

    // Create offer
    this.log?.('📝 Step 3: Generating SDP offer...')
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    this.log?.('   ✓ SDP offer created and set as local description')

    // Wait for ICE gathering to complete
    this.log?.('📝 Step 4: Gathering ICE candidates...')
    await this.waitForIceComplete(pc)
    this.log?.(`   ✓ ICE gathering complete (state: ${pc.iceGatheringState})`)

    const offerData = {
      sdp: pc.localDescription.sdp,
      type: pc.localDescription.type,
      peerId: this.node.peerId.toString()
    }

    // Store the peer connection for later
    this.pendingOffers.set(pc, offerData)

    // Encode to base64
    const encoded = btoa(JSON.stringify(offerData))
    this.log?.(`📝 Step 5: Encoding offer to base64 (${encoded.length} characters)`)
    
    return encoded
  }

  /**
   * Process a received offer and create an answer
   * @param {string} offerBase64 - Base64-encoded offer
   * @returns {Promise<string>} Base64-encoded SDP answer with peer ID
   */
  async createAnswer (offerBase64) {
    try {
      this.log?.('📥 Step 1: Decoding received offer...')
      const offerData = JSON.parse(atob(offerBase64))
      const remotePeerShort = offerData.peerId.slice(0, 8) + '...' + offerData.peerId.slice(-4)
      this.log?.(`   ✓ Offer decoded from peer: ${remotePeerShort}`)
      this.log?.(`   ✓ SDP type: ${offerData.type}`)
      this.log?.(`   ✓ SDP length: ${offerData.sdp.length} bytes`)

      this.log?.('📝 Step 2: Creating RTCPeerConnection...')
      const config = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }

      const pc = new RTCPeerConnection(config)
      this.peerConnections.set(pc, { type: 'responder', remotePeerId: offerData.peerId })
      this.log?.(`   ✓ Peer connection created (using ${config.iceServers.length} STUN servers)`)
      this.log?.(`   ✓ Signaling state: ${pc.signalingState}`)

      // Set up data channel event BEFORE setting remote description
      // (because ondatachannel fires when setRemoteDescription is called)
      pc.ondatachannel = (event) => {
        const channel = event.channel
        this.log?.('📡 Data channel received from remote peer')
        this.setupDataChannelHandlers(pc, channel)
      }

      // Create answer first
      this.log?.('📝 Step 3: Setting remote description (offer)...')
      await pc.setRemoteDescription({
        type: offerData.type,
        sdp: offerData.sdp
      })
      this.log?.('   ✓ Remote description set')
      this.log?.(`   ✓ Signaling state now: ${pc.signalingState}`)

      this.log?.('📝 Step 4: Generating SDP answer...')
      const answer = await pc.createAnswer()
      this.log?.(`   ✓ Answer created (type: ${answer.type})`)
      
      await pc.setLocalDescription(answer)
      this.log?.('   ✓ SDP answer set as local description')
      this.log?.(`   ✓ Signaling state now: ${pc.signalingState}`)

      // Wait for ICE gathering
      this.log?.('📝 Step 5: Gathering ICE candidates...')
      await this.waitForIceComplete(pc)
      this.log?.(`   ✓ ICE gathering complete (state: ${pc.iceGatheringState})`)

      const answerData = {
        sdp: pc.localDescription.sdp,
        type: pc.localDescription.type,
        peerId: this.node.peerId.toString()
      }

      const answerBase64 = btoa(JSON.stringify(answerData))
      this.log?.(`📝 Step 6: Encoding answer to base64 (${answerBase64.length} characters)`)

      // Set up connection state handlers BEFORE data channel
      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState
        this.log?.(`🔌 ICE connection state: ${state}`)
        
        if (state === 'connected') {
          this.log?.('   ✓ ICE connection established!')
        } else if (state === 'checking') {
          this.log?.('   ⏳ Checking ICE connectivity...')
        } else if (state === 'failed') {
          this.log?.('   ❌ ICE connection failed')
          this.peerConnections.delete(pc)
        } else if (state === 'closed') {
          this.log?.('   🔒 ICE connection closed')
          this.peerConnections.delete(pc)
        }
      }

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState
        this.log?.(`📡 Peer connection state: ${state}`)
        
        if (state === 'connected') {
          this.log?.('   ✓ Peer connection fully established!')
        } else if (state === 'connecting') {
          this.log?.('   ⏳ Establishing peer connection...')
        } else if (state === 'failed') {
          this.log?.('   ❌ Peer connection failed')
        } else if (state === 'disconnected') {
          this.log?.('   ⚠️  Peer connection disconnected')
        } else if (state === 'closed') {
          this.log?.('   🔒 Peer connection closed')
        }
      }

      // Store the answer to be sent when data channel opens
      const metadata = this.peerConnections.get(pc)
      if (metadata) {
        metadata.pendingAnswer = answerBase64
        this.log?.('💾 Answer saved - will be sent automatically when data channel opens')
      }

      return answerBase64
    } catch (error) {
      this.log?.(`❌ Error in createAnswer: ${error.message}`)
      throw error
    }
  }

  /**
   * Process a received answer (called by the initiator)
   * @param {string} answerBase64 - Base64-encoded answer
   * @param {RTCPeerConnection} peerConnection - The peer connection that created the offer
   */
  async processAnswer (answerBase64, peerConnection) {
    this.log?.('📥 Processing received answer...')
    const answerData = JSON.parse(atob(answerBase64))
    const remotePeerShort = answerData.peerId.slice(0, 8) + '...' + answerData.peerId.slice(-4)
    this.log?.(`   ✓ Answer decoded from peer: ${remotePeerShort}`)

    this.log?.('📝 Setting remote description (answer)...')
    await peerConnection.setRemoteDescription({
      type: answerData.type,
      sdp: answerData.sdp
    })
    this.log?.('   ✓ Remote description set - WebRTC negotiation complete!')

    const metadata = this.peerConnections.get(peerConnection)
    if (metadata) {
      metadata.remotePeerId = answerData.peerId
    }
  }

  /**
   * Wait for ICE gathering to complete
   * @param {RTCPeerConnection} pc - The peer connection
   * @returns {Promise<void>}
   */
  waitForIceComplete (pc) {
    return new Promise((resolve, reject) => {
      if (pc.iceGatheringState === 'complete') {
        resolve()
        return
      }

      let candidateCount = 0
      let hasHostCandidate = false
      
      // Set a timeout of 5 seconds for ICE gathering
      const timeout = setTimeout(() => {
        this.log?.(`   ⚠️  ICE gathering timeout (${candidateCount} candidates found)`)
        if (hasHostCandidate) {
          this.log?.('   → Proceeding with host candidates only')
          resolve()
        } else {
          this.log?.('   ❌ No candidates found - check network/STUN servers')
          reject(new Error('ICE gathering timeout'))
        }
      }, 5000)
      
      // Track ICE candidates being gathered
      pc.addEventListener('icecandidate', (event) => {
        if (event.candidate) {
          candidateCount++
          this.log?.(`   → ICE candidate #${candidateCount}: ${event.candidate.type} (${event.candidate.protocol})`)
          if (event.candidate.type === 'host') {
            hasHostCandidate = true
          }
        } else {
          // null candidate means gathering is complete
          clearTimeout(timeout)
          this.log?.(`   ✓ ICE gathering complete (${candidateCount} candidates)`)
          resolve()
        }
      })

      const checkState = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', checkState)
          clearTimeout(timeout)
          resolve()
        }
      }

      pc.addEventListener('icegatheringstatechange', checkState)
    })
  }

  /**
   * Set up data channel event handlers
   * @param {RTCPeerConnection} pc - The peer connection
   * @param {RTCDataChannel} dataChannel - The data channel
   */
  setupDataChannelHandlers (pc, dataChannel) {
    if (dataChannel) {
      const metadata = this.peerConnections.get(pc)
      
      // Log initial state
      this.log?.(`📡 Data channel created - readyState: ${dataChannel.readyState}`)
      
      dataChannel.onopen = () => {
        const peerIdShort = metadata?.remotePeerId
          ? metadata.remotePeerId.slice(0, 8) + '...' + metadata.remotePeerId.slice(-4)
          : 'unknown'
        this.log?.(`🎉 Data channel opened to peer: ${peerIdShort}`)
        this.log?.(`   ✓ Data channel readyState: ${dataChannel.readyState}`)
        
        // If this is the responder and we have a pending answer to send, send it now!
        if (metadata?.type === 'responder' && metadata?.pendingAnswer) {
          this.log?.('📤 Sending SDP answer via data channel...')
          dataChannel.send(JSON.stringify({
            type: 'sdp-answer',
            answer: metadata.pendingAnswer
          }))
          this.log?.('   ✓ Answer sent via WebRTC data channel!')
          delete metadata.pendingAnswer
        }
        
        if (this.onConnectionEstablished) {
          this.onConnectionEstablished(pc, dataChannel, metadata)
        }
      }

      dataChannel.onmessage = (event) => {
        try {
          // Try to parse as JSON first - might be SDP answer
          const data = JSON.parse(event.data)
          
          if (data.type === 'sdp-answer') {
            this.log?.('📥 Received SDP answer via data channel!')
            this.processAnswer(data.answer, pc)
              .then(() => {
                this.log?.('   ✓ Answer processed automatically!')
              })
              .catch(err => {
                this.log?.(`   ❌ Error processing answer: ${err.message}`)
              })
            return
          }
        } catch (e) {
          // Not JSON or not SDP answer, pass to normal message handler
        }
        
        if (this.onMessage) {
          this.onMessage(event.data, pc)
        }
      }

      dataChannel.onclose = () => {
        this.log?.('🔒 Data channel closed')
        this.log?.(`   ✓ Data channel readyState: ${dataChannel.readyState}`)
      }

      dataChannel.onerror = (error) => {
        this.log?.(`❌ Data channel error: ${error}`)
        this.log?.(`   ✓ Data channel readyState: ${dataChannel.readyState}`)
      }
    }
  }

  /**
   * Get the peer connection from a previously created offer
   * @param {number} index - Index of the pending offer
   * @returns {RTCPeerConnection|undefined}
   */
  getPendingOffer (index = 0) {
    return Array.from(this.pendingOffers.keys())[index]
  }

  /**
   * Get all active peer connections
   * @returns {Array<RTCPeerConnection>}
   */
  getActivePeerConnections () {
    return Array.from(this.peerConnections.keys()).filter(pc => {
      return pc.connectionState === 'connected' || pc.connectionState === 'connecting'
    })
  }

  /**
   * Close all peer connections and clean up
   */
  destroy () {
    for (const pc of this.peerConnections.keys()) {
      pc.close()
    }
    this.peerConnections.clear()
    this.pendingOffers.clear()
  }
}

