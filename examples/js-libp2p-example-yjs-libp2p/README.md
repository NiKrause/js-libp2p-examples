# @libp2p/example-yjs-libp2p <!-- omit in toc -->

[![libp2p.io](https://img.shields.io/badge/project-libp2p-yellow.svg?style=flat-square)](http://libp2p.io/)
[![Discuss](https://img.shields.io/discourse/https/discuss.libp2p.io/posts.svg?style=flat-square)](https://discuss.libp2p.io)
[![codecov](https://img.shields.io/codecov/c/github/libp2p/js-libp2p-examples.svg?style=flat-square)](https://codecov.io/gh/libp2p/js-libp2p-examples)
[![CI](https://img.shields.io/github/actions/workflow/status/libp2p/js-libp2p-examples/ci.yml?branch=main\&style=flat-square)](https://github.com/libp2p/js-libp2p-examples/actions/workflows/ci.yml?query=branch%3Amain)

> A collaborative spreadsheet built with Yjs and libp2p, demonstrating real-time peer-to-peer document synchronization and Universal Connectivity Extension Protocol (UCEP)

## 🌐 Live Demo

**Try it now:** https://dweb.link/ipfs/bafybeibcs47xrlvt53lcq5eop2jjgxarumnm3ueyes6qydlecudvtwsm4m

## Table of Contents <!-- omit in toc -->

- [Overview](#overview)
- [UC Extension Protocol (UCEP)](#uc-extension-protocol-ucep)
- [Architecture](#architecture)
- [Setup](#setup)
- [Usage](#usage)
  - [Debug Mode](#debug-mode)
- [Browser Compatibility](#browser-compatibility)
- [How It Works](#how-it-works)
  - [Libp2p Configuration](#libp2p-configuration)
  - [Yjs Integration](#yjs-integration)
  - [Message Types](#message-types)
  - [Peer Discovery Flow](#peer-discovery-flow)
- [Key Features](#key-features)
- [Need help?](#need-help)
- [License](#license)
- [Contribution](#contribution)

## Overview

This example demonstrates how to create a [Yjs connection provider](https://docs.yjs.dev/ecosystem/connection-provider) using libp2p. The `yjs-libp2p-provider.js` file implements a custom provider that integrates libp2p's networking capabilities with Yjs, similar to how the standard [y-webrtc](https://github.com/yjs/y-webrtc) and [y-websocket](https://github.com/yjs/y-websocket) providers work, but with more control over the peer-to-peer networking stack.

Key features:

- **Custom Yjs Provider**: A libp2p-based connection provider for Yjs (`yjs-libp2p-provider.js`)
- **WebRTC Support**: Direct peer-to-peer connections using WebRTC
- **Circuit Relay**: NAT traversal via relay servers
- **AutoNAT**: Automatic NAT detection
- **PubSub**: GossipSub for document synchronization
- **Peer Discovery**: Automatic connection to discovered peers via pubsub peer discovery

## UC Extension Protocol (UCEP)

This example implements the **Universal Connectivity Extension Protocol** - a decentralized plugin system for libp2p applications. The spreadsheet is discoverable and controllable as an extension by other UC-compatible apps like the [Universal Connectivity chat](https://github.com/NiKrause/universal-connectivity).

### How It Works

1. **Discovery**: Extensions are discovered via libp2p's identify protocol (`/uc/extension/sheet/1.0.0`)
2. **Manifest Fetching**: Peers fetch extension metadata (name, commands, description)
3. **Command Execution**: Remote peers can execute commands via direct libp2p streams:
   - `/sheet-help` - Show available commands
   - `/sheet-show <topic> <cell>` - Read cell values
   - `/sheet-write <topic> <cell>=<value>` - Write to cells
   - `/sheet-list` - List active spreadsheet topics

### Testing Extensions

Open the browser console and try:
```javascript
// List discovered extensions
window.listExtensions()

// Test extension commands
window.testExtension('sheet', 'help')
window.testExtension('sheet', 'show', ['spreadsheet-1', 'A1'])
window.testExtension('sheet', 'write', ['spreadsheet-1', 'B1=42'])
```

Or connect from the [Universal Connectivity chat app](https://universal-connectivity.fly.dev/) to control the spreadsheet via chat commands!

**Learn more:** See [UC-EXTENSION-PROTOCOL.md](./UC-EXTENSION-PROTOCOL.md) for complete protocol documentation.

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
2. The application automatically connects via WebRTC-Direct on page load
3. Wait for a WebRTC connection to establish with other peers
4. Start editing cells in the spreadsheet
5. Open another browser tab/window with the same topic to collaborate
6. Changes will sync automatically between all connected peers

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

## Browser Compatibility

This example has been tested with the following browsers:

- ✅ **Chrome/Chromium**: Fully supported and tested
- ✅ **Firefox**: Fully supported and tested
- ⚠️ **Safari/WebKit**: Partial support - WebRTC-Direct connections work, but WebSocket connections to relay do not establish webrtc connection between browsers

**Recommendation:** Use Chrome or Chromium-based or Firefox browsers for the best experience. Safari/WebKit users should use WebRTC-Direct bootstrap connections.

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

1. Client connects to relay server via WebRTC-Direct or WebSocket
2. Client subscribes to the pubsub topic - one for peer discovery another one for document updates
3. Relay forwards pubsub messages between peers
4. Peers attempt direct WebRTC connections (using DCUTR for NAT traversal)

## Key Features

### Networking
- **WebRTC Direct**: Faster peer-to-peer connections with automatic NAT traversal via DCUTR
- **WebSocket**: Reliable relay-based connections when direct connections aren't possible
- **Direct Peer-to-Peer**: Real-time document sync directly between browsers via WebRTC
- **Relay-based**: Falls back to relay server for coordination when direct connections fail
- **Efficient Updates**: Uses Yjs's state-based CRDT for minimal bandwidth usage

### Spreadsheet Features
- **Formulas**: Support for cell references (`=A1+B1`) and range functions (`=SUM(A1:A10)`)
- **Automatic Recalculation**: Formulas update automatically when dependencies change
- **Circular Reference Detection**: Prevents infinite calculation loops
- **Copy/Cut/Paste**: Full clipboard support with keyboard shortcuts (Ctrl+C/X/V)
- **Undo/Redo**: Full undo/redo history using Yjs's built-in undo manager (Ctrl+Z/Y)
- **Keyboard Navigation**: Arrow keys, Tab, Enter, and Escape for efficient editing
- **Formula Bar**: Excel-like formula input bar
- **Real-time Collaboration**: All changes sync instantly across all connected peers

### Keyboard Shortcuts
- `Ctrl+C` / `Cmd+C` - Copy cell
- `Ctrl+X` / `Cmd+X` - Cut cell
- `Ctrl+V` / `Cmd+V` - Paste cell
- `Ctrl+Z` / `Cmd+Z` - Undo last change
- `Ctrl+Y` / `Cmd+Y` / `Ctrl+Shift+Z` - Redo undone change
- `Enter` - Move to cell below
- `Tab` / `Shift+Tab` - Move right/left
- `Arrow keys` - Navigate between cells
- `Esc` - Cancel editing and revert changes

## Need help?

- Read the [js-libp2p documentation](https://github.com/libp2p/js-libp2p/tree/main/doc)
- Check out the [js-libp2p API docs](https://libp2p.github.io/js-libp2p/)
- Check out the [general libp2p documentation](https://docs.libp2p.io) for tips, how-tos and more
- Read the [libp2p specs](https://github.com/libp2p/specs)
- Ask a question on the [js-libp2p discussion board](https://github.com/libp2p/js-libp2p/discussions)
- Read the [Yjs documentation](https://docs.yjs.dev/) for CRDT and collaborative editing concepts

## License

Licensed under either of

- Apache 2.0, ([LICENSE-APACHE](LICENSE-APACHE) / <http://www.apache.org/licenses/LICENSE-2.0>)
- MIT ([LICENSE-MIT](LICENSE-MIT) / <http://opensource.org/licenses/MIT>)

## Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you, as defined in the Apache-2.0 license, shall be
dual licensed as above, without any additional terms or conditions.
