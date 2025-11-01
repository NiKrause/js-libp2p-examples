# @libp2p/example-yjs-libp2p <!-- omit in toc -->

[![libp2p.io](https://img.shields.io/badge/project-libp2p-yellow.svg?style=flat-square)](http://libp2p.io/)
[![Discuss](https://img.shields.io/discourse/https/discuss.libp2p.io/posts.svg?style=flat-square)](https://discuss.libp2p.io)
[![codecov](https://img.shields.io/codecov/c/github/libp2p/js-libp2p-examples.svg?style=flat-square)](https://codecov.io/gh/libp2p/js-libp2p-examples)
[![CI](https://img.shields.io/github/actions/workflow/status/libp2p/js-libp2p-examples/ci.yml?branch=main\&style=flat-square)](https://github.com/libp2p/js-libp2p-examples/actions/workflows/ci.yml?query=branch%3Amain)

> A collaborative spreadsheet built with Yjs and libp2p, demonstrating real-time peer-to-peer document synchronization

## Table of Contents <!-- omit in toc -->

- [Overview](#overview)
- [Architecture](#architecture)
- [Setup](#setup)
- [Usage](#usage)
  - [Debug Mode](#debug-mode)
- [How It Works](#how-it-works)
  - [Libp2p Configuration](#libp2p-configuration)
  - [Yjs Integration](#yjs-integration)
  - [Message Types](#message-types)
  - [Peer Discovery Flow](#peer-discovery-flow)
- [Key Features](#key-features)
  - [🔗 Decentralized Architecture](#-decentralized-architecture)
  - [🌐 NAT Traversal](#-nat-traversal)
  - [🔄 Real-time Sync](#-real-time-sync)
  - [📡 Efficient Messaging](#-efficient-messaging)
  - [🔌 Relay Fallback](#-relay-fallback)
  - [🤝 Auto-discovery](#-auto-discovery)
- [Need help?](#need-help)
- [License](#license)
- [Contribution](#contribution)

## Overview

This example demonstrates how to create a Yjs connection provider using libp2p instead of the standard y-webrtc connector. It showcases:

- **Custom Yjs Provider**: A libp2p-based connection provider for Yjs
- **WebRTC Support**: Direct peer-to-peer connections using WebRTC
- **Circuit Relay**: NAT traversal via relay servers
- **AutoNAT**: Automatic NAT detection
- **PubSub**: GossipSub for document synchronization
- **Peer Discovery**: Automatic connection to discovered peers via pubsub peer discovery

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

1. Keep the default topic (`spreadsheet-1`) or enter a custom one
2. Click "Connect"
3. Start editing cells in the spreadsheet
4. Open another browser tab/window and connect with the same topic
5. Changes will sync automatically between all connected peers

**Note:** The browser automatically connects to the relay server configured in `bootstrappers.js`. 

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

## Need help?

- Read the [js-libp2p documentation](https://github.com/libp2p/js-libp2p/tree/main/doc)
- Check out the [js-libp2p API docs](https://libp2p.github.io/js-libp2p/)
- Check out the [general libp2p documentation](https://docs.libp2p.io) for tips, how-tos and more
- Read the [libp2p specs](https://github.com/libp2p/specs)
- Ask a question on the [js-libp2p discussion board](https://github.com/libp2p/js-libp2p/discussions)

## License

Licensed under either of

- Apache 2.0, ([LICENSE-APACHE](LICENSE-APACHE) / <http://www.apache.org/licenses/LICENSE-2.0>)
- MIT ([LICENSE-MIT](LICENSE-MIT) / <http://opensource.org/licenses/MIT>)

## Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you, as defined in the Apache-2.0 license, shall be
dual licensed as above, without any additional terms or conditions.
