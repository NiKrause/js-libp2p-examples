/**
 * Bootstrap relay addresses for the collaborative spreadsheet
 *
 * Development mode uses the local relay server.
 * Production mode uses public Universal Connectivity relays.
 *
 * To get your local relay addresses:
 * 1. Start the relay: npm run relay
 * 2. Copy the multiaddrs from the console output
 * 3. Update DEV_RELAYS below
 *
 * The relay PeerId should stay the same across restarts.
 */

/**
 * Development relay addresses (local testing)
 * These require running `npm run relay` locally
 */
const DEV_RELAYS = [
  '/ip4/10.171.64.248/udp/9090/webrtc-direct/certhash/uEiAIbksoQ56yn3UPDn0k_abCkGBHCf79iUemkVXRn_Vy2g/p2p/12D3KooWM6VMihSpHj7T9xmdddEdKoFq4N3VuA3QTZPEwckrqcPK',
  '/ip4/127.0.0.1/tcp/9092/ws/p2p/12D3KooWP9ryj8o6uLRhUV2SXJycuBrynakzbiUMBmTn3prF8ezb'
]

/**
 * Production relay addresses (public Universal Connectivity relays)
 * These are always available and don't require local setup
 */
const PROD_RELAYS = [
  // Public Universal Connectivity bootstrap address
  '/ip4/147.28.186.157/tcp/9095/tls/sni/147-28-186-157.k51qzi5uqu5did09qdbdg7jf0pydff1llcd6h4deiasuc7qyemy3v8bc1q1rlb.libp2p.direct/ws/p2p/12D3KooWFhXabKDwALpzqMbto94sB7rvmZ6M28hs9Y9xSopDKwQr'

  // Add more production bootstrap addresses here for redundancy:
  // '/dns4/your-relay-domain.com/tcp/9092/wss/p2p/YOUR_PEER_ID',
]

// Vite injects import.meta.env.DEV at build time
// DEV is true when running `npm start` (vite dev server)
// DEV is false when running production build (`npm run build` + `vite preview`)
export default import.meta.env.DEV ? DEV_RELAYS : PROD_RELAYS
