/* eslint-disable no-console */

// Using floodsub instead of gossipsub due to multiaddr.tuples() compatibility issues
// with gossipsub v14.x and multiaddr v13.x at the time of writing (2025-01)
import fs from 'fs'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { autoNAT } from '@libp2p/autonat'
import {
  circuitRelayServer,
  circuitRelayTransport
} from '@libp2p/circuit-relay-v2'
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys'
import { dcutr } from '@libp2p/dcutr'
import { floodsub } from '@libp2p/floodsub'
import { identify, identifyPush } from '@libp2p/identify'
import { createEd25519PeerId, createFromJSON } from '@libp2p/peer-id-factory'
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

// Load or generate persistent PeerId
const PEER_ID_FILE = './relay-peer-id.json'
let peerId

if (fs.existsSync(PEER_ID_FILE)) {
  const data = JSON.parse(fs.readFileSync(PEER_ID_FILE, 'utf8'))
  peerId = await createFromJSON(data)
  console.log('Loaded existing PeerId:', peerId.toString())
} else {
  peerId = await createEd25519PeerId()
  const data = {
    id: peerId.toString(),
    privKey: Buffer.from(peerId.privateKey).toString('base64'),
    pubKey: Buffer.from(peerId.publicKey).toString('base64')
  }
  fs.writeFileSync(PEER_ID_FILE, JSON.stringify(data, null, 2))
  console.log('Generated new PeerId:', peerId.toString())
}

const server = await createLibp2p({
  privateKey: privateKeyFromProtobuf(peerId.privateKey),
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
    pubsub: floodsub(),
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
      server.services.pubsub.subscribe(sub.topic)
      subscribedTopics.add(sub.topic)
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
