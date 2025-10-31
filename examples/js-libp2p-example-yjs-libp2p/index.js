/* eslint-disable no-console */

// Using floodsub instead of gossipsub due to multiaddr.tuples() compatibility issues
// with gossipsub v14.x and multiaddr v13.x at the time of writing (2025-01)
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { autoNAT } from '@libp2p/autonat'
import { bootstrap } from '@libp2p/bootstrap'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { dcutr } from '@libp2p/dcutr'
import { floodsub } from '@libp2p/floodsub'
import { identify, identifyPush } from '@libp2p/identify'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p } from 'libp2p'
import * as Y from 'yjs'
import bootstrappers from './bootstrappers.js'
import { DEBUG, TIMEOUTS, INTERVALS } from './constants.js'
import {
  SpreadsheetEngine,
  coordToA1,
  a1ToCoord
} from './spreadsheet-engine.js'
import { Libp2pProvider } from './yjs-libp2p-provider.js'

// UI elements
const topicInput = document.getElementById('topic')
const connectBtn = document.getElementById('connect')
const logEl = document.getElementById('log')
const peersEl = document.getElementById('peers')
const peerCountEl = document.getElementById('peer-count')
const peerListEl = document.getElementById('peer-list')
const spreadsheetEl = document.getElementById('spreadsheet')
const formulaInput = document.getElementById('formula-input')
const cellRefEl = document.getElementById('cell-ref')
const formulaBar = document.getElementById('formula-bar')
const spreadsheetContainer = document.getElementById('spreadsheet-container')
const examplesEl = document.getElementById('examples')
const multiaddrsEl = document.getElementById('multiaddrs')
const multiaddrListEl = document.getElementById('multiaddr-list')

let libp2pNode
let yjsDoc
let provider
let spreadsheetEngine
let currentCell = null
const gridSize = { rows: 10, cols: 8 } // Start with 10x8 grid

/**
 * Logs a message to both console and UI.
 *
 * @param {string} message - Message to log
 * @param {boolean} [isError] - Whether this is an error message
 */
const log = (message, isError = false) => {
  if (DEBUG) {
    console.log(message)
  }
  logEl.textContent += message + '\n'
  logEl.scrollTop = logEl.scrollHeight

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
    multiaddrListEl.innerHTML = ''
    for (const ma of multiaddrs) {
      const li = document.createElement('li')
      const maStr = ma.toString()

      // Highlight relay addresses
      if (maStr.includes('/p2p-circuit')) {
        li.style.color = '#1565c0'
        li.style.fontWeight = '600'
        li.textContent = `${maStr} (relay reservation)`
      } else {
        li.textContent = maStr
      }

      multiaddrListEl.appendChild(li)
    }
  } else {
    // Show message when no addresses yet
    multiaddrListEl.innerHTML = "<li style='color: #666; font-style: italic;'>Waiting for addresses (relay reservation in progress...)</li>"
  }
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

    if (remoteAddr.includes('/p2p-circuit')) {
      transport = 'relay'
    } else if (remoteAddr.includes('/webrtc')) {
      transport = 'webrtc'
    } else if (remoteAddr.includes('/wss') || remoteAddr.includes('/tls/ws')) {
      transport = 'websocket-secure'
    } else if (remoteAddr.includes('/ws')) {
      transport = 'websocket'
    }

    peerMap.get(peerId).push({ transport, addr: remoteAddr })
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

    // Show each connection with its transport
    for (const { transport, addr } of transports) {
      const badge = document.createElement('span')
      badge.className = `transport ${transport}`
      badge.textContent = transport
      badge.title = addr // Show full address on hover
      transportDiv.appendChild(badge)
    }

    peerDiv.appendChild(transportDiv)

    peerListEl.appendChild(peerDiv)
  }
}


// Connect button handler
connectBtn.onclick = async () => {
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
    connectBtn.disabled = true
    log('Creating libp2p node...')

    // Create libp2p node with WebRTC, relay, and pubsub
    libp2pNode = await createLibp2p({
      addresses: {
        listen: ['/p2p-circuit', '/webrtc']
      },
      transports: [
        webSockets(),
        webRTCDirect(),
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
        bootstrap({
          list: bootstrappers
        }),
        pubsubPeerDiscovery({
          interval: INTERVALS.PUBSUB_PEER_DISCOVERY
        })
      ],
      services: {
        identify: identify(),
        identifyPush: identifyPush(),
        autoNAT: autoNAT(),
        dcutr: dcutr(),
        pubsub: floodsub()
      }
    })

    const peerIdStr = libp2pNode.peerId.toString()
    log(
      `libp2p node created with id: ${peerIdStr.slice(0, 8)}...${peerIdStr.slice(-4)}`
    )
    log('Connecting to bootstrap relays...')

    // Expose for testing
    window.libp2pNode = libp2pNode

    // Wait for relay reservation to be created automatically
    // Note: Manual reservation was needed due to gossipsub/floodsub multiaddr compatibility issues
    // Testing if automatic reservation works now with floodsub
    /*
    await new Promise((resolve) => {
      const identifyHandler = async (evt) => {
        const peerId = evt.detail.peerId || evt.detail;

        try {
          const peer = await libp2pNode.peerStore.get(peerId);

          if (peer?.protocols.includes('/libp2p/circuit/relay/0.2.0/hop')) {
            libp2pNode.removeEventListener('peer:identify', identifyHandler);

            // Manually create reservation (topology callback may fail due to pubsub errors)
            const transport = libp2pNode.components.transportManager.getTransports()
              .find(t => t[Symbol.toStringTag] === '@libp2p/circuit-relay-v2-transport');

            if (transport?.reservationStore) {
              await transport.reservationStore.addRelay(peerId, 'discovered');
              log('✅ Relay reservation obtained');
            }

            resolve();
          }
        } catch (err) {
          console.error('Reservation error:', err.message);
          resolve();
        }
      };

      libp2pNode.addEventListener('peer:identify', identifyHandler);

      setTimeout(() => {
        libp2pNode.removeEventListener('peer:identify', identifyHandler);
        resolve();
      }, 10000);
    });
    */

    // Give bootstrap and automatic reservation a moment to complete
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Create Yjs document and spreadsheet engine
    yjsDoc = new Y.Doc()
    spreadsheetEngine = new SpreadsheetEngine(yjsDoc)

    // Set up Yjs provider with libp2p
    log(`Setting up Yjs provider with topic: ${topic}`)
    provider = new Libp2pProvider(topic, yjsDoc, libp2pNode)

    // Create spreadsheet grid
    createSpreadsheetGrid()

    // Watch for cell changes
      spreadsheetEngine.onChange(updateCellDisplay);

    // Show spreadsheet UI
    spreadsheetContainer.style.display = 'block'
    formulaBar.style.display = 'flex'
    examplesEl.style.display = 'block'
    formulaInput.disabled = false

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

    // Update displays on connection events
    libp2pNode.addEventListener('peer:connect', (evt) => {
      const connections = libp2pNode.getConnections(evt.detail)
      const transports = connections.map(c => {
        const addr = c.remoteAddr.toString()
        if (addr.includes('/webrtc')) { return 'webrtc' }
        if (addr.includes('/p2p-circuit')) { return 'relay' }
        if (addr.includes('/ws')) { return 'websocket' }
        return 'unknown'
      })
      log(`Connected to ${evt.detail.toString().slice(0, 8)}...${evt.detail.toString().slice(-4)} via ${transports.join(', ')}`)
      updatePeerDisplay()
    })

    libp2pNode.addEventListener('peer:disconnect', (evt) => {
      updatePeerDisplay()
      if (DEBUG) {
        log(`Disconnected from peer: ${evt.detail.toString().slice(0, 12)}...`)
      }
    })

    // Update multiaddrs when they change (e.g., relay reservation obtained)
    libp2pNode.addEventListener('self:peer:update', () => {
      updateMultiaddrDisplay()
      if (DEBUG) {
        log('Multiaddrs updated')
      }
    })

    // Periodically check for new multiaddrs (relay reservation can take time)
    const multiaddrUpdateInterval = setInterval(() => {
      updateMultiaddrDisplay()
    }, 2000) // Check every 2 seconds

    // Store interval ID for cleanup
    window.multiaddrUpdateInterval = multiaddrUpdateInterval
  } catch (err) {
    log(`Error: ${err.message}`, true)

    console.error('Connection error:', err)
    connectBtn.disabled = false

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
 * Create the spreadsheet grid UI
 */
function createSpreadsheetGrid () {
  // Create header row with column letters
  const headerRow = document.createElement('tr')
  headerRow.appendChild(document.createElement('th')) // Corner cell

  for (let col = 0; col < gridSize.cols; col++) {
    const th = document.createElement('th')
    th.textContent = colToLetter(col)
    headerRow.appendChild(th)
  }
  spreadsheetEl.appendChild(headerRow)

  // Create data rows
  for (let row = 0; row < gridSize.rows; row++) {
    const tr = document.createElement('tr')

    // Row header
    const rowHeader = document.createElement('th')
    rowHeader.textContent = row + 1
    tr.appendChild(rowHeader)

    // Data cells
    for (let col = 0; col < gridSize.cols; col++) {
      const td = document.createElement('td')
      const input = document.createElement('input')
      const coord = coordToA1(row, col)

      td.dataset.cell = coord
      input.id = `cell-${coord}`
      input.type = 'text'

      // Focus handler - select cell
      input.addEventListener('focus', () => {
        selectCell(coord)
      })

      // Input handler - update cell value
      input.addEventListener('blur', () => {
        const value = input.value.trim()
        if (value === '') {
          spreadsheetEngine.clearCell(coord)
        } else {
          spreadsheetEngine.setCell(coord, value)
        }
      })

      // Enter key - move to next row
      // eslint-disable-next-line no-loop-func
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          const value = input.value.trim()
          if (value === '') {
            spreadsheetEngine.clearCell(coord)
          } else {
            spreadsheetEngine.setCell(coord, value)
          }

          // Move to cell below
          const { row: r, col: c } = a1ToCoord(coord)
          if (r < gridSize.rows - 1) {
            const nextCoord = coordToA1(r + 1, c)
            document.getElementById(`cell-${nextCoord}`).focus()
          }
        }
      })

      td.appendChild(input)
      tr.appendChild(td)
    }

    spreadsheetEl.appendChild(tr)
  }

  // Select first cell by default
  selectCell('A1')
}

/**
 * Convert column index to letter
 *
 * @param col
 */
function colToLetter (col) {
  let letter = ''
  while (col >= 0) {
    letter = String.fromCharCode(65 + (col % 26)) + letter
    col = Math.floor(col / 26) - 1
  }
  return letter
}

/**
 * Select a cell and update formula bar
 *
 * @param coord
 */
function selectCell (coord) {
  // Remove previous selection
  if (currentCell) {
    const prevTd = document.getElementById(
      `cell-${currentCell}`
    )?.parentElement
    if (prevTd) { prevTd.classList.remove('selected') }
  }

  currentCell = coord

  // Add selection to new cell
  const td = document.getElementById(`cell-${coord}`)?.parentElement
  if (td) { td.classList.add('selected') }

  // Update formula bar
  cellRefEl.textContent = coord + ':'
  const cell = spreadsheetEngine.getCell(coord)
  formulaInput.value = cell.formula || cell.value
}

/**
 * Update cell display when value changes
 *
 * @param coord
 */
function updateCellDisplay (coord) {
  const input = document.getElementById(`cell-${coord}`)
  if (!input) { return }

  const cell = spreadsheetEngine.getCell(coord)
  const td = input.parentElement

  // Only update if not currently focused
  if (document.activeElement !== input) {
    input.value = cell.value
  }

  // Update error styling
  if (
    cell.error ||
    (typeof cell.value === 'string' && cell.value.startsWith('#'))
  ) {
    td.classList.add('error')
  } else {
    td.classList.remove('error')
  }

  // Update formula bar if this is the selected cell
  if (currentCell === coord) {
    formulaInput.value = cell.formula || cell.value
  }
}

// Formula bar input handler
if (formulaInput) {
  formulaInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && currentCell) {
      e.preventDefault()
      const value = formulaInput.value.trim()
      const input = document.getElementById(`cell-${currentCell}`)

      if (value === '') {
        spreadsheetEngine.clearCell(currentCell)
        if (input) { input.value = '' }
      } else {
        spreadsheetEngine.setCell(currentCell, value)
      }

      // Refocus the cell
      if (input) { input.focus() }
    }
  })
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
