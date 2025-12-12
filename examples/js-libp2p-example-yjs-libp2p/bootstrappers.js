/**
 * Bootstrap relay addresses for the collaborative spreadsheet
 *
 * IMPORTANT: Update these addresses to match your relay server!
 *
 * To get your relay addresses:
 * 1. Start the relay: npm run relay:persistent
 * 2. Copy the multiaddrs from the console output
 * 3. Paste them here
 *
 * The relay PeerId should stay the same across restarts.
 */
export default [
  // Local relay - WebSocket endpoint (for local testing)
  '/ip4/127.0.0.1/tcp/9092/ws/p2p/12D3KooWP9ryj8o6uLRhUV2SXJycuBrynakzbiUMBmTn3prF8ezb',

  // Public Universal Connectivity bootstrap address
  '/ip4/147.28.186.157/tcp/9095/tls/sni/147-28-186-157.k51qzi5uqu5did09qdbdg7jf0pydff1llcd6h4deiasuc7qyemy3v8bc1q1rlb.libp2p.direct/ws/p2p/12D3KooWFhXabKDwALpzqMbto94sB7rvmZ6M28hs9Y9xSopDKwQr'

  // Add more bootstrap addresses here for redundancy:
  // '/dns4/your-relay-domain.com/tcp/9092/wss/p2p/YOUR_PEER_ID',
]
