import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { autoNAT } from '@libp2p/autonat'
import { circuitRelayServer, circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { dcutr } from '@libp2p/dcutr'
import { identify, identifyPush } from '@libp2p/identify'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { tcp } from '@libp2p/tcp'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import * as filters from '@libp2p/websockets/filters'
import { createLibp2p } from 'libp2p'
import {
  DEBUG,
  RELAY_TIMEOUTS,
  RELAY_RESERVATIONS,
  CONNECTION_CONFIG,
  DISCOVERY_CONFIG,
  MONITORING,
  DEFAULT_TOPIC
} from './relay-constants.js'

const server = await createLibp2p({
  addresses: {
    listen: [
      '/ip4/0.0.0.0/tcp/9091',
      '/ip4/0.0.0.0/tcp/9092/ws',
      '/ip4/0.0.0.0/udp/9093/webrtc-direct'
    ]
  },
  transports: [
    tcp(),
    webSockets({
      filter: filters.all
    }),
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
    inboundStreamProtocolNegotiationTimeout: RELAY_TIMEOUTS.PROTOCOL_NEGOTIATION_INBOUND,
    inboundUpgradeTimeout: RELAY_TIMEOUTS.UPGRADE_INBOUND,
    outboundStreamProtocolNegotiationTimeout: RELAY_TIMEOUTS.PROTOCOL_NEGOTIATION_OUTBOUND,
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
    pubsub: gossipsub({
      emitSelf: false,
      allowPublishToZeroTopicPeers: true,
      canRelayMessage: true,
      floodPublish: true
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

// Set up peer discovery listener to dial discovered peers
server.addEventListener('peer:discovery', async (evt) => {
  const peer = evt.detail
  const connections = server.getConnections(peer.id)

  if (connections && connections.length > 0) {
    return
  }

  try {
    await server.dial(peer.id)
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.log(`Dialed peer: ${peer.id.toString().slice(0, 12)}...`)
    }
  } catch (error) {
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.warn(`Failed to dial peer: ${error.message}`)
    }
  }
})

server.addEventListener('peer:connect', (evt) => {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`Peer connected: ${evt.detail.toString().slice(0, 12)}...`)
  }
})

server.addEventListener('peer:disconnect', (evt) => {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`Peer disconnected: ${evt.detail.toString().slice(0, 12)}...`)
  }
})

// Log pubsub messages when debug mode is enabled
if (DEBUG) {
  server.services.pubsub.addEventListener('message', (evt) => {
    try {
      const msgStr = new TextDecoder().decode(evt.detail.data)
      const msg = JSON.parse(msgStr)
      // eslint-disable-next-line no-console
      console.log(`📨 ${msg.type} on ${evt.detail.topic} from ${evt.detail.from.toString().slice(0, 12)}...`)
    } catch {
      // eslint-disable-next-line no-console
      console.log(`📨 Message on ${evt.detail.topic} (${evt.detail.data.length} bytes)`)
    }
  })
}

// Track subscribed topics
const subscribedTopics = new Set()

// Auto-subscribe to client topics to relay messages
// Note: This is needed until browsers establish direct WebRTC connections
// Production: Use a message queue or dedicated signaling server instead
server.services.pubsub.addEventListener('subscription-change', async (evt) => {
  for (const sub of (evt.detail.subscriptions || [])) {
    if (!sub?.topic || subscribedTopics.has(sub.topic)) continue
    
    // Subscribe to data topics (but not discovery topics)
    if (!sub.topic.startsWith('_peer-discovery') && !sub.topic.startsWith('_')) {
      subscribedTopics.add(sub.topic)
      try {
        await server.services.pubsub.subscribe(sub.topic)
        // eslint-disable-next-line no-console
        console.log(`📡 Relay forwarding: ${sub.topic}`)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to subscribe:', err)
      }
    }
  }
})

// Subscribe to topics dynamically as we see them
const subscribedTopics = new Set()

server.services.pubsub.addEventListener('subscription-change', async (evt) => {
  const subscriptions = evt.detail.subscriptions
  if (!subscriptions || !Array.isArray(subscriptions)) {
    return
  }

  for (const sub of subscriptions) {
    if (!sub || !sub.topic) {
      continue
    }

    const topic = sub.topic
    const shouldSubscribe = (topic.startsWith('yjs-') || topic.startsWith('test-')) && !subscribedTopics.has(topic)
    if (!shouldSubscribe) {
      continue
    }

    subscribedTopics.add(topic)
    try {
      await server.services.pubsub.subscribe(topic)
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.log(`📡 Auto-subscribed to: ${topic}`)
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to subscribe:', err)
    }
  }
})

// Subscribe to default Yjs topic
await server.services.pubsub.subscribe(DEFAULT_TOPIC)
subscribedTopics.add(DEFAULT_TOPIC)
// eslint-disable-next-line no-console
console.log(`📡 Relay subscribed to default topic: ${DEFAULT_TOPIC}`)

// Periodically log active topics and subscribers in debug mode
if (DEBUG) {
  setInterval(() => {
    const topics = server.services.pubsub.getTopics()
    if (topics.length > 0) {
      // eslint-disable-next-line no-console
      console.log('\n📋 Active topics:', topics)
      for (const topic of topics) {
        const subscribers = server.services.pubsub.getSubscribers(topic)
        if (subscribers.length > 0) {
          // eslint-disable-next-line no-console
          console.log(`  👥 ${topic}: ${subscribers.length} subscribers`)
        }
      }
    }
  }, MONITORING.TOPIC_STATUS_INTERVAL)
}

// eslint-disable-next-line no-console
console.info('\nThe relay node is running and listening on the following multiaddrs:')
// eslint-disable-next-line no-console
console.info('')
// eslint-disable-next-line no-console
console.info(server.getMultiaddrs().map((ma) => ma.toString()).join('\n'))
// eslint-disable-next-line no-console
console.info('')
// eslint-disable-next-line no-console
console.info('Copy one of the above multiaddrs and use it in the browser client')
