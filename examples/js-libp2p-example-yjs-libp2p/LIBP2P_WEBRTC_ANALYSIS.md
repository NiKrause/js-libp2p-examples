# libp2p WebRTC Transport Analysis

## 🔍 How libp2p WebRTC Signaling Works

Based on the source code in `node_modules/@libp2p/webrtc/src/private-to-private/`:

### Architecture

```
Peer A (Initiator)                Relay Server                Peer B (Recipient)
      |                                 |                              |
      |--- Open signaling stream ------>|<---- Handle protocol --------|
      |                                 |                              |
      |--- SDP Offer ------------------>|----------------------------->|
      |                                 |                              |
      |<-- SDP Answer ------------------|<----------------------------|
      |                                 |                              |
      |--- ICE Candidate 1 ------------>|----------------------------->|
      |--- ICE Candidate 2 ------------>|----------------------------->|
      |<-- ICE Candidate 1 -------------|<----------------------------|
      |<-- ICE Candidate 2 -------------|<----------------------------|
      |                                 |                              |
      |<=== Direct WebRTC Connection established =====================>|
      |                                 |                              |
      |--- Close signaling stream ----->|                              |
```

### Key Functions

#### 1. **initiate-connection.ts** (Initiator/Dialer)
- Creates RTCPeerConnection with your `rtcConfiguration` (including STUN servers)
- Creates offer and sends via protobuf message stream
- Sets up `onicecandidate` callback to send local candidates
- Calls `readCandidatesUntilConnected()` to receive remote candidates
- Waits for connection to be established

**Code Flow:**
```typescript
// Line 96-124: Sets up ICE candidate sending
peerConnection.onicecandidate = ({ candidate }) => {
  if (candidate == null || candidate?.candidate === '') {
    // End of candidates
    return
  }
  
  // Send candidate to remote peer via signaling stream
  messageStream.write({
    type: Message.Type.ICE_CANDIDATE,
    data: JSON.stringify(candidate.toJSON())
  })
}

// Line 175-180: Reads remote candidates
await readCandidatesUntilConnected(peerConnection, messageStream, {
  direction: 'initiator',
  signal,
  log,
  onProgress
})
```

#### 2. **signaling-stream-handler.ts** (Recipient/Listener)
- Receives offer via message stream
- Creates answer and sends back
- Sets up `onicecandidate` callback (same as initiator)
- Calls `readCandidatesUntilConnected()` to receive remote candidates

**Code Flow:**
```typescript
// Line 23-51: Sets up ICE candidate sending (same as initiator)
peerConnection.onicecandidate = ({ candidate }) => {
  if (candidate == null || candidate?.candidate === '') {
    return
  }
  
  messageStream.write({
    type: Message.Type.ICE_CANDIDATE,
    data: JSON.stringify(candidate.toJSON())
  })
}

// Line 97-101: Reads remote candidates
await readCandidatesUntilConnected(peerConnection, messageStream, {
  direction: 'recipient',
  signal,
  log
})
```

#### 3. **util.ts: readCandidatesUntilConnected()**
- Races between connection success and reading candidates from stream
- Parses each candidate and calls `pc.addIceCandidate(candidate)`
- Continues until connection is established or stream ends

**Code Flow:**
```typescript
// Line 18-75: Main candidate reading loop
while (true) {
  const message = await Promise.race([
    connectedPromise.promise,  // Resolves when pc.connectionState === 'connected'
    stream.read({ signal })    // Reads next candidate from signaling stream
  ])
  
  if (message == null) {
    break  // Connected or stream ended
  }
  
  if (message.type !== Message.Type.ICE_CANDIDATE) {
    throw new InvalidMessageError('ICE candidate message expected')
  }
  
  const candidateInit = JSON.parse(message.data)
  const candidate = new RTCIceCandidate(candidateInit)
  
  await pc.addIceCandidate(candidate)  // Add remote candidate to connection
}
```

## 🐛 Why It Might Be Failing

### Hypothesis 1: Same Public IP Problem ✅ (Confirmed)
When both peers are behind the same router:
- **Host candidates** (local IP like 192.168.x.x) → ✅ Would work if used
- **SRFLX candidates** (public IP via STUN) → ❌ Both peers get same public IP, ICE fails

**Evidence from our debugging:**
- Manual WebRTC test with host-only candidates: ✅ Works
- libp2p with STUN enabled: ❌ Fails
- Console shows SRFLX candidates being prioritized

### Hypothesis 2: Signaling Stream Issues
Possible problems:
- **Relay connection timeout** - Circuit relay might be slow/failing
- **Stream not established** - Protocol handler not being called
- **Candidates not being sent** - `onicecandidate` not firing
- **Candidates not being received** - Stream reading failing

### Hypothesis 3: ICE Candidate Filtering
libp2p code shows **NO** filtering of host candidates! It sends all candidates:
```typescript
if (candidate == null || candidate?.candidate === '') {
  return  // Only skips end-of-candidates markers
}
// Otherwise, ALL candidates are sent!
```

## 🔬 Debugging Strategy

### Step 1: Enable libp2p's Internal Logging
libp2p uses `@libp2p/logger` which respects the `DEBUG` environment variable.

Enable ALL WebRTC logs:
```bash
DEBUG=libp2p:webrtc* npm run dev
```

This will show:
- ✅ SDP offer/answer exchange
- ✅ ICE candidates being sent/received
- ✅ Connection state changes
- ✅ Stream opening/closing

### Step 2: Check What Logs Show
Based on the code, you should see:
- `"initiator send SDP offer"` - Offer being sent
- `"recipient received SDP offer"` - Offer received
- `"recipient send SDP answer"` - Answer sent
- `"initiator received SDP answer"` - Answer received
- `"initiator sending ICE candidate"` - Local candidates being sent
- `"recipient sending ICE candidate"` - Local candidates being sent
- `"initiator received new ICE candidate"` - Remote candidates received
- `"recipient received new ICE candidate"` - Remote candidates received

### Step 3: Compare with Our Manual Test
Our `manual-webrtc-test.spec.js` works because:
- ✅ Both peers on same page (same execution context)
- ✅ Signaling is synchronous (direct function calls)
- ✅ No relay involved
- ✅ Host-only candidates (STUN disabled)

libp2p WebRTC might fail if:
- ❌ Relay connection is slow/unstable
- ❌ STUN candidates are prioritized over host candidates
- ❌ Signaling stream has issues

## 🎯 How to Debug This

### 📦 New Debugging Tools Installed

We've created `libp2p-webrtc-debug.js` which provides:
1. **`patchLibp2pWebRTCLogging()`** - Monkey-patches `RTCPeerConnection` to log ALL WebRTC activity
2. **`setupLibp2pEventLogging(libp2p)`** - Logs libp2p connection events

These are now integrated into `index.js` and will run automatically!

### 🔍 Step 1: Run the App with Full Logging

```bash
cd examples/js-libp2p-example-yjs-libp2p
npm run start
```

Open Firefox and check the **browser console** (F12). You should see:

#### A. RTCPeerConnection Creation
```
🔷 [libp2p PC #1] Created with config: { hasStun: false, iceServers: [], ... }
```
- **Check**: Is `hasStun: false`? (Should be, since we commented out STUN)
- **Check**: Is `iceServers: []` empty? (Should be!)

#### B. ICE Candidate Gathering
```
🧊 [PC #1] ICE candidate (host): { type: 'host', address: '192.168.1.100', port: 56789, ... }
🧊 [PC #1] Candidate count so far: { host: 2, srflx: 0, relay: 0 }
```
- **Check**: Are host candidates being gathered?
- **Check**: Is srflx count staying at 0? (Should be, no STUN!)

#### C. Remote Candidate Reception
```
📥 [PC #1] Remote ICE candidate added (host): { type: 'host', ... }
```
- **Check**: Are remote candidates being received?
- **This is KEY!** If you don't see this, signaling is broken!

#### D. ICE Connection State
```
🔍 [PC #1] ICE is checking candidate pairs...
🔍 [PC #1] ICE candidate pairs: [{ state: 'in-progress', nominated: false, ... }]
✅ [PC #1] ICE connection state: connected
```
- **Check**: Does it reach `checking`? (If not, no candidates!)
- **Check**: Does it reach `connected`? (If not, candidates can't connect!)

#### E. libp2p Events
```
🔍 [libp2p] Peer discovered: { peerId: '12D3Koo...', multiaddrs: [...] }
🤝 [libp2p] Peer connected: 12D3Koo...
🔓 [libp2p] Connection opened: { remoteAddr: '/webrtc/...', direction: 'outbound', ... }
```
- **Check**: Are peers being discovered?
- **Check**: Is libp2p attempting to dial them?

### 🔍 Step 2: Compare with Manual WebRTC Test

Run our standalone test that works:
```bash
npm run test:firefox:manual-webrtc
```

This creates two `RTCPeerConnection` instances on the same page and connects them directly. Check the console output to see:
- What candidates are gathered
- How signaling works
- That connection succeeds

**Compare** this with what you see in the full app!

### 🔍 Step 3: Check What's Different

Create a comparison table:

| Aspect | Manual Test | libp2p App | Notes |
|--------|------------|------------|-------|
| Candidates gathered? | ✅ | ? | Check console logs |
| Remote candidates received? | ✅ | ? | **KEY indicator!** |
| ICE reaches `checking`? | ✅ | ? | Means candidates paired |
| ICE reaches `connected`? | ✅ | ? | Success! |
| Signaling method | Direct (same page) | Via relay stream | Different paths |

### 🚨 Likely Issues and Solutions

#### Issue 1: No Remote Candidates Received
```
🧊 [PC #1] ICE candidate (host): ...
🧊 [PC #1] ICE gathering complete
❌ No 📥 remote candidates!
```
**Root cause**: Signaling stream not working
**Check**:
- Is relay connection established?
- Is `/webrtc` protocol handler registered?
- Are messages being sent via signaling stream?

**Fix**: Check relay server is running (`npm run relay:debug`)

#### Issue 2: Candidates Gathered but ICE Fails
```
🧊 [PC #1] ICE candidate (host): ...
📥 [PC #1] Remote ICE candidate added (host): ...
🔍 [PC #1] ICE is checking candidate pairs...
❌ [PC #1] ICE connection state: failed
```
**Root cause**: Candidates incompatible or firewall blocking
**Check**:
- Are both peers behind same NAT?
- Are host IPs reachable from each other?
- Is UDP blocked?

**Fix**: Make sure both Firefox instances are on same network/machine

#### Issue 3: No ICE Candidates at All
```
🔷 [PC #1] Created with config: ...
❌ No candidates gathered!
```
**Root cause**: Firefox blocking ICE gathering
**Check**: Playwright config (`playwright.config.js`) has correct `firefoxUserPrefs`

**Fix**: Verify these settings are present:
```javascript
'media.peerconnection.ice.no_host': false,
'media.peerconnection.ice.default_address_only': false,
```

### 🎯 Expected Outcome

When everything works, you should see this sequence:

```
🔧 [Diagnostic] Patching libp2p WebRTC for detailed logging...
✅ [Diagnostic] libp2p WebRTC patching complete!

🔷 [libp2p PC #1] Created with config: { hasStun: false, iceServers: [] }
🧊 [PC #1] ICE candidate (host): { type: 'host', address: '192.168.1.100', ... }
🧊 [PC #1] ICE candidate (host): { type: 'host', address: '192.168.1.100', ... }
🧊 [PC #1] ICE gathering complete

📥 [PC #1] Remote ICE candidate added (host): { ... }
📥 [PC #1] Remote ICE candidate added (host): { ... }

🔍 [PC #1] ICE is checking candidate pairs...
✅ [PC #1] ICE connection state: connected
✅ [PC #1] CONNECTION SUCCESSFUL!

🤝 [libp2p] Peer connected: 12D3Koo...
🔓 [libp2p] Connection opened: { remoteAddr: '/webrtc/...', direction: 'outbound' }
```

**If you see this** → 🎉 WebRTC is working!  
**If you don't** → Follow the troubleshooting steps above to find where it breaks.

## 📝 Summary

The investigation has revealed:

1. ✅ **libp2p WebRTC DOES exchange ICE candidates** (via signaling stream)
2. ✅ **No host candidate filtering** in libp2p code
3. ✅ **Manual WebRTC test works** (proves Firefox + WebRTC are fine)
4. ❓ **libp2p WebRTC fails** - need to find WHY

Most likely causes:
- **Relay signaling issues** - Stream not working properly
- **Timing issues** - Candidates arriving too late
- **Same public IP problem** - If STUN was used (but we disabled it!)

Use the new logging to pinpoint exactly where the flow breaks! 🎯

