# @libp2p/example-yjs-libp2p <!-- omit in toc -->

A collaborative text editor built with Yjs and libp2p, demonstrating real-time peer-to-peer document synchronization.

## Table of Contents <!-- omit in toc -->

- [Overview](#overview)
- [Architecture](#architecture)
- [Setup](#setup)
- [Usage](#usage)
- [How It Works](#how-it-works)
- [Key Features](#key-features)
- [License](#license)

## Overview

This example demonstrates how to create a Yjs connection provider using libp2p instead of the standard y-webrtc connector. It showcases:

- **Custom Yjs Provider**: A libp2p-based connection provider for Yjs
- **WebRTC Support**: Direct peer-to-peer connections using WebRTC
- **Circuit Relay**: NAT traversal via relay servers
- **DCUTR**: Direct Connection Upgrade through Relay (hole punching)
- **AutoNAT**: Automatic NAT detection
- **PubSub**: GossipSub for document synchronization
- **Peer Discovery**: Automatic connection to discovered peers

## Architecture

```
┌─────────────┐         ┌─────────────┐
│  Browser 1  │         │  Browser 2  │
│             │         │             │
│  Yjs Doc ←──┼─────────┼──→ Yjs Doc  │
│     ↕       │  WebRTC │      ↕      │
│  libp2p     │    or   │   libp2p    │
│  (pubsub)   │  Relay  │  (pubsub)   │
└──────┬──────┘         └──────┬──────┘
       │                       │
       │    ┌─────────────┐    │
       └────┤ Relay Node  │────┘
            │  (relay.js) │
            └─────────────┘
```

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the relay server:
```bash
npm run relay
```

The relay will output its multiaddr, which looks like:
```
/ip4/127.0.0.1/tcp/53472/ws/p2p/12D3KooWABC123...
```

3. Start the development server:
```bash
npm start
```

4. Open http://localhost:5173 in multiple browser tabs or windows

## Usage

1. Copy the relay multiaddr from the terminal output
2. Paste it into the "Relay multiaddr" field in the browser
3. Keep the default topic or enter a custom one
4. Click "Connect"
5. Start typing in the text area
6. Open another browser tab/window, connect to the same relay and topic
7. Changes will sync automatically between all connected peers

### Debug Mode

To enable verbose logging:

**Relay server:**
```bash
npm run relay:debug
```

**Browser client:**
Add `?debug=true` to the URL:
```
http://localhost:5173/?debug=true
```

## How It Works

### Libp2p Configuration

The browser clients are configured with:

- **Transports**: WebSockets (for relay), WebRTC (for direct P2P), Circuit Relay
- **Security**: Noise protocol for encryption
- **Stream Muxing**: Yamux
- **Services**:
  - `identify`: Peer identification
  - `autoNAT`: NAT detection
  - `dcutr`: Hole punching for direct connections
  - `pubsub`: GossipSub for broadcasting document updates

### Yjs Integration

The custom `Libp2pProvider` class:

1. **Subscribes** to a pubsub topic for the Yjs document
2. **Listens** for Yjs document updates and broadcasts them via pubsub
3. **Receives** updates from other peers and applies them to the local document
4. **Discovers** peers subscribing to the same topic
5. **Connects** directly to discovered peers (using WebRTC when possible)
6. **Syncs** initial state using Yjs's state vector protocol

### Message Types

The provider uses three message types:

- `update`: Broadcasts document changes to all peers
- `sync-request`: Requests the current document state (sent on join)
- `sync-response`: Sends the current state to a requesting peer

### Peer Discovery Flow

1. Client connects to relay server via WebSocket
2. Client subscribes to the pubsub topic
3. Relay forwards pubsub messages between peers
4. When a peer subscribes to the same topic, both peers discover each other
5. Peers attempt direct WebRTC connections (using DCUTR for NAT traversal)
6. If direct connection fails, communication continues through the relay

## Key Features

### 🔗 Decentralized Architecture
No central server required - peers communicate directly when possible

### 🌐 NAT Traversal
Automatic hole punching via DCUTR for direct connections behind NATs

### 🔄 Real-time Sync
Changes propagate instantly to all connected peers

### 📡 Efficient Messaging
Uses Yjs's state-based CRDT for minimal bandwidth usage

### 🔌 Relay Fallback
Falls back to relay when direct connections aren't possible

### 🤝 Auto-discovery
Peers automatically discover and connect to each other

## License

Licensed under either of

- Apache 2.0, ([LICENSE-APACHE](LICENSE-APACHE) / <http://www.apache.org/licenses/LICENSE-2.0>)
- MIT ([LICENSE-MIT](LICENSE-MIT) / <http://opensource.org/licenses/MIT>)

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the work by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.
