/* eslint-disable no-console */

import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { autoNAT } from '@libp2p/autonat'
import { bootstrap } from '@libp2p/bootstrap'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { dcutr } from '@libp2p/dcutr'
import { gossipsub } from '@libp2p/gossipsub'
import { identify, identifyPush } from '@libp2p/identify'
import { kadDHT } from '@libp2p/kad-dht'
import { peerIdFromString } from '@libp2p/peer-id'
import { ping } from '@libp2p/ping'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p } from 'libp2p'
import * as Y from 'yjs'
import BOOTSTRAP_NODES from './bootstrappers.js'
import { DEBUG, TIMEOUTS, INTERVALS } from './constants.js'
import {
  getTransportType,
  updatePeerDisplay,
  updateMultiaddrDisplay
} from './peer-display.js'
import {
  SpreadsheetEngine,
  SpreadsheetUI
} from './spreadsheet-engine.js'
import { Libp2pProvider } from './yjs-libp2p-provider.js'
import { SDPExchangeManager } from './sdp-exchange.js'

// UI elements (network and logging related)
const topicInput = document.getElementById('topic')
const connectBtn = document.getElementById('connect-btn')
const connectionModeEl = document.getElementById('connection-mode')
const logEl = document.getElementById('log')
const peersEl = document.getElementById('peers')
const peerCountEl = document.getElementById('peer-count')
const peerListEl = document.getElementById('peer-list')
const multiaddrsEl = document.getElementById('multiaddrs')
const multiaddrSelectEl = document.getElementById('multiaddr-select')
const peerIdDisplayEl = document.getElementById('peer-id-display')
const peerIdValueEl = document.getElementById('peer-id-value')
const dialPeerInput = document.getElementById('dial-peer-input')
const dialBtn = document.getElementById('dial-btn')

// SDP exchange UI elements
const generateOfferBtn = document.getElementById('generate-offer-btn')
const offerOutputEl = document.getElementById('offer-output')
const offerInputEl = document.getElementById('offer-input')
const generateAnswerBtn = document.getElementById('generate-answer-btn')
const answerOutputEl = document.getElementById('answer-output')

let libp2pNode
let yjsDoc
let provider
let spreadsheetEngine
let spreadsheetUI
let sdpManager

// Track peer connection transports to detect upgrades
const peerTransports = new Map() // peerId -> Set of transport types

/**
 * Logs a message to both console and UI (latest messages on top).
 *
 * @param {string} message - Message to log
 * @param {boolean} [isError] - Whether this is an error message
 */
const log = (message, isError = false) => {
  if (DEBUG) {
    console.log(message)
  }

  // Prepend message (latest on top)
  const timestamp = new Date().toLocaleTimeString()
  const logMessage = `[${timestamp}] ${message}`
  logEl.value = logMessage + (logEl.value ? '\n' + logEl.value : '')

  if (isError) {
    logEl.style.color = '#d32f2f'
  } else {
    logEl.style.color = 'inherit'
  }
}

// Connect function
async function connect () {
  if (libp2pNode) {
    log('Already connected')
    return
  }

  const topic = topicInput.value.trim()
  if (!topic) {
    log('Please enter a topic', true)
    return
  }

  try {
    if (connectBtn) {
      connectBtn.disabled = true
    }
    connectionModeEl.textContent = '🔄 Connecting to libp2p network...'
    connectionModeEl.style.background = '#fff3e0'
    connectionModeEl.style.borderColor = '#ffb74d'
    connectionModeEl.style.color = '#e65100'

    log('Creating standalone libp2p node (no bootstrap connections)')

    // Create libp2p node with default configuration
    libp2pNode = await createLibp2p({
      addresses: {
        listen: ['/webrtc']
      },
      transports: [
        webSockets(),
        webRTCDirect({
          rtcConfiguration: {
            iceServers: [
              { urls: ['stun:stun.l.google.com:19302'] },
              { urls: ['stun:stun1.l.google.com:19302'] }
            ]
          }
        }),
        webRTC({
          rtcConfiguration: {
            iceServers: [
              { urls: ['stun:stun.l.google.com:19302'] },
              { urls: ['stun:stun1.l.google.com:19302'] }
            ]
          }
        }),
        circuitRelayTransport({
          discoverRelays: 1
        })
      ],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      connectionManager: {
        inboundStreamProtocolNegotiationTimeout:
          TIMEOUTS.PROTOCOL_NEGOTIATION_INBOUND,
        inboundUpgradeTimeout: TIMEOUTS.UPGRADE_INBOUND,
        outboundStreamProtocolNegotiationTimeout:
          TIMEOUTS.PROTOCOL_NEGOTIATION_OUTBOUND,
        outboundUpgradeTimeout: TIMEOUTS.UPGRADE_OUTBOUND
      },
      connectionGater: {
        denyDialMultiaddr: () => false
      },
      peerDiscovery: [
        // Bootstrap disabled for pure WebRTC direct connections
        // bootstrap({
        //   list: BOOTSTRAP_NODES
        // }),
        // pubsubPeerDiscovery({
        //   interval: INTERVALS.PUBSUB_PEER_DISCOVERY
        // })
      ],
      services: {
        identify: identify(),
        identifyPush: identifyPush(),
        autoNAT: autoNAT(),
        dcutr: dcutr(),
        kadDHT: kadDHT({
          clientMode: true
        }),
        ping: ping(),
        pubsub: gossipsub({
          emitSelf: false,
          allowPublishToZeroTopicPeers: true
        })
      }
    })

    const peerIdStr = libp2pNode.peerId.toString()

    // Display peer ID at the top
    peerIdValueEl.textContent = peerIdStr
    peerIdDisplayEl.style.display = 'block'

    log(`Node ID: ${peerIdStr.slice(0, 8)}...${peerIdStr.slice(-4)}`)

    // Expose for testing
    window.libp2pNode = libp2pNode

    // Update connection mode display
    connectionModeEl.textContent = '✅ Connected to libp2p network (WebSocket + WebRTC)'
    connectionModeEl.style.background = '#e8f5e9'
    connectionModeEl.style.borderColor = '#81c784'
    connectionModeEl.style.color = '#2e7d32'

    // Create Yjs document and spreadsheet engine
    yjsDoc = new Y.Doc()
    spreadsheetEngine = new SpreadsheetEngine(yjsDoc)

    // Set up Yjs provider with libp2p
    provider = new Libp2pProvider(topic, yjsDoc, libp2pNode)

    // Create and initialize spreadsheet UI
    spreadsheetUI = new SpreadsheetUI(spreadsheetEngine)
    spreadsheetUI.initialize()

    // Expose for testing
    window.spreadsheetUI = spreadsheetUI

    // Set up SDP exchange manager
    sdpManager = new SDPExchangeManager(libp2pNode)
    
    // Pass log function to SDP manager for detailed logging
    sdpManager.log = log

    // Set up SDP manager callbacks
    sdpManager.onConnectionEstablished = (pc, dataChannel, metadata) => {
      const peerIdShort = metadata.remotePeerId
        ? metadata.remotePeerId.slice(0, 8) + '...' + metadata.remotePeerId.slice(-4)
        : 'unknown'
      log(`✅ Direct WebRTC connection established with ${peerIdShort}`)

      // Send a greeting message
      dataChannel.send(`Hello from ${libp2pNode.peerId.toString()}!`)
    }

    sdpManager.onMessage = (data, pc) => {
      log(`📨 Received message via manual WebRTC: ${data}`)
    }

    // Expose for testing
    window.sdpManager = sdpManager

    log('Ready! Connect to other peers using the Dial Peer section or Manual SDP Exchange.')

    // Initial display updates
    updatePeerDisplay(libp2pNode, peerCountEl, peersEl, peerListEl)
    updateMultiaddrDisplay(libp2pNode, multiaddrsEl, multiaddrSelectEl)

    // Show UI elements
    peersEl.style.display = 'block'
    multiaddrsEl.style.display = 'block'
    document.getElementById('dial-section').style.display = 'block'
    document.getElementById('sdp-exchange-section').style.display = 'block'

    // Listen for new connections opening (fires for each individual connection)
    libp2pNode.addEventListener('connection:open', (evt) => {
      const connection = evt.detail
      const peerId = connection.remotePeer.toString()
      const peerIdShort = peerId.slice(0, 8) + '...' + peerId.slice(-4)
      const addr = connection.remoteAddr.toString()
      const direction = connection.direction || 'unknown'
      const connId = connection.id || 'unknown'

      // Determine transport type
      const transport = getTransportType(addr)

      // Check if this is a WebRTC upgrade
      const previousTransports = peerTransports.get(peerId)
      const hadWebRTC = previousTransports?.has('webrtc')

      if (transport === 'webrtc' && !hadWebRTC && previousTransports) {
        // WebRTC upgrade happened!
        log(`🎉 WebRTC upgrade! ${peerIdShort} upgraded to direct connection`)
      } else {
        let directionArrow = '•'
        if (direction === 'inbound') {
          directionArrow = '←'
        } else if (direction === 'outbound') {
          directionArrow = '→'
        }
        log(`Connected to ${peerIdShort} via ${transport} ${directionArrow} [${connId.slice(0, 8)}]`)
      }

      // Update transport tracking
      if (!peerTransports.has(peerId)) {
        peerTransports.set(peerId, new Set())
      }
      peerTransports.get(peerId).add(transport)

      updatePeerDisplay(libp2pNode, peerCountEl, peersEl, peerListEl)
    })

    // Listen for individual connection closures
    libp2pNode.addEventListener('connection:close', (evt) => {
      const connection = evt.detail
      const peerId = connection.remotePeer.toString()
      const peerIdShort = peerId.slice(0, 8) + '...' + peerId.slice(-4)
      const addr = connection.remoteAddr.toString()
      const direction = connection.direction || 'unknown'

      // Determine transport type
      const transport = getTransportType(addr)

      let directionArrow = '•'
      if (direction === 'inbound') {
        directionArrow = '←'
      } else if (direction === 'outbound') {
        directionArrow = '→'
      }
      log(`Connection closed: ${peerIdShort} ${transport} ${directionArrow}`)

      updatePeerDisplay(libp2pNode, peerCountEl, peersEl, peerListEl)
    })

    libp2pNode.addEventListener('peer:disconnect', (evt) => {
      const peerId = evt.detail.toString()
      const peerIdShort = peerId.slice(0, 8) + '...' + peerId.slice(-4)

      // Clean up transport tracking
      peerTransports.delete(peerId)

      log(`Fully disconnected from peer: ${peerIdShort}`)
      updatePeerDisplay(libp2pNode, peerCountEl, peersEl, peerListEl)
    })

    // Update multiaddrs when they change (e.g., relay reservation obtained)
    libp2pNode.addEventListener('self:peer:update', () => {
      updateMultiaddrDisplay(libp2pNode, multiaddrsEl, multiaddrSelectEl)
    })

    // Periodically update both multiaddrs AND peer display
    // (to catch any state changes that didn't trigger events)
    const updateInterval = setInterval(() => {
      updateMultiaddrDisplay(libp2pNode, multiaddrsEl, multiaddrSelectEl)
      updatePeerDisplay(libp2pNode, peerCountEl, peersEl, peerListEl)
    }, 2000) // Check every 2 seconds

    // Store interval ID for cleanup
    window.updateInterval = updateInterval
  } catch (err) {
    log(`Error: ${err.message}`, true)

    console.error('Connection error:', err)
    if (connectBtn) {
      connectBtn.disabled = false
    }
    connectionModeEl.textContent = '❌ Connection failed - Please refresh the page'
    connectionModeEl.style.background = '#ffebee'
    connectionModeEl.style.borderColor = '#e57373'
    connectionModeEl.style.color = '#c62828'

    // Clean up on error
    if (libp2pNode) {
      try {
        await libp2pNode.stop()
      } catch (stopErr) {
        console.error('Error stopping libp2p:', stopErr)
      }
      libp2pNode = null
    }
  }
}

// Button handlers
connectBtn.onclick = () => connect()

// Auto-connect on page load
window.addEventListener('DOMContentLoaded', () => {
  // Small delay to ensure all UI elements are ready
  setTimeout(() => {
    connect()
  }, 100)
})

// Manual peer dialing
dialBtn.onclick = async () => {
  if (!libp2pNode) {
    log('Please connect to the network first', true)
    return
  }

  const input = dialPeerInput.value.trim()
  if (!input) {
    log('Please enter a peer ID or multiaddr', true)
    return
  }

  try {
    dialBtn.disabled = true
    log(`Dialing ${input}...`)
    
    // Check if input is a multiaddr (starts with /) or a peer ID
    if (input.startsWith('/')) {
      // It's a multiaddr - wrap it with multiaddr()
      const ma = multiaddr(input)
      await libp2pNode.dial(ma)
      log(`✅ Successfully dialed ${input}`)
    } else {
      // It's a peer ID - need to find the peer's addresses first
      log('Looking up peer addresses...')
      const peerId = peerIdFromString(input)
      const peerInfo = await libp2pNode.peerRouting.findPeer(peerId)
      
      if (!peerInfo || peerInfo.multiaddrs.length === 0) {
        throw new Error('No valid addresses found for peer')
      }
      
      log(`Found ${peerInfo.multiaddrs.length} address(es), dialing...`)
      await libp2pNode.dial(peerInfo.multiaddrs)
      log(`✅ Successfully connected to ${input}`)
    }
    
    dialPeerInput.value = ''
  } catch (err) {
    log(`❌ Failed to dial: ${err.message}`, true)
  } finally {
    dialBtn.disabled = false
  }
}

// SDP Exchange handlers

// Generate offer (Step 1 - Peer A)
generateOfferBtn.onclick = async () => {
  if (!libp2pNode) {
    log('Please connect to the network first', true)
    return
  }

  try {
    generateOfferBtn.disabled = true
    log('🎯 Generating SDP offer...')
    const offerBase64 = await sdpManager.createOffer()
    offerOutputEl.value = offerBase64
    log('✅ Offer generated! Copy and share with the other peer.')
    log(`   Offer size: ${offerBase64.length} characters`)
  } catch (err) {
    log(`❌ Failed to generate offer: ${err.message}`, true)
    console.error('Offer generation error:', err)
  } finally {
    generateOfferBtn.disabled = false
  }
}

// Note: Step 3 (Process Answer) is now automatic - answer is received via data channel

// Generate answer (Step 2 - Peer B)
generateAnswerBtn.onclick = async () => {
  log('🖱️  Button clicked: Connect & Auto-Send Answer')
  
  const offerBase64 = offerInputEl.value.trim()
  if (!offerBase64) {
    log('❌ Please paste an offer first', true)
    return
  }
  
  if (!libp2pNode) {
    log('❌ libp2p node not initialized', true)
    return
  }
  
  if (!sdpManager) {
    log('❌ SDP manager not initialized', true)
    return
  }

  try {
    generateAnswerBtn.disabled = true
    log('🔄 Processing offer and generating answer...')
    log(`   Offer length: ${offerBase64.length} characters`)
    
    const answerBase64 = await sdpManager.createAnswer(offerBase64)
    answerOutputEl.value = answerBase64
    
    log('✅ Answer generated!')
    log(`   Answer length: ${answerBase64.length} characters`)
    log('⏳ Waiting for ICE connection to establish...')
    log('   → Once data channel opens, answer will be sent automatically!')
    log('')
    log('📊 Watch for these events:')
    log('   1. ICE connection state changes')
    log('   2. Data channel opening')
    log('   3. Answer being sent via data channel')
    
    offerInputEl.value = ''
  } catch (err) {
    log(`❌ Failed to generate answer: ${err.message}`, true)
    console.error('Full error:', err)
    console.error('Stack:', err.stack)
  } finally {
    generateAnswerBtn.disabled = false
  }
}

/**
 * Cleanup resources on page unload.
 */
window.addEventListener('beforeunload', async () => {
  try {
    if (sdpManager) {
      sdpManager.destroy()
    }
    if (provider) {
      await provider.destroy()
    }
    if (libp2pNode) {
      await libp2pNode.stop()
    }
  } catch (err) {
    console.error('Cleanup error:', err)
  }
})
