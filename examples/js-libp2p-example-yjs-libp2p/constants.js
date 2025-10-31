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
