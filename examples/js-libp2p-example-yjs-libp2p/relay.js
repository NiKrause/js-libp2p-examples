/* eslint-disable no-console */

import fs from 'fs'
import http from 'http'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { autoNAT } from '@libp2p/autonat'
import {
  circuitRelayServer,
  circuitRelayTransport
} from '@libp2p/circuit-relay-v2'
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys'
import { dcutr } from '@libp2p/dcutr'
import { gossipsub } from '@libp2p/gossipsub'
import { identify, identifyPush } from '@libp2p/identify'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { ping } from '@libp2p/ping'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { tcp } from '@libp2p/tcp'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { createLibp2p } from 'libp2p'
import {
  DEBUG,
  RELAY_TIMEOUTS,
  RELAY_RESERVATIONS,
  CONNECTION_CONFIG,
  DISCOVERY_CONFIG,
  MONITORING
} from './relay-constants.js'

// Load or generate the persistent key; the file keeps the protobuf-encoded
// private key, as @libp2p/peer-id-factory wrote it before libp2p 3.
const PEER_ID_FILE = './relay-peer-id.json'
let privateKey

if (fs.existsSync(PEER_ID_FILE)) {
  const data = JSON.parse(fs.readFileSync(PEER_ID_FILE, 'utf8'))
  privateKey = privateKeyFromProtobuf(Buffer.from(data.privKey, 'base64'))
  console.log('Loaded existing PeerId:', peerIdFromPrivateKey(privateKey).toString())
} else {
  privateKey = await generateKeyPair('Ed25519')
  const peerId = peerIdFromPrivateKey(privateKey)
  const data = {
    id: peerId.toString(),
    privKey: Buffer.from(privateKeyToProtobuf(privateKey)).toString('base64'),
    pubKey: Buffer.from(privateKey.publicKey.raw).toString('base64')
  }
  fs.writeFileSync(PEER_ID_FILE, JSON.stringify(data, null, 2))
  console.log('Generated new PeerId:', peerId.toString())
}

const server = await createLibp2p({
  privateKey,
  addresses: {
    listen: [
      '/ip4/0.0.0.0/tcp/9091',
      '/ip4/0.0.0.0/tcp/9092/ws',
      '/ip4/0.0.0.0/udp/9093/webrtc-direct'
    ]
  },
  transports: [
    tcp(),
    webSockets(),
    webRTC(),
    webRTCDirect(),
    circuitRelayTransport()
  ],
  peerDiscovery: [
    pubsubPeerDiscovery({
      interval: DISCOVERY_CONFIG.INTERVAL,
      topics: DISCOVERY_CONFIG.TOPICS,
      listenOnly: false
    })
  ],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  connectionManager: {
    inboundStreamProtocolNegotiationTimeout:
      RELAY_TIMEOUTS.PROTOCOL_NEGOTIATION_INBOUND,
    inboundUpgradeTimeout: RELAY_TIMEOUTS.UPGRADE_INBOUND,
    outboundStreamProtocolNegotiationTimeout:
      RELAY_TIMEOUTS.PROTOCOL_NEGOTIATION_OUTBOUND,
    outboundUpgradeTimeout: RELAY_TIMEOUTS.UPGRADE_OUTBOUND,
    maxConnections: CONNECTION_CONFIG.MAX_CONNECTIONS,
    maxIncomingPendingConnections: CONNECTION_CONFIG.MAX_INCOMING_PENDING,
    maxPeerAddrsToDial: CONNECTION_CONFIG.MAX_PEER_ADDRS_TO_DIAL,
    dialTimeout: RELAY_TIMEOUTS.DIAL_TIMEOUT
  },
  connectionGater: {
    denyDialMultiaddr: () => false
  },
  services: {
    identify: identify(),
    identifyPush: identifyPush(),
    autoNAT: autoNAT(),
    dcutr: dcutr(),
    ping: ping(),
    pubsub: gossipsub({
      emitSelf: false,
      allowPublishToZeroTopicPeers: true,
      // Gossipsub scores peers, and by default it penalises peers that share an
      // IP: -5 × (n − 10)² once more than ten peers were seen from one address,
      // counting peers that disconnected up to an hour ago. Every browser in
      // the test suite arrives from 127.0.0.1, so by the sixth two-browser test
      // new pages scored below the gossip threshold (no longer grafted into the
      // mesh: they only ever heard the relay's own messages, never each
      // other's), and by the eighth below the graylist threshold (their
      // subscriptions were ignored outright). Measured 2026-10-13: rounds 1–5
      // found each other in ~11 s, round 6 onwards never did. The behaviour
      // penalty (P7) punishes the connection churn of a test run the same way;
      // orbitdb-relay zeroes both for the same reason (Le-Space/orbitdb-relay#17).
      scoreParams: {
        IPColocationFactorWeight: 0,
        behaviourPenaltyWeight: 0
      }
    }),
    relay: circuitRelayServer({
      hopTimeout: RELAY_TIMEOUTS.HOP_TIMEOUT,
      reservations: {
        maxReservations: RELAY_RESERVATIONS.MAX_RESERVATIONS,
        reservationTtl: RELAY_RESERVATIONS.RESERVATION_TTL,
        defaultDataLimit: RELAY_RESERVATIONS.DEFAULT_DATA_LIMIT,
        defaultDurationLimit: RELAY_RESERVATIONS.DEFAULT_DURATION_LIMIT
      }
    })
  }
})

if (DEBUG) {
  server.addEventListener('peer:connect', (evt) => {
    console.log(`Peer connected: ${evt.detail.toString().slice(0, 8)}...${evt.detail.toString().slice(-4)}`)
  })

  server.addEventListener('peer:disconnect', (evt) => {
    console.log(`Peer disconnected: ${evt.detail.toString().slice(0, 8)}...${evt.detail.toString().slice(-4)}`)
  })
}

// Diagnostics: how many pubsub messages the relay itself received, per topic
// and sender, and how many peers came and went. Served on /api/debug.
const messageCounts = {}
const peerEvents = { connect: 0, disconnect: 0 }
server.services.pubsub.addEventListener('message', (evt) => {
  const topic = evt.detail.topic
  const from = (evt.detail.from?.toString() ?? 'unsigned').slice(-6)
  messageCounts[topic] ??= {}
  messageCounts[topic][from] = (messageCounts[topic][from] ?? 0) + 1
})
server.addEventListener('peer:connect', () => { peerEvents.connect++ })
server.addEventListener('peer:disconnect', () => { peerEvents.disconnect++ })

// Subscribe relay to discovery topic and auto-subscribe to any topics browsers use
const DISCOVERY_TOPIC = '_peer-discovery._p2p._pubsub'
const subscribedTopics = new Set([DISCOVERY_TOPIC])

server.services.pubsub.subscribe(DISCOVERY_TOPIC)
console.log(`Subscribed to discovery topic: ${DISCOVERY_TOPIC}`)

// Auto-subscribe when browsers subscribe to new topics
server.services.pubsub.addEventListener('subscription-change', (evt) => {
  for (const sub of evt.detail.subscriptions) {
    if (sub.subscribe && !subscribedTopics.has(sub.topic)) {
      console.log(`Auto-subscribing to topic: ${sub.topic}`)
      try {
        server.services.pubsub.subscribe(sub.topic)
        subscribedTopics.add(sub.topic)
      } catch (err) {
        // Ignore errors from closed streams during subscription
        if (DEBUG) {
          console.log(`Failed to auto-subscribe to ${sub.topic}: ${err.message}`)
        }
      }
    }
  }
})

if (DEBUG) {
  server.services.pubsub.addEventListener('message', (evt) => {
    const peerId = evt.detail.from.toString()
    console.log(`Message on ${evt.detail.topic} from ${peerId.slice(0, 8)}...${peerId.slice(-4)}`)
  })
}

if (DEBUG) {
  setInterval(() => {
    const topics = server.services.pubsub.getTopics()
    if (topics.length > 0) {
      console.log('\nActive topics:', topics)
      for (const topic of topics) {
        const subscribers = server.services.pubsub.getSubscribers(topic)
        if (subscribers.length > 0) {
          console.log(`  ${topic}: ${subscribers.length} subscribers`)
        }
      }
    }
  }, MONITORING.TOPIC_STATUS_INTERVAL)
}

console.info('\nRelay listening on:')
server.getMultiaddrs().forEach((ma) => console.info(`  ${ma.toString()}`))

// Create HTTP server to serve multiaddrs dynamically
const httpServer = http.createServer((req, res) => {
  // Enable CORS for browser requests
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.url === '/api/debug') {
    // What the relay thinks of its pubsub neighbourhood: who is subscribed to
    // which topic and who is actually in the mesh. A page that is subscribed
    // but not in the mesh only ever hears the relay's own (flood-published)
    // messages, never the ones it forwards.
    const pubsub = server.services.pubsub
    const topics = {}
    for (const topic of pubsub.getTopics()) {
      topics[topic] = {
        subscribers: pubsub.getSubscribers(topic).map(p => p.toString().slice(-6)),
        mesh: Array.from(pubsub.mesh?.get(topic) ?? []).map(p => p.slice(-6))
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      connections: server.getConnections().map(c => ({ peer: c.remotePeer.toString().slice(-6), status: c.status, addr: c.remoteAddr.toString().slice(0, 40) })),
      pubsubPeers: Array.from(pubsub.peers?.keys?.() ?? []).map(p => ({ id: p.slice(-6), score: pubsub.score?.score(p) })),
      peerEvents,
      messageCounts,
      topics
    }, null, 2))
    return
  }

  if (req.url === '/api/addresses') {
    res.writeHead(200, { 'Content-Type': 'application/json' })

    const multiaddrs = server.getMultiaddrs().map(ma => ma.toString())

    // Categorize addresses by type
    const addresses = {
      websocket: multiaddrs.filter(ma => ma.includes('/ws') || ma.includes('/wss')),
      webrtcDirect: multiaddrs.filter(ma => ma.includes('/webrtc-direct')),
      tcp: multiaddrs.filter(ma => ma.includes('/tcp/') && !ma.includes('/ws')),
      all: multiaddrs
    }

    res.end(JSON.stringify(addresses, null, 2))
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found. Try /api/addresses')
  }
})

const HTTP_PORT = 9094
httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  console.info(`\nHTTP API listening on: http://0.0.0.0:${HTTP_PORT}`)
  console.info(`Get addresses: http://localhost:${HTTP_PORT}/api/addresses\n`)
})
