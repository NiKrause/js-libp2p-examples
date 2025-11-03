# 🚀 Quick Start: Debugging libp2p WebRTC

## TL;DR

We've analyzed libp2p's WebRTC source code and built debugging tools to find why connections fail. **The most critical indicator is whether remote ICE candidates are received via signaling.**

---

## ⚡ 30-Second Start

```bash
# Terminal 1: Start relay
npm run relay:debug

# Terminal 2: Start app
npm run start

# Open 2 Firefox tabs at http://localhost:5173
# Press F12 (DevTools)
# Click "Connect via WebRTC-Direct" in both
# Look for 📥 logs in console
```

---

## 🎯 What to Look For

Open browser console (F12) and check:

### ✅ **SUCCESS** - Everything working
```
🔧 [Diagnostic] Patching libp2p WebRTC...
🔷 [PC #1] Created with config: { hasStun: false, iceServers: [] }
🧊 [PC #1] ICE candidate (host): 192.168.1.100:56789
🧊 [PC #1] Candidate count: { host: 2, srflx: 0, relay: 0 }
📥 [PC #1] Remote ICE candidate added (host)  ← 🎯 KEY!
📥 [PC #1] Remote ICE candidate added (host)  ← 🎯 KEY!
🔍 [PC #1] ICE is checking candidate pairs...
✅ [PC #1] ICE connection state: connected
✅ [PC #1] CONNECTION SUCCESSFUL!
```

### ❌ **FAILURE** - Signaling broken
```
🔧 [Diagnostic] Patching libp2p WebRTC...
🔷 [PC #1] Created with config: { hasStun: false, iceServers: [] }
🧊 [PC #1] ICE candidate (host): 192.168.1.100:56789
🧊 [PC #1] ICE gathering complete
❌ NO 📥 logs! (Remote candidates never received)
❌ [PC #1] ICE connection state: failed
```

---

## 🔍 One Key Metric

**Do you see `📥 Remote ICE candidate added` logs?**

| Logs Present? | Diagnosis | Action |
|--------------|-----------|--------|
| ✅ YES | Signaling works! Problem is network/ICE | Check firewall, NAT, same network |
| ❌ NO | **Signaling broken!** | Check relay server, protocol registration |

---

## 📚 Documentation

- **`INVESTIGATION_COMPLETE.md`** - Full summary of what we did
- **`DEBUG_TOOLS_SUMMARY.md`** - Detailed guide to debugging tools
- **`LIBP2P_WEBRTC_ANALYSIS.md`** - Deep dive into libp2p source code

---

## 🛠️ Built Tools

### `libp2p-webrtc-debug.js`
Two functions that log ALL WebRTC activity:
- `patchLibp2pWebRTCLogging()` - Patches RTCPeerConnection
- `setupLibp2pEventLogging()` - Monitors libp2p events

### Integrated into `index.js`
Automatically runs when you start the app!

---

## 💡 Pro Tips

### Maximum Detail
```bash
# Run app with libp2p internal logs
npm run start:debug
```
Check both:
- **Browser console** → WebRTC candidate logs
- **Terminal** → libp2p transport logs

### Compare with Working Test
```bash
# Run manual WebRTC test (no libp2p)
npm run test:firefox:manual-webrtc
```
This works! Compare logs to see what's different.

### Firefox Internal Stats
Visit **about:webrtc** in Firefox for native WebRTC statistics.

---

## 🎓 Key Learnings

From analyzing `/node_modules/@libp2p/webrtc/src/private-to-private/`:

1. ✅ libp2p **DOES** send ALL ICE candidates (no filtering!)
2. ✅ Candidates are sent via **protobuf message stream** over relay
3. ✅ The `/webrtc` protocol handles signaling
4. ❌ If signaling fails, **no remote candidates** are received
5. ❌ Without remote candidates, **ICE cannot connect**

---

## 🚨 Most Common Issue

**Signaling broken** (no remote candidates received)

**Causes**:
- Relay server not running
- Relay connection timeout
- Protocol handler not registered
- Firewall blocking relay connection

**Fix**: Ensure relay is running with `npm run relay:debug`

---

## ✅ Checklist

- [ ] Relay server running (`npm run relay:debug`)
- [ ] App built and started (`npm run start`)
- [ ] Two Firefox tabs open at `http://localhost:5173`
- [ ] DevTools open (F12) in both tabs
- [ ] Clicked "Connect via WebRTC-Direct" in both
- [ ] Checked console for `📥` logs

**If you see `📥` logs** → Signaling works! 🎉  
**If you don't** → Relay issue, check relay terminal for errors.

---

## 🆘 Need Help?

1. Read `INVESTIGATION_COMPLETE.md` for full context
2. Check `DEBUG_TOOLS_SUMMARY.md` for troubleshooting steps
3. Review `LIBP2P_WEBRTC_ANALYSIS.md` for technical details

**Focus on the `📥` logs - they're the key! 🔑**

Good luck! 🚀

