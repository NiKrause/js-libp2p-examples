# Private Chat Feature

This document describes the private chat feature implementation using Universal Connectivity's Direct Message protocol.

## Overview

The private chat feature enables direct peer-to-peer messaging between connected libp2p nodes. It uses the same protocol as Universal Connectivity (`/universal-connectivity/dm/1.0.0`) and follows the request-response pattern with protobuf serialization.

## Architecture

### Protocol
- **Protocol ID**: `/universal-connectivity/dm/1.0.0`
- **Message Format**: Protobuf (defined in `protobuf/direct-message.proto`)
- **Pattern**: Request-Response with acknowledgment

### Components

1. **Direct Message Service** (`direct-message.js`)
   - Handles sending and receiving private messages
   - Manages protocol registration and stream lifecycle
   - Dispatches events for received messages

2. **Protobuf Definitions** (`protobuf/direct-message.proto`)
   - `DirectMessageRequest`: Contains message content, type, and metadata
   - `DirectMessageResponse`: Status and acknowledgment
   - `Metadata`: Client version and timestamp

3. **Integration** (`index.js`)
   - Service initialization
   - Event listeners for incoming messages
   - Console functions for sending messages

## Usage

### Sending Private Messages

From the browser console:

```javascript
// Get list of connected peers
libp2pNode.getPeers()

// Send private message to a specific peer
sendPrivateMessage('12D3KooW...', 'Hello, this is a private message!')
```

### Receiving Private Messages

Private messages are automatically logged to the console. The event handler logs:
- Sender's peer ID
- Message content
- Timestamp

Example output:
```
🔐 Private message from 12D3KooW...abcd: "Hello, this is a private message!"
   📩 From: 12D3KooWABC123...
   📝 Content: Hello, this is a private message!
   ⏰ Time: 10:30:45 AM
```

## Implementation Details

### Message Flow

1. **Sending**:
   - User calls `sendPrivateMessage(peerId, text)`
   - Service opens stream to peer using protocol negotiation
   - Creates `DirectMessageRequest` with content and metadata
   - Sends request via protobuf stream
   - Waits for acknowledgment (`DirectMessageResponse`)
   - Closes stream

2. **Receiving**:
   - Incoming stream triggers protocol handler
   - Reads `DirectMessageRequest` from stream
   - Sends `DirectMessageResponse` with OK status
   - Dispatches `dm:message` event to libp2p
   - Closes stream

### Error Handling

The service includes comprehensive error handling:
- Connection failures
- Stream creation errors
- Timeout protection (5 second timeout)
- Proper stream cleanup in all cases

### Compatibility

This implementation is fully compatible with:
- Universal Connectivity chat application
- Any libp2p node implementing the `/universal-connectivity/dm/1.0.0` protocol
- Cross-language implementations (JavaScript, Rust, Go, etc.)

## Testing

### Manual Testing

1. Start the relay server:
   ```bash
   npm run relay
   ```

2. Open two browser windows:
   - Window 1: http://localhost:5173
   - Window 2: http://localhost:5173

3. Wait for both to connect to the relay and discover each other

4. In Window 1 console:
   ```javascript
   // Get Window 2's peer ID
   const peers = libp2pNode.getPeers()
   console.log(peers.map(p => p.toString()))
   
   // Send private message to Window 2
   sendPrivateMessage(peers[0].toString(), 'Private hello!')
   ```

5. Check Window 2 console for the received message

### Automated Testing

The implementation can be tested using Playwright (see `test/` directory for examples).

## Future Enhancements

Potential improvements:
1. **UI Integration**: Add dedicated private chat panel in the UI
2. **Message History**: Store private messages in local storage
3. **Peer Selection**: Dropdown to select recipient from connected peers
4. **Read Receipts**: Track message delivery and read status
5. **Typing Indicators**: Show when peer is typing
6. **File Sharing**: Extend to support private file transfers

## Technical Notes

### Stream Management

The implementation follows libp2p best practices for stream management:
- Proper timeout handling
- Cleanup in finally blocks
- Abort on errors
- Graceful closure

### Protobuf Usage

Uses `it-protobuf-stream` for efficient serialization:
- Type-safe message encoding/decoding
- Streaming support for large messages
- Compatible with other libp2p implementations

### Service Pattern

Follows libp2p service factory pattern:
- Clean initialization and cleanup
- Event-based API
- Proper lifecycle management

## References

- [Universal Connectivity Project](https://github.com/libp2p/universal-connectivity)
- [libp2p Documentation](https://docs.libp2p.io)
- [Protobuf Documentation](https://developers.google.com/protocol-buffers)
- [it-protobuf-stream](https://github.com/alanshaw/it-protobuf-stream)
