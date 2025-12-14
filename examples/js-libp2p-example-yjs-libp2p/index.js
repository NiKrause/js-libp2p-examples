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

// UI elements (network and logging related)
const topicInput = document.getElementById('topic')
const connectionModeEl = document.getElementById('connection-mode')
const logEl = document.getElementById('log')
const peersEl = document.getElementById('peers-panel')
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
  console.error('❌ Not connected yet. Connection is in progress...')
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

      log(`Found ${bootstrapAddresses.length} relay ${mode} address(es)`)
    } catch (err) {
      log(`⚠️ Failed to fetch relay addresses: ${err.message}`, true)
      // Fallback to hardcoded WebSocket addresses from bootstrappers.js
      bootstrapAddresses = (await import('./bootstrappers.js')).default
      log(`Using ${bootstrapAddresses.length} fallback address(es)`)
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
    connectionModeEl.textContent = '✅ Connected'
    connectionModeEl.style.color = '#4caf50'

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

    log('Ready! Open this page in another tab to collaborate.')

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

    // Show and enable chat panel (sidebar)
    chatPanelEl.style.display = 'flex'
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

/**
 * CSV utility functions
 */

/**
 * Convert spreadsheet data to CSV format
 *
 * @returns {string} CSV formatted string
 */
function exportToCSV () {
  if (!spreadsheetEngine) {
    console.warn('Spreadsheet engine not available')
    return ''
  }

  const allCells = spreadsheetEngine.getAllCells()

  // Find the bounds of the data
  let maxRow = 0
  let maxCol = 0

  for (const coord of allCells.keys()) {
    const { row, col } = parseCoordinate(coord)
    maxRow = Math.max(maxRow, row)
    maxCol = Math.max(maxCol, col)
  }

  if (maxRow === 0 && maxCol === 0) {
    return '' // Empty spreadsheet
  }

  // Build CSV rows
  const rows = []
  for (let row = 1; row <= maxRow; row++) {
    const rowData = []
    for (let col = 1; col <= maxCol; col++) {
      const coord = columnNumberToLetter(col) + row
      const cell = allCells.get(coord)
      let value = ''

      if (cell) {
        // Use display value (calculated result) instead of raw formula
        value = cell.value !== undefined ? String(cell.value) : ''
      }

      // Escape CSV values that contain commas, quotes, or newlines
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        value = '"' + value.replace(/"/g, '""') + '"'
      }

      rowData.push(value)
    }
    rows.push(rowData.join(','))
  }

  return rows.join('\n')
}

/**
 * Parse CSV content and import it to the spreadsheet
 *
 * @param {string} csvContent - CSV formatted string
 */
function importFromCSV (csvContent) {
  if (!spreadsheetEngine) {
    console.warn('Spreadsheet engine not available')
    return
  }

  if (!csvContent.trim()) {
    return
  }

  // Simple CSV parser (handles quoted fields with commas)
  const rows = []
  const lines = csvContent.split('\n')

  for (const line of lines) {
    if (!line.trim()) { continue }

    const row = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const char = line[i]

      if (char === '"' && !inQuotes) {
        inQuotes = true
      } else if (char === '"' && inQuotes) {
        if (line[i + 1] === '"') {
          // Escaped quote
          current += '"'
          i++ // Skip next quote
        } else {
          inQuotes = false
        }
      } else if (char === ',' && !inQuotes) {
        row.push(current)
        current = ''
      } else {
        current += char
      }
    }
    row.push(current) // Add final cell
    rows.push(row)
  }

  // Import the data
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const rowData = rows[rowIndex]
    for (let colIndex = 0; colIndex < rowData.length; colIndex++) {
      const value = rowData[colIndex].trim()
      if (value) {
        const coord = columnNumberToLetter(colIndex + 1) + (rowIndex + 1)
        spreadsheetEngine.setCell(coord, value)
      }
    }
  }

  log(`Imported ${rows.length} rows from CSV`)
}

/**
 * Copy CSV to clipboard
 */
async function copyCSVToClipboard () {
  const csvContent = exportToCSV()
  if (!csvContent) {
    log('No data to copy')
    return
  }

  try {
    await navigator.clipboard.writeText(csvContent)
    log('CSV data copied to clipboard')

    // Visual feedback
    const copyBtn = document.getElementById('csv-copy-btn')
    if (copyBtn) {
      const originalText = copyBtn.textContent
      copyBtn.textContent = '✅ Copied!'
      setTimeout(() => {
        copyBtn.textContent = originalText
      }, 2000)
    }
  } catch (err) {
    console.error('Failed to copy to clipboard:', err)
    log('Failed to copy to clipboard. Try selecting and copying manually.')
  }
}

/**
 * Download CSV file
 */
function downloadCSV () {
  const csvContent = exportToCSV()
  if (!csvContent) {
    log('No data to export')
    return
  }

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')

  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `spreadsheet-${new Date().toISOString().slice(0, 10)}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }
}

/**
 * Utility function to convert column number to letter (1 -> A, 2 -> B, etc.)
 *
 * @param num
 */
function columnNumberToLetter (num) {
  let result = ''
  while (num > 0) {
    num--
    result = String.fromCharCode(65 + (num % 26)) + result
    num = Math.floor(num / 26)
  }
  return result
}

/**
 * Parse coordinate like "A1" to {row: 1, col: 1}
 *
 * @param coord
 */
function parseCoordinate (coord) {
  const match = coord.match(/^([A-Z]+)(\d+)$/)
  if (!match) { return { row: 0, col: 0 } }

  const colStr = match[1]
  const row = parseInt(match[2])

  let col = 0
  for (let i = 0; i < colStr.length; i++) {
    col = col * 26 + (colStr.charCodeAt(i) - 64)
  }

  return { row, col }
}

/**
 * Set up CSV control event listeners
 */
function setupCSVControls () {
  const csvDownloadBtn = document.getElementById('csv-download-btn')
  const csvCopyBtn = document.getElementById('csv-copy-btn')
  const csvUploadBtn = document.getElementById('csv-upload-btn')
  const csvUploadInput = document.getElementById('csv-upload-input')
  const csvPasteToggle = document.getElementById('csv-paste-toggle')
  const csvPasteArea = document.getElementById('csv-paste-area')
  const csvPasteInput = document.getElementById('csv-paste-input')
  const csvImportBtn = document.getElementById('csv-import-btn')
  const csvClearBtn = document.getElementById('csv-clear-btn')

  // Download CSV
  csvDownloadBtn.addEventListener('click', downloadCSV)

  // Copy CSV to clipboard
  csvCopyBtn.addEventListener('click', copyCSVToClipboard)

  // Upload CSV file
  csvUploadBtn.addEventListener('click', () => {
    csvUploadInput.click()
  })

  csvUploadInput.addEventListener('change', (event) => {
    const file = event.target.files[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        importFromCSV(e.target.result)
      }
      reader.readAsText(file)
      // Reset input so same file can be selected again
      event.target.value = ''
    }
  })

  // Toggle paste area
  csvPasteToggle.addEventListener('click', () => {
    const isHidden = csvPasteArea.style.display === 'none'
    csvPasteArea.style.display = isHidden ? 'block' : 'none'
    csvPasteToggle.textContent = isHidden ? '📋 Hide Paste' : '📋 Paste CSV'
  })

  // Import from paste area
  csvImportBtn.addEventListener('click', () => {
    const content = csvPasteInput.value
    if (content.trim()) {
      importFromCSV(content)
      csvPasteInput.value = ''
      csvPasteArea.style.display = 'none'
      csvPasteToggle.textContent = '📋 Paste CSV'
    }
  })

  // Clear paste area
  csvClearBtn.addEventListener('click', () => {
    csvPasteInput.value = ''
  })
}

// Make setupCSVControls available globally for the spreadsheet UI
window.setupCSVControls = setupCSVControls

// Auto-connect on page load with WebRTC mode (default)
// Small delay to allow topic to be set programmatically for tests
setTimeout(() => {
  if (!libp2pNode) {
    connectWithTransports('webrtc')
  }
}, 100)

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
