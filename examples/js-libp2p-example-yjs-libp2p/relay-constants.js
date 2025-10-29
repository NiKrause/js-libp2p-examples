/**
 * Configuration constants for the relay server
 */

// Debug mode - set via environment variable
export const DEBUG = process.env.DEBUG === 'true' || false

// Relay server timeouts (milliseconds)
export const RELAY_TIMEOUTS = {
  HOP_TIMEOUT: 30000,
  PROTOCOL_NEGOTIATION_INBOUND: 30000,
  PROTOCOL_NEGOTIATION_OUTBOUND: 30000,
  UPGRADE_INBOUND: 30000,
  UPGRADE_OUTBOUND: 30000,
  DIAL_TIMEOUT: 30000
}

// Relay server reservation configuration
export const RELAY_RESERVATIONS = {
  MAX_RESERVATIONS: 1000,
  RESERVATION_TTL: 2 * 60 * 60 * 1000, // 2 hours
  DEFAULT_DATA_LIMIT: BigInt(1024 * 1024 * 1024), // 1 GB
  DEFAULT_DURATION_LIMIT: 2 * 60 * 1000 // 2 minutes
}

// Connection manager configuration
export const CONNECTION_CONFIG = {
  MAX_CONNECTIONS: 1000,
  MAX_INCOMING_PENDING: 100,
  MAX_PEER_ADDRS_TO_DIAL: 100
}

// Peer discovery configuration
export const DISCOVERY_CONFIG = {
  INTERVAL: 5000,
  TOPICS: ['_peer-discovery._p2p._pubsub']
}

// Monitoring intervals (milliseconds)
export const MONITORING = {
  TOPIC_STATUS_INTERVAL: 10000
}

// Default Yjs topic to subscribe
export const DEFAULT_TOPIC = 'yjs-doc-1'
