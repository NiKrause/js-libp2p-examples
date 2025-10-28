/* eslint-disable no-console */

import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { autoNAT } from '@libp2p/autonat'
import { circuitRelayServer, circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { dcutr } from '@libp2p/dcutr'
import { identify, identifyPush } from '@libp2p/identify'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { webSockets } from '@libp2p/websockets'
import * as filters from '@libp2p/websockets/filters'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import { tcp } from '@libp2p/tcp'
import { ping } from '@libp2p/ping'
import { createLibp2p } from 'libp2p'

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
      interval: 5000,
      topics: ['_peer-discovery._p2p._pubsub'],
      listenOnly: false
    })
  ],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  connectionManager: {
    inboundStreamProtocolNegotiationTimeout: 30000,
    inboundUpgradeTimeout: 30000,
    outboundStreamProtocolNegotiationTimeout: 30000,
    outboundUpgradeTimeout: 30000,
    maxConnections: 1000,
    maxIncomingPendingConnections: 100,
    maxPeerAddrsToDial: 100,
    dialTimeout: 30000
  },
  connectionGater: {
    denyDialMultiaddr: () => false
  },
  services: {
    ping: ping(),
    identify: identify(),
    identifyPush: identifyPush(),
    autoNAT: autoNAT(),
    dcutr: dcutr(),
    pubsub: gossipsub({
      emitSelf: false,
      allowPublishToZeroTopicPeers: true,
      canRelayMessage: true,
      floodPublish: true  // Broadcast to all peers, not just mesh
    }),
    relay: circuitRelayServer({
      hopTimeout: 30000,
      reservations: {
        maxReservations: 1000,
        reservationTtl: 2 * 60 * 60 * 1000,
        defaultDataLimit: BigInt(1024 * 1024 * 1024),
        defaultDurationLimit: 2 * 60 * 1000
      }
    })
  }
})

// Set up peer discovery listener to dial discovered peers
server.addEventListener('peer:discovery', async (evt) => {
  const peer = evt.detail
  console.log(`Discovered peer: ${peer.id.toString()}`)
  
  // Check if we're already connected to this peer
  const connections = server.getConnections(peer.id)
  if (!connections || connections.length === 0) {
    console.log(`Dialing new peer: ${peer.id.toString()}`)
    
    try {
      // Dial the peer ID directly - libp2p will handle finding the best route
      await server.dial(peer.id)
      console.log(`Successfully dialed peer: ${peer.id.toString()}`)
    } catch (error) {
      console.error(`Failed to dial peer ${peer.id.toString()}:`, error.message)
    }
  } else {
    console.log(`Already connected to peer: ${peer.id.toString()}`)
  }
})

server.addEventListener('peer:connect', (evt) => {
  console.log(`Connected to peer: ${evt.detail.toString()}`)
})

server.addEventListener('peer:disconnect', (evt) => {
  console.log(`Disconnected from peer: ${evt.detail.toString()}`)
})

// Subscribe to the Yjs topic to relay messages and log them
const YJS_TOPIC = 'yjs-doc-1'
await server.services.pubsub.subscribe(YJS_TOPIC)
console.log(`📡 Relay subscribed to topic: ${YJS_TOPIC}`)

// Log all messages passing through
server.services.pubsub.addEventListener('message', (evt) => {
  if (evt.detail.topic === YJS_TOPIC) {
    console.log('\n📨 Message received on', YJS_TOPIC)
    console.log('  From:', evt.detail.from.toString())
    console.log('  Data length:', evt.detail.data.length, 'bytes')
    
    try {
      const msgStr = new TextDecoder().decode(evt.detail.data)
      const msg = JSON.parse(msgStr)
      console.log('  Type:', msg.type)
    } catch (e) {
      console.log('  (Could not parse message)')
    }
  }
})

// Periodically log subscribers to the topic
setInterval(() => {
  const subscribers = server.services.pubsub.getSubscribers(YJS_TOPIC)
  if (subscribers.length > 0) {
    console.log(`\n👥 Subscribers to ${YJS_TOPIC}:`, subscribers.map(p => p.toString()))
  }
}, 10000)

console.info('\nThe relay node is running and listening on the following multiaddrs:')
console.info('')
console.info(server.getMultiaddrs().map((ma) => ma.toString()).join('\n'))
console.info('')
console.info('Copy one of the above multiaddrs and use it in the browser client')
