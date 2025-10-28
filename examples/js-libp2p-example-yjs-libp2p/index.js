/* eslint-disable no-console */

import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { autoNAT } from '@libp2p/autonat'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { dcutr } from '@libp2p/dcutr'
import { identify, identifyPush } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import * as filters from '@libp2p/websockets/filters'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p } from 'libp2p'
import * as Y from 'yjs'
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

// Logging
const log = (message) => {
  console.log(message)
  logEl.textContent += message + '\n'
  logEl.scrollTop = logEl.scrollHeight
}

// Update peer display
const updatePeerDisplay = () => {
  if (!libp2pNode) return

  const connections = libp2pNode.getConnections()
  const peerMap = new Map()

  // Group connections by peer
  for (const conn of connections) {
    const peerId = conn.remotePeer.toString()
    if (!peerMap.has(peerId)) {
      peerMap.set(peerId, [])
    }

    // Get transport from connection and remote address
    const remoteAddr = conn.remoteAddr.toString()
    let transport = 'unknown'

    // Check for circuit relay (p2p-circuit in address)
    if (remoteAddr.includes('/p2p-circuit')) {
      transport = 'relay'
    } else if (remoteAddr.includes('/webrtc')) {
      // Check for WebRTC
      transport = 'webrtc'
    } else if (remoteAddr.includes('/webtransport')) {
      // Check for WebTransport
      transport = 'webtransport'
    } else if (remoteAddr.includes('/wss') || remoteAddr.includes('/tls/ws')) {
      // Check for WebSocket Secure
      transport = 'websocket-secure'
    } else if (remoteAddr.includes('/ws')) {
      // Check for WebSocket
      transport = 'websocket'
    } else if (remoteAddr.includes('/tcp')) {
      // If it has TCP but also has /ws, it's websocket over TCP
      transport = 'tcp'
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

// Connect button handler
connectBtn.onclick = async () => {
  if (libp2pNode) {
    log('Already connected')
    return
  }

  const relayAddr = relayInput.value.trim()
  if (!relayAddr) {
    log('Please enter a relay multiaddr')
    return
  }

  const topic = topicInput.value.trim()
  if (!topic) {
    log('Please enter a topic')
    return
  }

  try {
    connectBtn.disabled = true
    log('Creating libp2p node...')

    // Create libp2p node with WebRTC, relay, and pubsub
    libp2pNode = await createLibp2p({
      addresses: {
        listen: [
          '/p2p-circuit',
          '/webrtc',
          '/wss',
          '/ws'
        ]
      },
      transports: [
        webSockets({
          filter: filters.all
        }),
        webRTC({
          rtcConfiguration: {
            iceServers: [
              { urls: ['stun:stun.l.google.com:19302'] },
              { urls: ['stun:stun1.l.google.com:19302'] }
            ]
          }
        }),
        webRTCDirect(),
        circuitRelayTransport({
          reservationCompletionTimeout: 20000
        })
      ],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      connectionManager: {
        inboundStreamProtocolNegotiationTimeout: 10000,
        inboundUpgradeTimeout: 10000,
        outboundStreamProtocolNegotiationTimeout: 10000,
        outboundUpgradeTimeout: 10000
      },
      connectionGater: {
        denyDialMultiaddr: () => false
      },
      peerDiscovery: [
        pubsubPeerDiscovery({
          interval: 10000,
          topics: ['_peer-discovery._p2p._pubsub'],
          listenOnly: false
        })
      ],
      services: {
        ping: ping(),
        identify: identify(),
        identifyPush: identifyPush(),
        autoNAT: autoNAT(),
        dcutr: dcutr(),
        pubsub: gossipsub({
          emitSelf: false,
          allowPublishToZeroTopicPeers: true,
          // Speed up gossipsub mesh formation
          heartbeatInterval: 1000, // Send heartbeat every 1 second (default is 1000ms)
          directPeers: [],
          floodPublish: true // Broadcast to all peers, not just mesh
        })
      }
    })

    log(`libp2p node created with id: ${libp2pNode.peerId}`)

    // Expose for testing
    window.libp2pNode = libp2pNode

    // Connect to relay
    log('Connecting to relay...')
    const ma = multiaddr(relayAddr)
    await libp2pNode.dial(ma)
    log('Connected to relay!')

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

    // Log connection events and update peer display
    libp2pNode.addEventListener('peer:connect', (evt) => {
      log(`Connected to peer: ${evt.detail}`)
      updatePeerDisplay()
    })

    libp2pNode.addEventListener('peer:disconnect', (evt) => {
      log(`Disconnected from peer: ${evt.detail}`)
      updatePeerDisplay()
    })
  } catch (err) {
    log(`Error: ${err.message}`)
    console.error(err)
    connectBtn.disabled = false
  }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (provider) {
    provider.destroy()
  }
  if (libp2pNode) {
    libp2pNode.stop()
  }
})
