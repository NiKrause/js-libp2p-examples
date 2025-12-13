/* eslint-disable no-console */

import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { autoNAT } from '@libp2p/autonat'
import { bootstrap } from '@libp2p/bootstrap'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { dcutr } from '@libp2p/dcutr'
import { gossipsub } from '@libp2p/gossipsub'
import { identify, identifyPush } from '@libp2p/identify'
import { kadDHT, removePrivateAddressesMapper } from '@libp2p/kad-dht'
import { ping } from '@libp2p/ping'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { createLibp2p } from 'libp2p'
import * as Y from 'yjs'
import { DEBUG, TIMEOUTS, INTERVALS, UC_CHAT_TOPIC, UC_FILE_TOPIC, DISCOVERY_CONFIG } from './constants.js'
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
import { UCExtensionAdapter } from './uc-extension-adapter.js'

// UI elements (network and logging related)
const topicInput = document.getElementById('topic')
const connectWebRTCBtn = document.getElementById('connect-webrtc')
const connectWebSocketBtn = document.getElementById('connect-websocket')
const connectionModeEl = document.getElementById('connection-mode')
const logEl = document.getElementById('log')
const peersEl = document.getElementById('peers')
const peerCountEl = document.getElementById('peer-count')
const peerListEl = document.getElementById('peer-list')
const multiaddrsEl = document.getElementById('multiaddrs')
const multiaddrSelectEl = document.getElementById('multiaddr-select')
const peerIdDisplayEl = document.getElementById('peer-id-display')
const peerIdValueEl = document.getElementById('peer-id-value')
const chatPanelEl = document.getElementById('chat-panel')
const chatMessagesEl = document.getElementById('chat-messages')
const chatMessageInputEl = document.getElementById('chat-message-input')
const chatSendButtonEl = document.getElementById('chat-send-button')

let libp2pNode
let yjsDoc
let provider
let spreadsheetEngine
let spreadsheetUI
let ucExtensionAdapter

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

/**
 * Displays a chat message in the chat panel.
 *
 * @param {string} text - Message text
 * @param {boolean} [isSent] - Whether this is a sent message (true) or received (false)
 */
const displayChatMessage = (text, isSent = false) => {
  const messageEl = document.createElement('div')
  messageEl.className = `chat-message ${isSent ? 'sent' : 'received'}`

  const headerEl = document.createElement('div')
  headerEl.className = 'chat-message-header'
  headerEl.textContent = isSent ? '📤 You' : '📥 Peer'

  const textEl = document.createElement('div')
  textEl.className = 'chat-message-text'
  textEl.textContent = text

  messageEl.appendChild(headerEl)
  messageEl.appendChild(textEl)
  chatMessagesEl.appendChild(messageEl)

  // Scroll to latest message
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight
}

// Initial stub - will be replaced when connected
window.sendMessage = async (text, topic) => {
  console.error('❌ Not connected yet. Please click "Connect" first.')
}

// Connect function with bootstrap address selection
async function connectWithTransports (mode = 'webrtc') {
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
    connectWebRTCBtn.disabled = true
    connectWebSocketBtn.disabled = true

    // Show connection mode
    connectionModeEl.textContent = mode === 'webrtc'
      ? '🔄 Fetching relay WebRTC-Direct addresses...'
      : '🔄 Fetching relay WebSocket addresses...'

    // Fetch relay addresses dynamically
    let bootstrapAddresses = []
    try {
      const response = await fetch('http://localhost:9094/api/addresses')
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      const addresses = await response.json()

      if (mode === 'webrtc') {
        bootstrapAddresses = addresses.webrtcDirect
      } else {
        bootstrapAddresses = addresses.websocket
      }

      if (bootstrapAddresses.length === 0) {
        throw new Error(`No ${mode} addresses available from relay`)
      }

      log(`Found ${bootstrapAddresses.length} relay ${mode} address(es) from local API:`)
      bootstrapAddresses.forEach((addr, i) => {
        log(`  [${i + 1}] ${addr}`)
      })
    } catch (err) {
      log(`⚠️ Failed to fetch relay addresses: ${err.message}`, true)
      // Fallback to hardcoded addresses from bootstrappers.js
      bootstrapAddresses = (await import('./bootstrappers.js')).default
      const envMode = import.meta.env.DEV ? 'DEV' : 'PROD'
      log(`Using ${envMode} fallback with ${bootstrapAddresses.length} address(es):`)
      bootstrapAddresses.forEach((addr, i) => {
        log(`  [${i + 1}] ${addr}`)
      })
    }

    connectionModeEl.textContent = mode === 'webrtc'
      ? '🔄 Connecting via WebRTC-Direct...'
      : '🔄 Connecting via WebSocket...'

    // ALWAYS include ALL transports (never disable any)
    const transports = [
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
          iceServers: [{
            urls: [
              'stun:stun.l.google.com:19302',
              'stun:global.stun.twilio.com:3478'
            ]
          }]
        }
      }),
      circuitRelayTransport({
        reservationCompletionTimeout: TIMEOUTS.RELAY_CONNECTION
      })
    ]

    // Create libp2p node with ALL transports always enabled
    libp2pNode = await createLibp2p({
      addresses: {
        listen: ['/p2p-circuit', '/webrtc']
      },
      transports,
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
        bootstrap({
          list: bootstrapAddresses  // Use dynamically fetched addresses
        }),
        pubsubPeerDiscovery({
          topics: DISCOVERY_CONFIG.TOPICS,
          interval: INTERVALS.PUBSUB_PEER_DISCOVERY
        })
      ],
      services: {
        identify: identify(),
        identifyPush: identifyPush(),
        autoNAT: autoNAT(),
        dcutr: dcutr(),  // Enable DCUTR for automatic relay → direct WebRTC upgrades
        ping: ping(),
        pubsub: gossipsub({
          emitSelf: false,
          allowPublishToZeroTopicPeers: true
        }),
        dht: kadDHT({
          protocol: '/ipfs/kad/1.0.0',  // Amino DHT protocol for UC interop
          peerInfoMapper: removePrivateAddressesMapper
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
    connectionModeEl.textContent = mode === 'webrtc'
      ? '✅ Bootstrap: WebRTC-Direct (all transports active)'
      : '✅ Bootstrap: WebSocket (all transports active)'
    connectionModeEl.style.color = '#4caf50'

    // Create Yjs document and spreadsheet engine
    yjsDoc = new Y.Doc()
    spreadsheetEngine = new SpreadsheetEngine(yjsDoc)

    // Set up Yjs provider with libp2p
    provider = new Libp2pProvider(topic, yjsDoc, libp2pNode)

    // Create and initialize spreadsheet UI
    spreadsheetUI = new SpreadsheetUI(spreadsheetEngine)
    spreadsheetUI.initialize()

    // Initialize UC Extension Adapter
    ucExtensionAdapter = new UCExtensionAdapter(libp2pNode, spreadsheetEngine, topic)
    await ucExtensionAdapter.start()

    // Expose for testing
    window.spreadsheetUI = spreadsheetUI
    window.ucExtensionAdapter = ucExtensionAdapter

    log('Ready! Open this page in another tab to collaborate.')
    log('UC Extension: Spreadsheet is now available as UC extension')

    // Expose sendMessage function to console
    // Publishes to UC chat topic with UC-compatible format (raw text only)
    window.sendMessage = async (text) => {
      if (!libp2pNode) {
        console.error('❌ Not connected yet')
        return
      }
      if (!text) {
        console.error('❌ Message text required')
        return
      }
      try {
        // UC chat message format: raw text only (peerId comes from gossipsub event)
        const encoder = new TextEncoder()
        const bytes = encoder.encode(text)
        await libp2pNode.services.pubsub.publish(UC_CHAT_TOPIC, bytes)
        // Display message immediately in chat
        displayChatMessage(text, true)
        console.log(`✅ Message sent to UC topic "${UC_CHAT_TOPIC}": "${text}"`)
      } catch (err) {
        console.error(`❌ Failed to send: ${err.message}`)
      }
    }

    // Initial display updates
    updatePeerDisplay(libp2pNode, peerCountEl, peersEl, peerListEl)
    updateMultiaddrDisplay(libp2pNode, multiaddrsEl, multiaddrSelectEl)

    // Show and enable chat panel (accordion)
    chatPanelEl.style.display = 'block'
    chatMessageInputEl.disabled = false
    chatSendButtonEl.disabled = false

    // Listen for ALL incoming pubsub messages for debugging
    libp2pNode.services.pubsub.addEventListener('message', (event) => {
      const incomingTopic = event.detail.topic
      const fromPeer = event.detail.from?.toString() || 'unknown'
      const fromShort = fromPeer.slice(0, 8) + '...' + fromPeer.slice(-4)

      console.log(`📨 Pubsub [${incomingTopic}] from ${fromShort}:`, {
        topic: incomingTopic,
        from: fromPeer,
        dataLength: event.detail.data?.length
      })

      // Try to decode and log the message content
      try {
        const decoder = new TextDecoder()
        const messageText = decoder.decode(event.detail.data)

        // Handle UC chat messages (raw text format)
        if (incomingTopic === UC_CHAT_TOPIC) {
          console.log(`   💬 UC Chat: ${messageText}`)
          displayChatMessage(`[${fromShort}] ${messageText}`, false)
        } else {
          // Try to parse as JSON for other topics
          try {
            const messageObj = JSON.parse(messageText)
            console.log('   📦 JSON:', messageObj)
          } catch {
            // Not JSON, log raw text (truncated)
            const preview = messageText.length > 100 ? messageText.slice(0, 100) + '...' : messageText
            console.log(`   📝 Text: ${preview}`)
          }
        }
      } catch (err) {
        console.log(`   ⚠️ Binary data (${event.detail.data?.length} bytes)`)
      }
    })

    // Subscribe to the Yjs document topic to receive messages
    libp2pNode.services.pubsub.subscribe(topic)

    // Subscribe to Universal Connectivity topics for interop
    libp2pNode.services.pubsub.subscribe(UC_CHAT_TOPIC)
    libp2pNode.services.pubsub.subscribe(UC_FILE_TOPIC)
    log(`Subscribed to UC topics: ${UC_CHAT_TOPIC}, ${UC_FILE_TOPIC}`)

    // Log all subscribed topics (including peer discovery)
    setTimeout(() => {
      const topics = libp2pNode.services.pubsub.getTopics()
      console.log('📋 All subscribed PubSub topics:', topics)
      log(`PubSub topics: ${topics.join(', ')}`)
    }, 2000)

    // Listen for subscription changes from other peers
    libp2pNode.services.pubsub.addEventListener('subscription-change', (evt) => {
      const peerId = evt.detail.peerId.toString()
      const peerIdShort = peerId.slice(0, 8) + '...' + peerId.slice(-4)
      const subscriptions = evt.detail.subscriptions

      console.log(`🔔 Subscription change from ${peerIdShort}:`, subscriptions)

      for (const sub of subscriptions) {
        const action = sub.subscribe ? '✅ subscribed to' : '❌ unsubscribed from'
        console.log(`   ${action} "${sub.topic}"`)
        log(`${peerIdShort} ${action} ${sub.topic}`)
      }
    })

    // Send message from input field
    chatSendButtonEl.onclick = async () => {
      const text = chatMessageInputEl.value.trim()
      if (text) {
        await window.sendMessage(text)
        chatMessageInputEl.value = ''
      }
    }

    // Send message on Enter key
    chatMessageInputEl.onkeypress = async (e) => {
      if (e.key === 'Enter') {
        const text = chatMessageInputEl.value.trim()
        if (text) {
          await window.sendMessage(text)
          chatMessageInputEl.value = ''
        }
      }
    }

    // Auto-dial discovered peers
    libp2pNode.addEventListener('peer:discovery', async (evt) => {
      const peerInfo = evt.detail
      const peerId = peerInfo.id
      const peerIdStr = peerId.toString()
      const peerIdShort = peerIdStr.slice(0, 8) + '...' + peerIdStr.slice(-4)

      // Log discovered peer with multiaddrs
      const multiaddrs = peerInfo.multiaddrs || []
      console.log(`🔍 Peer discovered: ${peerIdShort}`, {
        peerId: peerIdStr,
        multiaddrs: multiaddrs.map(ma => ma.toString())
      })
      log(`🔍 Discovered: ${peerIdShort} (${multiaddrs.length} addrs)`)

      if (libp2pNode.getConnections(peerId).length > 0) {
        console.log(`⏭️ Already connected to ${peerIdShort}`)
        return
      }

      // Log dialing attempt
      log(`📞 Dialing: ${peerIdShort}...`)
      console.log(`📞 Dialing ${peerIdShort} with ${multiaddrs.length} multiaddrs...`)

      try {
        await libp2pNode.dial(peerId)
        log(`✅ Dialed: ${peerIdShort}`)
        console.log(`✅ Successfully dialed ${peerIdShort}`)
      } catch (err) {
        log(`❌ Dial failed: ${peerIdShort} - ${err.message}`)
        console.log(`❌ Failed to dial ${peerIdShort}: ${err.message}`)
      }
    })

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
    connectWebRTCBtn.disabled = false
    connectWebSocketBtn.disabled = false
    connectionModeEl.textContent = `❌ Connection failed (${mode} mode)`
    connectionModeEl.style.color = '#d32f2f'

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

// Button handlers - specify bootstrap mode
connectWebRTCBtn.onclick = () => connectWithTransports('webrtc')
connectWebSocketBtn.onclick = () => connectWithTransports('websocket')

/**
 * Cleanup resources on page unload.
 */
window.addEventListener('beforeunload', async () => {
  try {
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
