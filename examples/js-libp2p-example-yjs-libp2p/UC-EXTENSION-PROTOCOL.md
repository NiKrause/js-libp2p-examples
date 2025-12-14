# UC Extension Protocol (UCEP)

## Overview

The **Universal Connectivity Extension Protocol (UCEP)** is a decentralized plugin system for libp2p applications. It enables peers to discover and interact with extensions (plugins/services) provided by other peers in a fully peer-to-peer manner, without any central registry or server.

## Protocol Design

### Discovery via Identify Protocol

Extensions are discovered automatically through libp2p's **identify protocol**:

1. When peers connect, they exchange protocol information via identify
2. Each extension registers a protocol: `/uc/extension/{extensionId}/{version}`
3. Peers detect extension protocols and fetch manifests to learn capabilities
4. No central registry needed - discovery happens through peer connections

### Communication via Direct Streams

Extension communication uses **pbStream** (protobuf streams) over direct libp2p connections:

- **Manifest Requests**: Fetch extension metadata (name, description, commands)
- **Command Requests**: Execute extension commands with request-response pattern
- Same pattern as Direct Message protocol - reliable, typed, bidirectional

### Protocol Format

```
/uc/extension/{extensionId}/{version}

Examples:
/uc/extension/sheet/1.0.0       - Collaborative Spreadsheet
/uc/extension/calculator/1.0.0  - Shared Calculator
/uc/extension/chat-bot/2.1.0    - AI Chat Bot
```

## Architecture

### Extension Provider

The peer that provides an extension:

```javascript
class UCExtensionService {
  async start() {
    // Register topology for peer tracking
    this.topologyId = await this.libp2p.register(EXTENSION_PROTOCOL, {
      onConnect: (peerId) => { /* track peer */ },
      onDisconnect: (peerId) => { /* cleanup */ }
    })
  }

  async afterStart() {
    // Handle incoming requests via pbStream
    await this.libp2p.handle(EXTENSION_PROTOCOL, async ({ stream, connection }) => {
      const datastream = pbStream(stream)
      const request = await datastream.read(ext.Request, { signal })
      
      if (request.manifest) {
        // Return extension manifest
        const response = createManifestResponse()
        await datastream.write(response, ext.Response, { signal })
      } else if (request.command) {
        // Execute command and return result
        const response = await executeCommand(request.command)
        await datastream.write(response, ext.Response, { signal })
      }
    })
  }
}
```

### Extension Consumer (Discovery & consumption side)

The peer that uses extensions:

```javascript
class ExtensionManager {
  async start() {
    // Listen for peer identification
    this.libp2p.addEventListener('peer:identify', (evt) => {
      const { peerId, protocols } = evt.detail
      
      // Look for extension protocols
      for (const protocol of protocols) {
        if (protocol.startsWith('/uc/extension/')) {
          // Discovered an extension!
          this.fetchManifest(peerId, protocol)
        }
      }
    })
  }

  async fetchManifest(peerId, protocol) {
    const stream = await this.libp2p.dialProtocol(peerId, protocol)
    const datastream = pbStream(stream)
    
    const request = { manifest: { timestamp: BigInt(Date.now()) } }
    await datastream.write(request, ext.Request, { signal })
    
    const response = await datastream.read(ext.Response, { signal })
    // Store manifest, show in UI
  }

  async executeCommand(extensionId, command, args) {
    const extension = this.installedExtensions.get(extensionId)
    const stream = await this.libp2p.dialProtocol(extension.peerId, extension.protocol)
    const datastream = pbStream(stream)
    
    const request = {
      command: { requestId: uuid(), extensionId, command, args, timestamp }
    }
    await datastream.write(request, ext.Request, { signal })
    
    const response = await datastream.read(ext.Response, { signal })
    return response.command
  }
}
```

## Message Format (Protobuf)

### Request

```protobuf
message Request {
  oneof payload {
    ManifestRequest manifest = 1;
    CommandRequest command = 2;
  }
}

message ManifestRequest {
  int64 timestamp = 1;
}

message CommandRequest {
  string requestId = 1;
  string extensionId = 2;
  string command = 3;
  repeated string args = 4;
  int64 timestamp = 5;
}
```

### Response

```protobuf
message Response {
  oneof payload {
    ManifestResponse manifest = 1;
    CommandResponse command = 2;
  }
}

message ManifestResponse {
  ExtensionManifest manifest = 1;
  int64 timestamp = 2;
}

message CommandResponse {
  string requestId = 1;
  bool success = 2;
  optional string data = 3;       // JSON-encoded data
  optional string error = 4;
  int64 timestamp = 5;
}
```

### Extension Manifest

```protobuf
message ExtensionManifest {
  string id = 1;
  string name = 2;
  string version = 3;
  string description = 4;
  string author = 5;
  string publicUrl = 6;           // URL to extension UI
  repeated ExtensionCommand commands = 7;
  string icon = 8;                // Icon URL or data URI
}

message ExtensionCommand {
  string name = 1;
  string syntax = 2;
  string description = 3;
}
```

## This Example: Collaborative Spreadsheet Extension

This example implements a **Yjs-based collaborative spreadsheet** as a UC extension:

### Features

- Real-time collaborative editing using Yjs CRDT
- Peer-to-peer sync via libp2p pubsub
- Discoverable as UC extension via UCEP
- Command interface for remote access:
  - `/sheet-help` - Show available commands
  - `/sheet-show <topic> <cell>` - Read cell value
  - `/sheet-write <topic> <cell>=<value>` - Write cell value
  - `/sheet-list` - List active spreadsheet topics

### Extension Manifest

```json
{
  "id": "sheet",
  "name": "Collaborative Spreadsheet",
  "version": "1.0.0",
  "description": "Real-time collaborative spreadsheet with formulas",
  "author": "libp2p Examples",
  "publicUrl": "https://your-spreadsheet-url.com",
  "icon": "📊",
  "commands": [
    { "name": "help", "syntax": "/sheet-help", "description": "..." },
    { "name": "show", "syntax": "/sheet-show <topic> <cell>", "description": "..." },
    { "name": "write", "syntax": "/sheet-write <topic> <cell>=<value>", "description": "..." },
    { "name": "list", "syntax": "/sheet-list", "description": "..." }
  ]
}
```

## Universal Connectivity Implementation

The [Universal Connectivity project](https://github.com/NiKrause/universal-connectivity) implements the full UCEP client side:

### Client Components

1. **ExtensionManager** (`js-peer/src/lib/extension-manager.ts`)
   - Discovers extensions via identify protocol
   - Fetches and stores manifests
   - Manages installed extensions in localStorage
   - Tracks available peers per extension

2. **ExtensionProtocol** (`js-peer/src/lib/extension-protocol.ts`)
   - Executes commands on remote extensions
   - Handles peer selection (tries multiple peers)
   - Marks successful peers for prioritization

3. **UI Integration** (`js-peer/src/context/extension-ctx.tsx`)
   - Shows available extensions
   - Install/uninstall UI
   - Command execution from chat interface
   - Parses commands like `/sheet-show hackathon A1`

### Chat Integration

In UC chat, users can:
1. See discovered extensions in the Extensions panel
2. Click "Install" to enable an extension
3. Use commands directly in chat: `/extensionId-command args`
4. See results displayed in chat

### Example Flow

```
User in UC Chat                  Spreadsheet Extension
     |                                   |
     | (connects to network)             |
     |<----------- identify ------------>|
     |    protocols: [/uc/extension/sheet/1.0.0]
     |                                   |
     | --- fetch manifest request -->   |
     |<-- manifest response -----------  |
     |                                   |
     | (user installs extension)         |
     | (user types: /sheet-show demo A1) |
     |                                   |
     | --- command request ----------->  |
     |     { command: "show",            |
     |       args: ["demo", "A1"] }      |
     |                                   |
     |<-- command response -------------  |
     |     { success: true,              |
     |       data: { value: 42 } }       |
     |                                   |
     | (displays: Cell A1 = 42)          |
```

## Key Benefits

1. **Fully Decentralized**: No central registry, discovery via peer connections
2. **Language Agnostic**: Any language with libp2p can implement UCEP
3. **Type Safe**: Protobuf ensures consistent message format
4. **Secure**: Uses libp2p's encryption and authentication
5. **Extensible**: New extensions can be added without protocol changes
6. **Real-time**: Direct peer-to-peer communication
7. **Resilient**: Multiple peers can provide same extension

## Comparison with Direct Message Protocol

Both UCEP and Direct Messages use the same libp2p patterns:

| Feature | Direct Messages | Extensions |
|---------|----------------|------------|
| Discovery | Topology tracking | Identify protocol |
| Protocol | `/universal-connectivity/dm/1.0.0` | `/uc/extension/{id}/{version}` |
| Transport | pbStream | pbStream |
| Pattern | Request-Response | Request-Response |
| Message Type | Text content | Commands + JSON data |
| Use Case | Private chat | Remote procedure calls |

Both follow UC v2.x service pattern:
- `start()` - Register topology
- `afterStart()` - Register handler
- `stop()` - Cleanup
- Handler receives `{ stream, connection }`
- Uses `pbStream` for typed communication

## Testing

This example includes a test client for development:

```javascript
// Open browser console
window.listExtensions()  // Show discovered extensions
window.testExtension('sheet', 'help')  // Test help command
window.testExtension('sheet', 'show', ['demo', 'A1'])  // Test show
window.testExtension('sheet', 'write', ['demo', 'B1=100'])  // Test write
```

Or connect to the actual UC chat app to test the full integration!
