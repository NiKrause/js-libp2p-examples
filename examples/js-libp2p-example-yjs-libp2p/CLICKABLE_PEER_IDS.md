# Clickable Peer IDs in Group Chat

## Feature Overview
In group chat mode, peer IDs in received messages are now clickable links that allow you to quickly open a private chat with that peer.

## Implementation Details

### User Interface
- **Appearance**: Peer IDs in group chat messages appear as blue, underlined, clickable links with a cursor pointer
- **Tooltip**: Hovering shows "🔐 Click to send private message"
- **Visual Format**: `📥 12D3KooW...abc` (shortened peer ID with emoji)

### Behavior
1. **Click Action**: When you click a peer ID in a group message:
   - Checks if the peer supports Direct Messages protocol
   - If supported: switches to private chat mode with that peer
   - If not supported: shows error message "Peer does not support direct messages"

2. **Private Chat Only**: The clickable functionality is only available in group chat mode
   - In private chat mode, peer IDs are displayed but not clickable (you're already chatting with them)

### Code Changes

#### `displayChatMessage()` function (index.js)
```javascript
// Accepts peer ID parameter
const displayChatMessage = (text, isSent = false, peerId = null) => {
  // ...
  if (!isSent && peerId && currentChatMode === 'group') {
    // Create clickable peer ID link
    const peerLink = document.createElement('span')
    peerLink.textContent = `📥 ${peerShort}`
    peerLink.style.cursor = 'pointer'
    peerLink.style.textDecoration = 'underline'
    peerLink.style.color = '#1565c0'
    peerLink.title = '🔐 Click to send private message'
    peerLink.onclick = async () => {
      if (directMessageService && await directMessageService.isDMPeer(peerId)) {
        switchToPrivateChat(peerId)
      } else {
        log('Peer does not support direct messages', true)
      }
    }
    headerEl.appendChild(peerLink)
  }
}
```

#### Message Handler (index.js)
```javascript
// Pass full peer ID to displayChatMessage
if (incomingTopic === UC_CHAT_TOPIC) {
  if (currentChatMode === 'group') {
    displayChatMessage(`[${fromShort}] ${messageText}`, false, fromPeer)
  }
}
```

## User Experience Flow

1. **Receiving Group Message**: When a message arrives in group chat, you see:
   ```
   📥 12D3KooW...abc  (clickable)
   Hello everyone!
   ```

2. **Click to Start Private Chat**: Click the peer ID
   - Chat switches to private mode
   - Header changes to "🔐 Private: 12D3KooW...abc"
   - Back button (×) appears
   - Message history with that peer loads

3. **Return to Group**: Click the × button to return to group chat

## Benefits
- **Quick Access**: Start private conversations without navigating to peer list
- **Context-Aware**: Only works with DM-capable peers
- **Seamless UX**: Natural conversation flow from group to private chat
- **Visual Clarity**: Underlined blue links indicate interactivity

## Related Features
- Private Chat (see `PRIVATE_CHAT.md`)
- Peer List with DM indicators
- Direct Message Protocol
