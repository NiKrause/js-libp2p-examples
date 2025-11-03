# Firefox WebRTC Debugging Guide

This guide helps you debug WebRTC/ICE issues in Firefox when libp2p connections fail.

## 🎯 Your Situation

✅ **STUN/ICE Tests Pass** - Basic WebRTC works (10 candidates: 8 host, 2 SRFLX)  
❌ **libp2p WebRTC Fails** - "ICE failed, add a TURN server"

This means the issue is **specific to how libp2p uses WebRTC**, not Firefox itself.

## 🔍 Debugging Tools Available

### 1. **Browser Console (F12)** - Primary Debugging Tool

When you run the app, the console now shows:

```javascript
🔧 webrtc-adapter loaded: { browserName: 'firefox', browserVersion: 133 }
🔍 Setting up WebRTC debugging...
✅ WebRTC debugging enabled!

// When connections are attempted:
🔷 [RTCPeerConnection #1] Created with config: { iceServers: [...] }
🧊 [PC #1] ICE gathering state: gathering
🧊 [PC #1] ICE candidate: host udp 192.168.1.100:54321
🧊 [PC #1] ICE candidate: srflx udp 203.0.113.42:54321
🔄 [PC #1] ICE connection state: checking
❌ [PC #1] ICE connection state: failed  // <-- This tells you where it fails!
```

### 2. **Firefox about:webrtc** - Internal WebRTC Stats

1. Open a new tab
2. Type: `about:webrtc`
3. This shows Firefox's internal WebRTC statistics including:
   - All active PeerConnections
   - ICE candidate pairs and their states
   - Which candidates succeeded/failed
   - Network paths attempted
   - STUN/TURN server responses

### 3. **Debugging Info Panel** (in the app UI)

A blue panel at the bottom of the app page shows:
- Quick links to debugging tools
- What information is available in console
- How to check adapter.js status

## 📊 What Each Log Tells You

### **Adapter.js Verification**
```javascript
🔧 webrtc-adapter loaded: { browserName: 'firefox', browserVersion: 133 }
```
✅ Confirms adapter.js is loaded and normalized WebRTC APIs

### **PeerConnection Creation**
```javascript
🔷 [RTCPeerConnection #1] Created with config: { iceServers: [...] }
```
Shows each WebRTC connection libp2p creates and what STUN/TURN servers it's using

### **ICE Candidates**
```javascript
🧊 [PC #1] ICE candidate: host udp 192.168.1.100:54321
🧊 [PC #1] ICE candidate: srflx udp 203.0.113.42:54321
```
- **host** = Local network interface (always works locally)
- **srflx** = Public IP via STUN (needed for NAT traversal)
- **relay** = TURN server relay (needed if direct connection fails)

### **ICE Connection States**
```javascript
🔄 [PC #1] ICE connection state: new
🔄 [PC #1] ICE connection state: checking     // Trying candidate pairs
✅ [PC #1] ICE connection state: connected     // Success!
// OR
❌ [PC #1] ICE connection state: failed        // Connection failed
```

### **libp2p Events**
```javascript
🤝 [libp2p] Peer connected: 12D3KooW...
🔓 [libp2p] Connection opened: { remotePeer: '12D3KooW...', remoteAddr: '/ip4/...' }
```
Shows when libp2p successfully establishes connections

## 🔧 Common Issues & Solutions

### Issue 1: No SRFLX Candidates
```javascript
🧊 [PC #1] ICE candidate: host udp ...
🧊 [PC #1] ICE gathering complete (null candidate)
// Missing: srflx candidates!
```

**Cause**: STUN servers not reachable  
**Solutions**:
- Check firewall isn't blocking UDP
- Verify STUN servers are accessible
- Check network allows STUN traffic

### Issue 2: ICE Fails to "failed" State
```javascript
❌ [PC #1] ICE connection state: failed
```

**Possible Causes**:
1. **Both peers behind symmetric NAT** - Need TURN server
2. **localhost/same-machine testing** - WebRTC can't connect to itself via public IPs
3. **Firewall blocking** - UDP ports blocked
4. **No common network path** - Peers can't reach each other

**Check in about:webrtc**:
- Look at "ICE Stats" section
- Check which candidate pairs were tried
- See which ones succeeded/failed

### Issue 3: Only Host Candidates Work
```javascript
✅ [PC #1] ICE candidate: host udp 192.168.1.100:54321
❌ [PC #1] ICE candidate: srflx not gathered
```

**Cause**: Privacy settings or STUN blocked  
**Solution**: Check `playwright.config.js` has correct `firefoxUserPrefs`

### Issue 4: Same Local Network But Still Fails
```javascript
Page1: 🧊 [PC #1] ICE candidate: host udp 172.22.12.181:49637
Page2: 🧊 [PC #1] ICE candidate: host udp 172.22.12.181:51563
       SAME IP! They should connect via host candidates!
❌ [PC #1] ICE connection state: failed
```

**Why This Happens**:
Even though both peers are on the same local network (172.22.12.181), ICE might fail because:

1. **Priority Issue**: ICE prefers SRFLX over host candidates
2. **libp2p Filtering**: libp2p might filter out local candidates
3. **Signaling Issue**: Local candidates not being exchanged properly
4. **Same Public IP Conflict**: Both peers have same public IP (5.35.39.224), ICE sees this as impossible

**To Debug**:
Check console for:
- `📥 Remote ICE candidate added: host` - Are host candidates being shared?
- `🔗 ICE candidate pairs being checked` - Which pairs are actually tried?
- Candidate priorities - Higher priority wins

**Solution**:
- Use TURN server for relay
- Check libp2p's ICE candidate filtering
- Verify local candidates are in SDP offer/answer

### Issue 5: Connections Work in Tests But Not Production
**Cause**: Test environment vs production environment differences  
**Solution**: 
- Verify adapter.js is loaded in production
- Check STUN servers are configured in libp2p
- Ensure Firefox preferences match between test/production

## 🎯 Debugging Strategy

### Step 1: Verify Basic Setup
1. Open DevTools (F12)
2. Look for: `🔧 webrtc-adapter loaded`
3. Confirm: adapter.js version and browser detected correctly

### Step 2: Watch PeerConnection Creation
1. Start your app
2. Look for: `🔷 [RTCPeerConnection #N] Created`
3. Check: Are STUN servers configured?

### Step 3: Monitor ICE Gathering
1. Watch for: `🧊 [PC #N] ICE candidate: ...`
2. Count candidates:
   - At least 1 host candidate (should always be there)
   - At least 1 srflx candidate (needed for NAT traversal)
3. Look for: `🧊 [PC #N] ICE gathering complete`

### Step 4: Track Connection Attempts
1. Watch: `🔄 [PC #N] ICE connection state: checking`
2. Wait for either:
   - `✅ connected` - Success!
   - `❌ failed` - Connection failed

### Step 5: Check about:webrtc
1. Open `about:webrtc` in Firefox
2. Find your PeerConnections (they're numbered #1, #2, etc.)
3. Look at "ICE Stats" to see which candidate pairs succeeded/failed
4. Check if STUN servers responded

## 💡 Pro Tips

### Localhost/Same Network Testing Issue
**Problem**: Testing two tabs on the same machine fails even though they're on the same local network  

**What You See**:
```
Page1: host udp 172.22.12.181:49637  ← Same local IP
Page2: host udp 172.22.12.181:51563  ← Same local IP  
Page1: srflx udp 5.35.39.224:49734   ← Same public IP
Page2: srflx udp 5.35.39.224:62955   ← Same public IP
❌ ICE failed
```

**Why This Happens**:
1. Both peers gather **host** (local) candidates: `172.22.12.181:PORT`
2. Both peers gather **srflx** (public) candidates via STUN: `5.35.39.224:PORT`  
3. ICE should try:
   - Host→Host: ✅ Should work (same local network)
   - SRFLX→SRFLX: ❌ Fails (can't connect to yourself via public IP)
4. **But ICE prioritizes SRFLX over host!** 
5. ICE tries SRFLX first, realizes both = same public IP, fails immediately
6. Never gets to try the host candidates that would work

**Why ICE Prioritizes SRFLX**:
- SRFLX works through NAT (host doesn't)
- ICE assumes SRFLX is more reliable for internet peers
- Standard RFC behavior

**What You'll See in Logs**:
```javascript
📥 [PC #1] Remote ICE candidate added: host    // Good! Host candidates exchanged
📥 [PC #1] Remote ICE candidate added: srflx   // SRFLX candidates also exchanged
🔗 [PC #1] ICE candidate pairs being checked:
   // If you see this, check which pairs have state: 'failed' vs 'succeeded'
   // Look for: local SRFLX + remote SRFLX = failed
   //           local host + remote host = might work if tried!
```

**Solutions**:
- **Use TURN server**: Forces relay, works in all cases
- **Test on different networks**: Each has different public IP
- **Use WebSocket for local testing**: WebSocket doesn't have this problem
- **Check libp2p config**: Some libp2p versions filter local candidates

### Firefox vs Chrome Differences
- Firefox is stricter about permissions
- Firefox has more privacy protections
- Firefox's ICE gathering can be slower
- adapter.js normalizes these differences

### Enable More Detailed Logs
In Firefox `about:config`, set:
```
media.peerconnection.ice.log_level = "debug"
```
Then check Browser Console for even more detailed ICE logs.

## 📋 Quick Checklist

Before debugging, verify:
- [ ] adapter.js loaded? (check console for 🔧 message)
- [ ] STUN servers configured? (check PeerConnection creation log)
- [ ] ICE candidates gathered? (at least host + srflx)
- [ ] Using correct transport? (WebRTC vs WebSocket)
- [ ] Testing environment? (localhost vs different networks)
- [ ] Firewall/NAT? (check if UDP is blocked)

## 🚀 Next Steps

If debugging shows:
- ✅ **ICE candidates gathered** → Good! Check connection state transitions
- ✅ **Connection reaches "checking"** → Good! Check why it fails from there
- ❌ **No SRFLX candidates** → STUN issue, check network/firewall
- ❌ **ICE state goes to "failed"** → Need TURN server or check NAT config
- ❌ **No PeerConnections created** → libp2p not attempting WebRTC at all

For more help:
- Check libp2p logs: `DEBUG=libp2p:* npm start`
- Check Firefox logs: about:webrtc
- Check network: tcpdump or Wireshark to see STUN packets

