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
  // Local relay - WebSocket endpoint
  '/ip4/127.0.0.1/tcp/9092/ws/p2p/12D3KooWP9ryj8o6uLRhUV2SXJycuBrynakzbiUMBmTn3prF8ezb'

  // Add your public relay addresses here for production:
  // '/dns4/your-relay-domain.com/tcp/9092/wss/p2p/YOUR_PEER_ID',

  // You can add multiple relays for redundancy
]
