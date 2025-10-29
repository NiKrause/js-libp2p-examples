import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { autoNAT } from '@libp2p/autonat'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { dcutr } from '@libp2p/dcutr'
import { identify, identifyPush } from '@libp2p/identify'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { webRTC } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import * as filters from '@libp2p/websockets/filters'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p } from 'libp2p'
import * as Y from 'yjs'
import { DEBUG, TIMEOUTS, INTERVALS, PUBSUB_DISCOVERY } from './constants.js'
import { Libp2pProvider } from './yjs-libp2p-provider.js'

// UI elements
const relayInput = document.getElementById('relay')
const topicInput = document.getElementById('topic')
const connectBtn = document.getElementById('connect')
const editor = document.getElementById('editor')
const logEl = document.getElementById('log')
const peersEl = document.getElementById('peers')
const peerCountEl = document.getElementById('peer-count')
const peerListEl = document.getElementById('peer-list')

let libp2pNode
let yjsDoc
let provider
let text

/**
 * Logs a message to both console and UI.
 *
 * @param {string} message - Message to log
 * @param {boolean} [isError] - Whether this is an error message
 */
const log = (message, isError = false) => {
  if (DEBUG) {
    // eslint-disable-next-line no-console
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
    peerIdSpan.textContent = peerId
    peerDiv.appendChild(peerIdSpan)

    const transportDiv = document.createElement('div')

    // Show each connection with its transport
    for (const { transport, addr } of transports) {
      const badge = document.createElement('span')
      badge.className = 'transport'
      badge.textContent = transport
      badge.title = addr // Show full address on hover
      transportDiv.appendChild(badge)
    }

    peerDiv.appendChild(transportDiv)

    peerListEl.appendChild(peerDiv)
  }
}

/**
 * Validates a multiaddr string format.
 *
 * @param {string} addr - Multiaddr to validate
 * @returns {boolean}
 */
const isValidMultiaddr = (addr) => {
  try {
    multiaddr(addr)
    return true
  } catch {
    return false
  }
}

// Connect button handler
connectBtn.onclick = async () => {
  if (libp2pNode) {
    log('Already connected')
    return
  }

  const relayAddr = relayInput.value.trim()
  if (!relayAddr) {
    log('Please enter a relay multiaddr', true)
    return
  }

  if (!isValidMultiaddr(relayAddr)) {
    log('Invalid multiaddr format', true)
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
        webSockets({ filter: filters.all }),
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
        inboundStreamProtocolNegotiationTimeout: TIMEOUTS.PROTOCOL_NEGOTIATION_INBOUND,
        inboundUpgradeTimeout: TIMEOUTS.UPGRADE_INBOUND,
        outboundStreamProtocolNegotiationTimeout: TIMEOUTS.PROTOCOL_NEGOTIATION_OUTBOUND,
        outboundUpgradeTimeout: TIMEOUTS.UPGRADE_OUTBOUND
      },
      connectionGater: {
        denyDialMultiaddr: () => false
      },
      peerDiscovery: [
        pubsubPeerDiscovery({
          interval: INTERVALS.PUBSUB_PEER_DISCOVERY,
          topics: PUBSUB_DISCOVERY.TOPICS,
          listenOnly: false
        })
      ],
      services: {
        identify: identify(),
        identifyPush: identifyPush(),
        autoNAT: autoNAT(),
        dcutr: dcutr(),
        pubsub: gossipsub({
          emitSelf: false,
          allowPublishToZeroTopicPeers: true,
          heartbeatInterval: INTERVALS.GOSSIPSUB_HEARTBEAT,
          directPeers: [],
          floodPublish: true
        })
      }
    })

    log(`libp2p node created with id: ${libp2pNode.peerId.toString().slice(0, 12)}...`)

    // Expose for testing
    window.libp2pNode = libp2pNode

    // Connect to relay
    log('Connecting to relay...')
    try {
      const ma = multiaddr(relayAddr)
      await libp2pNode.dial(ma)
      log('Connected to relay!')
    } catch (err) {
      throw new Error(`Failed to connect to relay: ${err.message}`)
    }

    // Create Yjs document
    yjsDoc = new Y.Doc()
    text = yjsDoc.getText('content')

    // Set up Yjs provider with libp2p
    log(`Setting up Yjs provider with topic: ${topic}`)
    provider = new Libp2pProvider(topic, yjsDoc, libp2pNode)

    // Bind editor to Yjs text
    text.observe(() => {
      const currentText = text.toString()
      if (editor.value !== currentText) {
        const cursorPos = editor.selectionStart
        editor.value = currentText
        editor.setSelectionRange(cursorPos, cursorPos)
      }
    })

    editor.oninput = () => {
      const newText = editor.value
      const currentText = text.toString()

      if (newText !== currentText) {
        yjsDoc.transact(() => {
          text.delete(0, currentText.length)
          text.insert(0, newText)
        })
      }
    }

    editor.disabled = false
    log('Ready! Open this page in another browser tab or window to see collaborative editing.')

    // Initial peer display update
    updatePeerDisplay()

    // Update peer display on connection events
    libp2pNode.addEventListener('peer:connect', (evt) => {
      updatePeerDisplay()
      if (DEBUG) {
        log(`Connected to peer: ${evt.detail.toString().slice(0, 12)}...`)
      }
    })

    libp2pNode.addEventListener('peer:disconnect', (evt) => {
      updatePeerDisplay()
      if (DEBUG) {
        log(`Disconnected from peer: ${evt.detail.toString().slice(0, 12)}...`)
      }
    })
  } catch (err) {
    log(`Error: ${err.message}`, true)
    // eslint-disable-next-line no-console
    console.error('Connection error:', err)
    connectBtn.disabled = false

    // Clean up on error
    if (libp2pNode) {
      try {
        await libp2pNode.stop()
      } catch (stopErr) {
        // eslint-disable-next-line no-console
        console.error('Error stopping libp2p:', stopErr)
      }
      libp2pNode = null
    }
  }
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
    // eslint-disable-next-line no-console
    console.error('Cleanup error:', err)
  }
})
