/**
 * Configuration constants for the Yjs + libp2p application
 */

// Debug mode - set via environment variable or query parameter
export const DEBUG = new URLSearchParams(window?.location?.search).get('debug') === 'true' || false

// Network timeouts (milliseconds)
export const TIMEOUTS = {
  RELAY_CONNECTION: 20000,
  PROTOCOL_NEGOTIATION_INBOUND: 10000,
  PROTOCOL_NEGOTIATION_OUTBOUND: 10000,
  UPGRADE_INBOUND: 10000,
  UPGRADE_OUTBOUND: 10000,
  EDITOR_READY: 10000,
  PEER_DISCOVERY: 15000
}

// Pubsub intervals (milliseconds)
export const INTERVALS = {
  PUBSUB_PEER_DISCOVERY: 10000,
  GOSSIPSUB_HEARTBEAT: 1000,
  INITIAL_SYNC_REQUEST: 1000,
  PEER_CHECK: 2000
}

// Relay server configuration
export const RELAY_CONFIG = {
  HOP_TIMEOUT: 30000,
  MAX_RESERVATIONS: 1000,
  RESERVATION_TTL: 2 * 60 * 60 * 1000, // 2 hours
  DEFAULT_DATA_LIMIT: BigInt(1024 * 1024 * 1024), // 1 GB
  DEFAULT_DURATION_LIMIT: 2 * 60 * 1000, // 2 minutes
  MAX_CONNECTIONS: 1000,
  MAX_INCOMING_PENDING: 100,
  MAX_PEER_ADDRS_TO_DIAL: 100,
  DIAL_TIMEOUT: 30000
}

// Default values
export const DEFAULTS = {
  TOPIC: 'yjs-doc-1'
}

// Universal Connectivity topics (for interop with UC chat app)
export const UC_CHAT_TOPIC = 'universal-connectivity'
export const UC_FILE_TOPIC = 'universal-connectivity-file'
export const FILE_EXCHANGE_PROTOCOL = '/universal-connectivity-file/1'
export const DIRECT_MESSAGE_PROTOCOL = '/universal-connectivity/dm/1.0.0'
export const PUBSUB_PEER_DISCOVERY_TOPIC = 'universal-connectivity-browser-peer-discovery'

// Relay discovery. The old path resolved a single hard-coded UC bootstrap peer
// ID through delegated routing; that peer is gone and the lookup now returns an
// empty peer list, which left the node with no relay and no way to be reached.
// Relays instead self-register on a public Aleph channel and republish every
// 6 h, so discovery asks that channel for whatever is current.
//
// The profile scopes the answer: several relay implementations register in the
// same channel, and an orbitdb-relay cannot form a shared circuit with a UC
// browser. Universal Connectivity and this example must therefore agree on
// `uc-go-peer` — that agreement is what lets the two meet at all.
export const RELAY_BOOTSTRAP_PROFILE = 'uc-go-peer'

// Snapshot taken from the same Aleph channel, used only when discovery itself
// cannot be reached (offline, API down). It will go stale — every relay deploy
// mints a new peer ID — which is why it is the fallback and not the source.
export const RELAY_BOOTSTRAP_FALLBACK = [
  '/dns4/they-idea-quick-soda.2n6.me/tcp/443/tls/ws/p2p/16Uiu2HAkuwNWxbdqi4QAiX5HNNVA8hmk2Ya5LAAc5KUdSNwjLH7L',
  '/dns6/they-idea-quick-soda.2n6.me/tcp/443/tls/ws/p2p/16Uiu2HAkuwNWxbdqi4QAiX5HNNVA8hmk2Ya5LAAc5KUdSNwjLH7L',
  '/dns4/arena-soul-sniff-cube.2n6.me/tcp/443/tls/ws/p2p/16Uiu2HAmRCbUxTCZmDwPtRM7VnmjFHYxqCeQtGWLXG7ssLRczor2',
  '/dns6/arena-soul-sniff-cube.2n6.me/tcp/443/tls/ws/p2p/16Uiu2HAmRCbUxTCZmDwPtRM7VnmjFHYxqCeQtGWLXG7ssLRczor2'
]

export const DISCOVERY_CONFIG = {
  INTERVAL: 10000,
  TOPICS: [PUBSUB_PEER_DISCOVERY_TOPIC] // '_peer-discovery._p2p._pubsub'
}
