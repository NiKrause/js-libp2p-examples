# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

A collaborative text editor built with Yjs and libp2p, demonstrating real-time peer-to-peer document synchronization. This example replaces the standard y-webrtc connector with a custom libp2p-based provider for Yjs.

## Development Commands

### Starting the Application
```bash
# Start the relay server (required for peer connectivity)
npm run relay

# Start the Vite development server
npm start
```

**Important**: Copy the relay multiaddr from terminal output and paste into the browser UI before connecting.

### Build and Test
```bash
# Build production bundle
npm run build

# Run all tests (starts relay server + dev server automatically)
npm test

# Run tests in specific browsers
npm run test:chrome
npm run test:firefox
```

## Architecture

### Core Components

**Libp2pProvider** (`yjs-libp2p-provider.js`)
- Custom Yjs connection provider using libp2p's pubsub instead of y-webrtc
- Manages document synchronization across peers via GossipSub
- Message types:
  - `update`: broadcasts document changes
  - `sync-request`: requests current document state (sent on join)
  - `sync-response`: sends current state to requesting peer
- Listens to `peer:discovery` events (libp2p auto-dialer handles connections)

**Browser Client** (`index.js`)
- Creates libp2p node with WebRTC, WebSockets, and circuit relay transports
- **Critical config**:
  - Listen on `/p2p-circuit` for relay discoverability
  - Listen on `/webrtc` for direct P2P connections
  - `pubsubPeerDiscovery` enabled for peer discovery via gossipsub
  - `connectionGater` allows local addresses (for demo)
- Services: identify, autoNAT, dcutr, gossipsub
- Binds textarea to Yjs document via `oninput` event

**Relay Server** (`relay.js`)
- Node.js libp2p relay server for WebSocket connections
- Enables NAT traversal via circuit relay
- Forwards pubsub messages between peers
- **Critical**: `maxReservations: Infinity` is for demo only—use default (15) in production

### Network Flow

1. Browser clients connect to relay server via WebSocket
2. Clients listen on `/p2p-circuit` to become discoverable via relay
3. Clients subscribe to a pubsub topic (document channel)
4. pubsubPeerDiscovery broadcasts peer info on the pubsub topic
5. Peers discover each other via `peer:discovery` events
6. libp2p's auto-dialer connects discovered peers
7. Peers attempt direct WebRTC connections using DCUTR (hole punching)
8. If WebRTC fails, communication continues through relay
9. Yjs updates broadcast via pubsub to all connected peers

### Key libp2p Configuration

**Listen addresses**:
- `/p2p-circuit`: Make reservation on relay (lets other peers dial us via relay)
- `/webrtc`: Listen for incoming WebRTC connections

**Transports**:
- `webSockets`: for relay connections
- `webRTC`: for direct peer-to-peer connections
- `circuitRelayTransport`: fallback relay connectivity

**Peer Discovery**:
- `pubsubPeerDiscovery`: Broadcasts peer info on gossipsub topics

**Services**:
- `identify`: peer identification and metadata exchange
- `autoNAT`: automatic NAT detection
- `dcutr`: Direct Connection Upgrade through Relay (hole punching)
- `pubsub` (gossipsub): message broadcasting for Yjs updates

### Yjs Synchronization

The Libp2pProvider handles Yjs sync using state vectors:
- On connection: sends sync-request with local state vector after 1s delay
- Peers respond with sync-response containing missing updates
- Ongoing changes broadcast as update messages via `doc.on('update')`
- Updates apply with `origin: this` to prevent echo loops
- Textarea updates trigger `oninput` → transact → delete + insert → pubsub broadcast

## Development Patterns

### When modifying Libp2pProvider
- Always set `origin: this` when applying network updates to prevent broadcast loops
- Use base64 encoding for binary Yjs data in JSON messages
- Listen to `peer:discovery` not `subscription-change` - discovery happens before subscription
- Let libp2p's auto-dialer handle connections - don't manually dial discovered peers

### When working with libp2p configuration
- **Must include `/p2p-circuit` in listen addresses** for relay-based discovery to work
- Test with multiple browser instances to verify P2P connectivity
- Check browser console for peer connection logs
- WebRTC connections require HTTPS in production (localhost works for dev)

### When debugging sync issues
- Check relay server is running and accessible
- Verify peers are on the same pubsub topic
- Look for `Document synced with network` log message
- Check if peers discovered each other: look for `Discovered peer:` logs
- Verify peers connected: look for `Connected to peer:` logs
- Examine state vectors in sync-request/sync-response messages

## Testing Notes

### Test Infrastructure

**Automated setup**:
- `test/global-setup.js`: Starts relay server, saves multiaddr to `test/relay-info.json`
- `test/global-teardown.js`: Stops relay server after tests
- `playwright.config.js`: Auto-starts Vite preview server, includes global setup/teardown

**Current test coverage**:
- ✅ Page loading in multiple browser contexts
- ✅ Relay server starts/stops automatically  
- ✅ Both pages connect to relay successfully
- ✅ UI elements render correctly
- ❌ Yjs collaborative editing sync (debugging in progress)

### Recent Improvements Made

1. **Added `/p2p-circuit` listen address** - Critical for relay-based peer discovery
2. **Added `pubsubPeerDiscovery`** - Enables peer discovery via gossipsub
3. **Added `connectionGater`** - Allows local address dialing for tests
4. **Fixed event listeners** - Changed from `subscription-change` to `peer:discovery`
5. **Removed manual dialing** - Let libp2p's auto-dialer handle peer connections
6. **Updated to latest js-libp2p-examples** - Verified config matches current best practices

### Why Collaboration Test Doesn't Work Yet

Peers successfully:
- ✅ Connect to relay via WebSocket
- ✅ Subscribe to same pubsub topic
- ✅ Both show "Ready!" message

Peers do NOT:
- ❌ Discover each other (no `Discovered peer:` logs)
- ❌ Connect to each other (no `Connected to peer:` logs) 
- ❌ Sync Yjs updates

**Root cause**: pubsubPeerDiscovery requires peers to be on the **same pubsub topic AND connected** to discover each other. In headless browser tests:
- Peers only connect to relay (WebSocket)
- WebRTC P2P connections don't establish
- Without direct connections, pubsubPeerDiscovery can't propagate peer info
- Pubsub messages ARE delivered through relay, but discovery doesn't happen

### Possible Solutions

1. **Manual testing** works fine: `npm run relay` + `npm start` in multiple real browser tabs
2. **Headed browser mode**: Run Playwright tests with `headless: false` to enable WebRTC
3. **Manual peer dialing**: After connecting to relay, manually dial other peer's circuit relay address
4. **Alternative discovery**: Use subscription-change events to detect peers on same topic, then dial
5. **Test pubsub directly**: Verify pubsub message delivery rather than full Yjs sync
