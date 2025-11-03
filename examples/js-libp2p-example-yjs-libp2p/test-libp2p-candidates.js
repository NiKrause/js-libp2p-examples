/**
 * Quick diagnostic script to see what candidates libp2p WebRTC gathers
 * Run with: node test-libp2p-candidates.js
 */

import { createLibp2p } from 'libp2p'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'

async function main() {
  console.log('Creating libp2p node with WebRTC transport...\n')

  const node = await createLibp2p({
    addresses: {
      listen: ['/webrtc']
    },
    transports: [
      webRTCDirect({
        rtcConfiguration: {
          iceServers: [] // Empty = host candidates only
        }
      }),
      webRTC({
        rtcConfiguration: {
          iceServers: [] // Empty = host candidates only
        }
      }),
      circuitRelayTransport()
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify()
    }
  })

  await node.start()

  console.log('✅ libp2p node started')
  console.log(`Peer ID: ${node.peerId}`)
  console.log(`\nListening on:`)
  node.getMultiaddrs().forEach(ma => console.log(`  ${ma}`))

  console.log('\nWebRTC transport is configured with empty iceServers')
  console.log('Try connecting another peer to see if host candidates are gathered\n')

  // Keep running
  process.on('SIGINT', async () => {
    console.log('\nStopping...')
    await node.stop()
    process.exit(0)
  })
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})

