/**
 * Runtime monkey-patching for libp2p WebRTC debugging
 * 
 * This module intercepts libp2p's WebRTC signaling to log what's happening
 * without modifying node_modules files directly.
 * 
 * IMPORTANT: This patching happens IMMEDIATELY on import to ensure it runs
 * before libp2p captures the RTCPeerConnection constructor!
 */

function patchLibp2pWebRTCLogging () {
  console.log('🔧 [Diagnostic] Patching libp2p WebRTC for detailed logging...')

  // Save original RTCPeerConnection
  const OriginalRTCPeerConnection = window.RTCPeerConnection
  let pcCounter = 0
  const pcMap = new WeakMap() // Track which PC is which

  window.RTCPeerConnection = function (...args) {
    const pc = new OriginalRTCPeerConnection(...args)
    const pcId = ++pcCounter
    pcMap.set(pc, pcId)

    const config = args[0]
    const hasStun = config?.iceServers?.some(s => 
      s.urls?.some(u => u.includes('stun'))
    )
    const iceServersStr = config?.iceServers ? JSON.stringify(config.iceServers) : '[]'
    const icePolicy = config?.iceTransportPolicy || 'all'

    console.log(`🔷 [libp2p PC #${pcId}] Created with config: hasStun=${hasStun} iceServers=${iceServersStr} iceTransportPolicy=${icePolicy} bundlePolicy=${config?.bundlePolicy || 'balanced'}`)

    // WORKAROUND: Set a dummy handler immediately to prevent race condition
    // libp2p will overwrite this, but at least candidates won't be lost in the meantime
    pc.onicecandidate = () => {}
    console.log(`🔧 [PC #${pcId}] Pre-installed dummy onicecandidate handler to prevent race condition`)

    // Track ICE gathering
    const originalOnIceCandidate = Object.getOwnPropertyDescriptor(
      OriginalRTCPeerConnection.prototype,
      'onicecandidate'
    )

    let candidateCount = { host: 0, srflx: 0, relay: 0 }

    Object.defineProperty(pc, 'onicecandidate', {
      get () {
        return this._onicecandidate
      },
      set (handler) {
        console.log(`🔧 [PC #${pcId}] onicecandidate handler being set`)
        this._onicecandidate = (event) => {
          console.log(`🔧 [PC #${pcId}] onicecandidate fired! hasCandidate=${!!event.candidate}`)
          
          if (event.candidate) {
            const c = event.candidate
            const type = c.type || 'unknown'
            candidateCount[type] = (candidateCount[type] || 0) + 1

            // Log as string for Playwright compatibility
            console.log(`🧊 [PC #${pcId}] ICE candidate (${type}): ${c.protocol} ${c.address || 'N/A'}:${c.port || 'N/A'} priority=${c.priority} foundation=${c.foundation}`)
            console.log(`🧊 [PC #${pcId}] Candidate count: host=${candidateCount.host || 0} srflx=${candidateCount.srflx || 0} relay=${candidateCount.relay || 0}`)
          } else {
            console.log(`🧊 [PC #${pcId}] ICE gathering complete (null candidate) - Total: host=${candidateCount.host || 0} srflx=${candidateCount.srflx || 0} relay=${candidateCount.relay || 0} state=${pc.iceGatheringState}`)
          }

          if (handler) {
            return handler.call(this, event)
          }
        }
      },
      enumerable: true,
      configurable: true
    })

    // Intercept addEventListener for icecandidate too!
    const originalAddEventListener = pc.addEventListener.bind(pc)
    pc.addEventListener = function (type, listener, options) {
      if (type === 'icecandidate') {
        console.log(`🔧 [PC #${pcId}] addEventListener('icecandidate') called`)
        pc._hasIceCandidateListener = true  // Mark that handler is set
        const wrappedListener = (event) => {
          console.log(`🔧 [PC #${pcId}] icecandidate event fired! hasCandidate=${!!event.candidate}`)
          if (event.candidate) {
            const c = event.candidate
            const type = c.type || 'unknown'
            candidateCount[type] = (candidateCount[type] || 0) + 1
            console.log(`🧊 [PC #${pcId}] ICE candidate (${type}): ${c.protocol} ${c.address || 'N/A'}:${c.port || 'N/A'} priority=${c.priority}`)
            console.log(`🧊 [PC #${pcId}] Candidate count: host=${candidateCount.host || 0} srflx=${candidateCount.srflx || 0} relay=${candidateCount.relay || 0}`)
          }
          return listener.call(this, event)
        }
        return originalAddEventListener('icecandidate', wrappedListener, options)
      }
      return originalAddEventListener(type, listener, options)
    }

    // Monitor ICE gathering state
    pc.addEventListener('icegatheringstatechange', () => {
      console.log(`🧊 [PC #${pcId}] ICE gathering state: ${pc.iceGatheringState} (host=${candidateCount.host || 0} srflx=${candidateCount.srflx || 0} relay=${candidateCount.relay || 0})`)
    })

    // Monitor ICE connection state
    pc.addEventListener('iceconnectionstatechange', () => {
      const state = pc.iceConnectionState
      const emoji = state === 'connected' ? '✅' : state === 'failed' ? '❌' : '🔄'
      console.log(`${emoji} [PC #${pcId}] ICE connection state: ${state}`)

      if (state === 'checking') {
        console.log(`🔍 [PC #${pcId}] ICE is checking candidate pairs...`)
        
        // Try to get stats
        pc.getStats().then(stats => {
          const pairs = []
          stats.forEach(report => {
            if (report.type === 'candidate-pair') {
              pairs.push({
                state: report.state,
                nominated: report.nominated,
                priority: report.priority
              })
            }
          })
          if (pairs.length > 0) {
            console.log(`🔍 [PC #${pcId}] ICE candidate pairs:`, pairs)
          }
        }).catch(() => {})
      } else if (state === 'failed') {
        console.error(`❌ [PC #${pcId}] ICE FAILED! Gathered: host=${candidateCount.host || 0} srflx=${candidateCount.srflx || 0} relay=${candidateCount.relay || 0} | iceGathering=${pc.iceGatheringState} conn=${pc.connectionState} signal=${pc.signalingState}`)
      }
    })

    // Monitor connection state
    pc.addEventListener('connectionstatechange', () => {
      const state = pc.connectionState
      console.log(`🔗 [PC #${pcId}] Connection state: ${state}`)
      
      if (state === 'connected') {
        console.log(`✅ [PC #${pcId}] CONNECTION SUCCESSFUL! Used candidates: host=${candidateCount.host || 0} srflx=${candidateCount.srflx || 0} relay=${candidateCount.relay || 0}`)
      }
    })

    // Monitor signaling state
    pc.addEventListener('signalingstatechange', () => {
      console.log(`📡 [PC #${pcId}] Signaling state: ${pc.signalingState}`)
    })

    // Intercept addIceCandidate to see remote candidates
    const originalAddIceCandidate = pc.addIceCandidate.bind(pc)
    let remoteCandidateCount = { host: 0, srflx: 0, relay: 0 }
    
    pc.addIceCandidate = async function (candidate) {
      if (candidate && candidate.candidate) {
        const candStr = typeof candidate.candidate === 'string' 
          ? candidate.candidate 
          : candidate.candidate.candidate

        if (candStr) {
          const typeMatch = candStr.match(/typ (\w+)/)
          const type = typeMatch ? typeMatch[1] : 'unknown'
          remoteCandidateCount[type] = (remoteCandidateCount[type] || 0) + 1

          console.log(`📥 [PC #${pcId}] Remote ICE candidate added (${type}): ${candStr.substring(0, 100)}... | Total remote: host=${remoteCandidateCount.host || 0} srflx=${remoteCandidateCount.srflx || 0} relay=${remoteCandidateCount.relay || 0}`)
        }
      } else {
        console.log(`📥 [PC #${pcId}] addIceCandidate called with end-of-candidates`)
      }

      return originalAddIceCandidate(candidate)
    }

    // Intercept setRemoteDescription
    const originalSetRemoteDescription = pc.setRemoteDescription.bind(pc)
    pc.setRemoteDescription = async function (description) {
      const hasCandidates = description.sdp && description.sdp.includes('candidate:')
      const candidateMatches = description.sdp ? description.sdp.match(/a=candidate:/g) : null
      const candidateCount = candidateMatches ? candidateMatches.length : 0

      console.log(`📨 [PC #${pcId}] setRemoteDescription: type=${description.type} sdpLen=${description.sdp ? description.sdp.length : 0} hasCandidates=${hasCandidates} count=${candidateCount}`)

      return originalSetRemoteDescription(description)
    }

    // Intercept setLocalDescription
    const originalSetLocalDescription = pc.setLocalDescription.bind(pc)
    pc.setLocalDescription = async function (description) {
      // Check if handler is attached BEFORE we call setLocalDescription
      const hasHandler = !!(pc.onicecandidate || pc._hasIceCandidateListener)
      
      // Analyze SDP to understand what Firefox sees
      const sdpLines = description.sdp ? description.sdp.split('\n') : []
      const hasDataChannel = sdpLines.some(l => l.includes('m=application'))
      const hasAudio = sdpLines.some(l => l.includes('m=audio'))
      const hasVideo = sdpLines.some(l => l.includes('m=video'))
      const iceUfrag = sdpLines.find(l => l.startsWith('a=ice-ufrag:'))
      const icePwd = sdpLines.find(l => l.startsWith('a=ice-pwd:'))
      
      console.log(`📤 [PC #${pcId}] setLocalDescription: type=${description.type} sdpLen=${description.sdp ? description.sdp.length : 0} hasIceCandidateHandler=${hasHandler}`)
      console.log(`   📋 [PC #${pcId}] SDP contains: dataChannel=${hasDataChannel} audio=${hasAudio} video=${hasVideo} iceUfrag=${!!iceUfrag} icePwd=${!!icePwd}`)
      if (description.sdp) {
        console.log(`   📄 [PC #${pcId}] Full SDP:`)
        console.log(description.sdp)
      }
      
      if (!hasHandler) {
        console.error(`🚨 [PC #${pcId}] RACE CONDITION! setLocalDescription called BEFORE onicecandidate handler attached!`)
        console.error(`   🔧 [PC #${pcId}] WORKAROUND: Installing emergency handler NOW before setLocalDescription`)
        
        // EMERGENCY FIX: Install handler RIGHT NOW before calling setLocalDescription
        const emergencyCandidates = []
        pc.onicecandidate = (event) => {
          console.log(`🚑 [PC #${pcId}] Emergency handler caught candidate:`, event.candidate?.type || 'null')
          emergencyCandidates.push(event)
          // Store for later replay when real handler is set
        }
        
        // Call setLocalDescription
        const result = await originalSetLocalDescription(description)
        
        // Give libp2p a moment to set its handler, then replay candidates
        setTimeout(() => {
          if (emergencyCandidates.length > 0) {
            console.log(`🚑 [PC #${pcId}] Replaying ${emergencyCandidates.length} missed candidates to new handler`)
            emergencyCandidates.forEach(event => {
              if (pc.onicecandidate && pc.onicecandidate !== emergencyCandidates) {
                pc.onicecandidate(event)
              }
            })
          }
        }, 100)
        
        return result
      }

      return originalSetLocalDescription(description)
    }

    return pc
  }

  // Preserve prototype chain
  Object.setPrototypeOf(window.RTCPeerConnection, OriginalRTCPeerConnection)
  window.RTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype

  console.log('✅ [Diagnostic] libp2p WebRTC patching complete!')
  console.log('💡 Watch for:')
  console.log('   1. 🔷 RTCPeerConnection creation - check iceServers config')
  console.log('   2. 🧊 Local ICE candidates - should see host/srflx/relay')
  console.log('   3. 📥 Remote ICE candidates - should be received via signaling')
  console.log('   4. 🔍 ICE checking - candidate pairs being tested')
  console.log('   5. ✅ Connection success or ❌ ICE failure')
}

export function setupLibp2pEventLogging (libp2p) {
  console.log('🔧 [Diagnostic] Setting up libp2p event logging...')

  // Peer discovery
  libp2p.addEventListener('peer:discovery', (evt) => {
    const peer = evt.detail
    console.log('🔍 [libp2p] Peer discovered:', {
      peerId: peer.id.toString().slice(0, 12) + '...',
      multiaddrs: peer.multiaddrs.map(ma => ma.toString())
    })
  })

  // Connection events
  libp2p.addEventListener('peer:connect', (evt) => {
    const peerId = evt.detail.toString()
    console.log('🤝 [libp2p] Peer connected:', peerId.slice(0, 12) + '...')
  })

  libp2p.addEventListener('peer:disconnect', (evt) => {
    const peerId = evt.detail.toString()
    console.log('👋 [libp2p] Peer disconnected:', peerId.slice(0, 12) + '...')
  })

  // Dial attempts
  libp2p.addEventListener('connection:open', (evt) => {
    const conn = evt.detail
    console.log('🔓 [libp2p] Connection opened:', {
      remotePeer: conn.remotePeer.toString().slice(0, 12) + '...',
      remoteAddr: conn.remoteAddr.toString(),
      direction: conn.direction,
      status: conn.status,
      transports: conn.transports || []
    })
  })

  libp2p.addEventListener('connection:close', (evt) => {
    const conn = evt.detail
    console.log('🔒 [libp2p] Connection closed:', {
      remotePeer: conn.remotePeer.toString().slice(0, 12) + '...',
      remoteAddr: conn.remoteAddr.toString()
    })
  })

  console.log('✅ [Diagnostic] libp2p event logging enabled!')
}

// CRITICAL: Patch RTCPeerConnection IMMEDIATELY on module import
// This ensures the patching happens BEFORE libp2p imports capture the constructor
if (typeof window !== 'undefined' && window.RTCPeerConnection) {
  console.log('🔧 [Init] Auto-patching RTCPeerConnection on module import...')
  patchLibp2pWebRTCLogging()
} else {
  console.warn('⚠️ [Init] window.RTCPeerConnection not available, patching skipped')
}

// Export patchLibp2pWebRTCLogging for manual calling if needed
// (setupLibp2pEventLogging is already exported above)
export { patchLibp2pWebRTCLogging }

