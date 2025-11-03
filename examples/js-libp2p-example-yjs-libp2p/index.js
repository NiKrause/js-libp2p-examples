/* eslint-disable no-console */

import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { autoNAT } from '@libp2p/autonat'
import { bootstrap } from '@libp2p/bootstrap'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { dcutr } from '@libp2p/dcutr'
import { gossipsub } from '@libp2p/gossipsub'
import { identify, identifyPush } from '@libp2p/identify'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { createLibp2p } from 'libp2p'
import * as Y from 'yjs'
import { DEBUG, TIMEOUTS, INTERVALS } from './constants.js'
import { webrtcPeerExchange } from './peer-exchange.js'
import {
  SpreadsheetEngine,
  SpreadsheetUI
} from './spreadsheet-engine.js'
import { Libp2pProvider } from './yjs-libp2p-provider.js'

// UI elements (network and logging related)
const topicInput = document.getElementById('topic')
const connectWebRTCBtn = document.getElementById('connect-webrtc')
const connectWebSocketBtn = document.getElementById('connect-websocket')
const connectionModeEl = document.getElementById('connection-mode')
const logEl = document.getElementById('log')
const peersEl = document.getElementById('peers')
const peerCountEl = document.getElementById('peer-count')
const peerListEl = document.getElementById('peer-list')
const debugConnectionsBtn = document.getElementById('debug-connections')
const multiaddrsEl = document.getElementById('multiaddrs')
const multiaddrSelectEl = document.getElementById('multiaddr-select')
const peerIdDisplayEl = document.getElementById('peer-id-display')
const peerIdValueEl = document.getElementById('peer-id-value')

let libp2pNode
let yjsDoc
let provider
let spreadsheetEngine
let spreadsheetUI

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
 * Updates the multiaddress display with current addresses.
 */
const updateMultiaddrDisplay = () => {
  if (!libp2pNode) {
    return
  }

  const multiaddrs = libp2pNode.getMultiaddrs()

  // Always show the section, even if empty
  multiaddrsEl.style.display = 'block'

  if (multiaddrs.length > 0) {
    multiaddrSelectEl.innerHTML = ''
    for (const ma of multiaddrs) {
      const option = document.createElement('option')
      const maStr = ma.toString()

      // Add label for relay addresses
      if (maStr.includes('/p2p-circuit')) {
        option.textContent = `${maStr} (relay)`
      } else if (maStr.includes('/webrtc')) {
        option.textContent = `${maStr} (WebRTC)`
      } else if (maStr.includes('/ws')) {
        option.textContent = `${maStr} (WebSocket)`
      } else {
        option.textContent = maStr
      }

      multiaddrSelectEl.appendChild(option)
    }
  } else {
    // Show message when no addresses yet
    multiaddrSelectEl.innerHTML = '<option disabled>Waiting for addresses (relay reservation in progress...)</option>'
  }
}

/**
 * Debug function to log all current connections in detail.
 */
const debugConnections = () => {
  if (!libp2pNode) {
    log('No libp2p node active')
    return
  }

  const connections = libp2pNode.getConnections()
  log(`=== DEBUG: ${connections.length} total connection(s) ===`)
  
  const peerMap = new Map()
  
  for (const conn of connections) {
    const peerId = conn.remotePeer.toString()
    const peerIdShort = peerId.slice(0, 8) + '...' + peerId.slice(-4)
    
    if (!peerMap.has(peerId)) {
      peerMap.set(peerId, [])
    }
    
    const addr = conn.remoteAddr.toString()
    const direction = conn.direction || 'unknown'
    const status = conn.status || 'unknown'
    const connId = conn.id ? conn.id.slice(0, 8) : 'unknown'
    
    // Determine transport
    let transport = 'unknown'
    if (addr.includes('/p2p-circuit')) {
      transport = 'relay'
    } else if (addr.includes('/webrtc')) {
      transport = 'webrtc'
    } else if (addr.includes('/ws')) {
      transport = 'websocket'
    }
    
    peerMap.get(peerId).push({ transport, direction, status, connId, addr })
  }
  
  for (const [peerId, conns] of peerMap) {
    const peerIdShort = peerId.slice(0, 8) + '...' + peerId.slice(-4)
    log(`Peer: ${peerIdShort}`)
    conns.forEach((conn, idx) => {
      const arrow = conn.direction === 'inbound' ? '←' : conn.direction === 'outbound' ? '→' : '•'
      log(`  ${idx + 1}. ${conn.transport} ${arrow} [${conn.connId}] ${conn.status}`)
      if (DEBUG) {
        console.log(`     ${conn.addr}`)
      }
    })
  }
  
  log('=== END DEBUG ===')
}

/**
 * Updates the peer display UI with current connections.
 */
const updatePeerDisplay = () => {
  if (!libp2pNode) {
    return
  }

  const connections = libp2pNode.getConnections()
  const peerMap = new Map()

  // Group connections by peer
  for (const conn of connections) {
    const peerId = conn.remotePeer.toString()
    if (!peerMap.has(peerId)) {
      peerMap.set(peerId, [])
    }

    const remoteAddr = conn.remoteAddr.toString()
    let transport = 'unknown'

    // Check relay FIRST - relay connections can contain /webrtc in their path after /p2p-circuit
    if (remoteAddr.includes('/p2p-circuit')) {
      transport = 'relay'
    } else if (remoteAddr.includes('/webrtc')) {
      // Direct WebRTC connection (not relayed)
      transport = 'webrtc'
    } else if (remoteAddr.includes('/wss') || remoteAddr.includes('/tls/ws')) {
      transport = 'websocket-secure'
    } else if (remoteAddr.includes('/ws')) {
      transport = 'websocket'
    }

    // Gather connection metadata for tooltip
    const direction = conn.direction || 'unknown'
    const status = conn.status || 'unknown'
    const timeline = conn.timeline || {}
    const connId = conn.id || 'unknown'

    peerMap.get(peerId).push({ 
      transport, 
      addr: remoteAddr, 
      direction, 
      status,
      connId,
      timeline
    })
  }

  // Update count
  peerCountEl.textContent = peerMap.size

  // Show/hide peers section
  if (peerMap.size > 0) {
    peersEl.style.display = 'block'
  } else {
    peersEl.style.display = 'none'
  }

  // Update peer list
  peerListEl.innerHTML = ''
  for (const [peerId, transports] of peerMap) {
    const peerDiv = document.createElement('div')
    peerDiv.className = 'peer'

    const peerIdSpan = document.createElement('div')
    peerIdSpan.className = 'peer-id'
    peerIdSpan.textContent = `${peerId.slice(0, 8)}...${peerId.slice(-4)}`
    peerIdSpan.title = peerId // Full peer ID on hover
    peerDiv.appendChild(peerIdSpan)

    const transportDiv = document.createElement('div')

    // Group identical transport+direction combinations and count them
    const transportGroups = new Map()
    for (const conn of transports) {
      const key = `${conn.transport}-${conn.direction}`
      if (!transportGroups.has(key)) {
        transportGroups.set(key, [])
      }
      transportGroups.get(key).push(conn)
    }

    // Show each unique transport+direction with count
    for (const [key, conns] of transportGroups) {
      const { transport, direction } = conns[0]
      const badge = document.createElement('span')
      badge.className = `transport ${transport}`
      
      // Add direction indicator to badge text
      const directionIcon = direction === 'inbound' ? '←' : direction === 'outbound' ? '→' : '•'
      const countText = conns.length > 1 ? ` ×${conns.length}` : ''
      badge.textContent = `${transport} ${directionIcon}${countText}`
      
      // Enhanced tooltip with connection details for all connections in this group
      const tooltipLines = [`${transport} (${direction}) - ${conns.length} connection(s)`, '']
      conns.forEach((conn, idx) => {
        tooltipLines.push(`Connection ${idx + 1}:`)
        tooltipLines.push(`  Address: ${conn.addr}`)
        tooltipLines.push(`  Status: ${conn.status}`)
        tooltipLines.push(`  ID: ${conn.connId}`)
        tooltipLines.push('')
      })
      badge.title = tooltipLines.join('\n')
      
      transportDiv.appendChild(badge)
    }

    peerDiv.appendChild(transportDiv)

    peerListEl.appendChild(peerDiv)
  }
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
      log('Fetching relay addresses from HTTP API...')
      const response = await fetch('http://localhost:9094/api/addresses')
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      const addresses = await response.json()

      if (mode === 'webrtc') {
        bootstrapAddresses = addresses.webrtcDirect
        log(`Found ${bootstrapAddresses.length} WebRTC-Direct address(es)`)
      } else {
        bootstrapAddresses = addresses.websocket
        log(`Found ${bootstrapAddresses.length} WebSocket address(es)`)
      }

      if (bootstrapAddresses.length === 0) {
        throw new Error(`No ${mode} addresses available from relay`)
      }

      // Log the addresses we'll use
      bootstrapAddresses.forEach(addr => {
        log(`  → ${addr}`)
      })
    } catch (err) {
      log(`⚠️ Failed to fetch relay addresses: ${err.message}`, true)
      // Fallback to hardcoded WebSocket addresses from bootstrappers.js
      bootstrapAddresses = (await import('./bootstrappers.js')).default
      log(`Using fallback addresses (${bootstrapAddresses.length} address(es))`)
    }

    connectionModeEl.textContent = mode === 'webrtc'
      ? '🔄 Connecting via WebRTC-Direct...'
      : '🔄 Connecting via WebSocket...'
    log('Creating libp2p node...')

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
          iceServers: [
            { urls: ['stun:stun.l.google.com:19302'] },
            { urls: ['stun:stun1.l.google.com:19302'] }
          ]
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
          interval: INTERVALS.PUBSUB_PEER_DISCOVERY
        })
      ],
      services: {
        identify: identify(),
        identifyPush: identifyPush(),
        autoNAT: autoNAT(),
        dcutr: dcutr(),  // Enable DCUTR for automatic relay → direct WebRTC upgrades
        pubsub: gossipsub({
          emitSelf: false,
          allowPublishToZeroTopicPeers: true
        }),
        webrtcPeerExchange: webrtcPeerExchange({
          enabled: true,  // Always enabled
          debug: DEBUG
        })
      }
    })

    const peerIdStr = libp2pNode.peerId.toString()

    // Display peer ID at the top
    peerIdValueEl.textContent = peerIdStr
    peerIdDisplayEl.style.display = 'block'

    log(
      `libp2p node created with id: ${peerIdStr.slice(0, 8)}...${peerIdStr.slice(-4)}`
    )
    log(`Connecting to bootstrap relay via ${mode === 'webrtc' ? 'WebRTC-Direct' : 'WebSocket'}...`)

    // Expose for testing
    window.libp2pNode = libp2pNode

    log('📡 Peer exchange service enabled (all transports active)')

    // Update connection mode display
    connectionModeEl.textContent = mode === 'webrtc'
      ? '✅ Bootstrap: WebRTC-Direct (all transports active)'
      : '✅ Bootstrap: WebSocket (all transports active)'
    connectionModeEl.style.color = '#4caf50'

    // Create Yjs document and spreadsheet engine
    yjsDoc = new Y.Doc()
    spreadsheetEngine = new SpreadsheetEngine(yjsDoc)

    // Set up Yjs provider with libp2p
    log(`Setting up Yjs provider with topic: ${topic}`)
    provider = new Libp2pProvider(topic, yjsDoc, libp2pNode)

    // Create and initialize spreadsheet UI
    spreadsheetUI = new SpreadsheetUI(spreadsheetEngine)
    spreadsheetUI.initialize()

    // Expose for testing
    window.spreadsheetUI = spreadsheetUI

    log(
      'Ready! Open this page in another browser tab or window to collaborate.'
    )

    // Initial display updates
    updatePeerDisplay()
    updateMultiaddrDisplay()

    // Auto-dial discovered peers
    libp2pNode.addEventListener('peer:discovery', async (evt) => {
      const peerId = evt.detail.id

      if (libp2pNode.getConnections(peerId).length > 0) {
        return
      }

      try {
        await libp2pNode.dial(peerId)
        if (DEBUG) {
          log(`Connected to peer: ${peerId.toString().slice(0, 8)}...${peerId.toString().slice(-4)}`)
        }
      } catch (err) {
        if (DEBUG) {
          console.log('Dial failed:', err.message)
        }
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

      // Determine transport type (check relay FIRST)
      let transport = 'unknown'
      if (addr.includes('/p2p-circuit')) {
        transport = 'relay'
      } else if (addr.includes('/webrtc')) {
        transport = 'webrtc'
      } else if (addr.includes('/wss') || addr.includes('/tls/ws')) {
        transport = 'websocket-secure'
      } else if (addr.includes('/ws')) {
        transport = 'websocket'
      }

      // Check if this is a WebRTC upgrade
      const previousTransports = peerTransports.get(peerId)
      const hadWebRTC = previousTransports?.has('webrtc')

      if (transport === 'webrtc' && !hadWebRTC && previousTransports) {
        // WebRTC upgrade happened!
        log(`🎉 WebRTC upgrade! ${peerIdShort} upgraded to direct connection`)
      } else {
        const directionArrow = direction === 'inbound' ? '←' : direction === 'outbound' ? '→' : '•'
        log(`Connected to ${peerIdShort} via ${transport} ${directionArrow} [${connId.slice(0, 8)}]`)
      }

      // Update transport tracking
      if (!peerTransports.has(peerId)) {
        peerTransports.set(peerId, new Set())
      }
      peerTransports.get(peerId).add(transport)

      // Peer exchange is now handled automatically by the webrtcPeerExchange service

      // Log full details in debug mode
      if (DEBUG) {
        console.log(`  Connection opened:`)
        console.log(`    Address: ${addr}`)
        console.log(`    Direction: ${direction}`)
        console.log(`    Connection ID: ${connId}`)
        console.log(`    Status: ${connection.status}`)
      }

      updatePeerDisplay()
    })

    // Listen for individual connection closures
    libp2pNode.addEventListener('connection:close', (evt) => {
      const connection = evt.detail
      const peerId = connection.remotePeer.toString()
      const peerIdShort = peerId.slice(0, 8) + '...' + peerId.slice(-4)
      const addr = connection.remoteAddr.toString()
      const direction = connection.direction || 'unknown'
      
      // Determine transport type
      let transport = 'unknown'
      if (addr.includes('/p2p-circuit')) {
        transport = 'relay'
      } else if (addr.includes('/webrtc')) {
        transport = 'webrtc'
      } else if (addr.includes('/ws')) {
        transport = 'websocket'
      }
      
      const directionArrow = direction === 'inbound' ? '←' : direction === 'outbound' ? '→' : '•'
      log(`Connection closed: ${peerIdShort} ${transport} ${directionArrow}`)
      
      updatePeerDisplay()
    })

    libp2pNode.addEventListener('peer:disconnect', (evt) => {
      const peerId = evt.detail.toString()
      const peerIdShort = peerId.slice(0, 8) + '...' + peerId.slice(-4)

      // Clean up transport tracking
      peerTransports.delete(peerId)

      log(`Fully disconnected from peer: ${peerIdShort}`)
      updatePeerDisplay()
    })

    // Update multiaddrs when they change (e.g., relay reservation obtained)
    libp2pNode.addEventListener('self:peer:update', () => {
      updateMultiaddrDisplay()
      if (DEBUG) {
        log('Multiaddrs updated')
      }
    })

    // Periodically update both multiaddrs AND peer display
    // (to catch any state changes that didn't trigger events)
    const updateInterval = setInterval(() => {
      updateMultiaddrDisplay()
      updatePeerDisplay()
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

// Debug button handler
debugConnectionsBtn.onclick = () => {
  debugConnections()
  updatePeerDisplay()
  updateMultiaddrDisplay()
}

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
