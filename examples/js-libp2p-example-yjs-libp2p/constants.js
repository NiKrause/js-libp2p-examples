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
// Relays whose address is stable and known, so no routing lookup is needed.
export const KNOWN_RELAY_MULTIADDRS = [
  '/dns4/deal-wolf-soft-mandate.2n6.me/tcp/443/tls/ws/p2p/16Uiu2HAmEUA5iVEscf8FpRqok8a4G2iQLNvZJByPxoJZnyWda7Bu'
]

export const PUBSUB_PEER_DISCOVERY_TOPIC = 'universal-connectivity-browser-peer-discovery'

// UC Bootstrap peer ID
export const WEBTRANSPORT_BOOTSTRAP_PEER_ID = '12D3KooWFhXabKDwALpzqMbto94sB7rvmZ6M28hs9Y9xSopDKwQr'
export const BOOTSTRAP_PEER_IDS = [WEBTRANSPORT_BOOTSTRAP_PEER_ID]

export const DISCOVERY_CONFIG = {
  INTERVAL: 10000,
  TOPICS: [PUBSUB_PEER_DISCOVERY_TOPIC] // '_peer-discovery._p2p._pubsub'
}
