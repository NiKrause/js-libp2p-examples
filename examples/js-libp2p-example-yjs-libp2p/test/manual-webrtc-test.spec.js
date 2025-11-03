/* eslint-disable no-console */

import { test, expect } from '@playwright/test'

const url = 'http://localhost:5173'

/**
 * Manual WebRTC connection test - No libp2p, pure WebRTC
 * This test manually performs what libp2p SHOULD be doing:
 * 1. Create two PeerConnections with host-only candidates
 * 2. Exchange SDP offers/answers
 * 3. Exchange ICE candidates
 * 4. Connect!
 * 
 * If this works but libp2p doesn't, we know libp2p has a bug
 */
test.describe('Manual WebRTC Connection Test (No libp2p)', () => {
  test.setTimeout(60000)

  test('should manually connect two peers using host candidates only', async ({ page, browserName }) => {
    test.skip(browserName !== 'firefox', 'This test is Firefox-specific')

    console.log('\n='.repeat(80))
    console.log('MANUAL WEBRTC TEST - Simulating what libp2p should do')
    console.log('='.repeat(80))

    // Capture ALL console messages from the page
    page.on('console', msg => {
      const type = msg.type()
      const text = msg.text()
      console.log(`[Browser ${type}] ${text}`)
    })

    await page.goto(url)

    const result = await page.evaluate(async () => {
      const log = (msg) => console.log(msg)
      log('Starting manual WebRTC connection test...')

      // Configuration: NO STUN servers = host candidates only
      const config = {
        iceServers: []  // Empty = host candidates only
      }

      // Create two peer connections (simulating two browser tabs)
      log('\n1️⃣ Creating two PeerConnections...')
      const peer1 = new RTCPeerConnection(config)
      const peer2 = new RTCPeerConnection(config)

      const results = {
        peer1Candidates: [],
        peer2Candidates: [],
        peer1RemoteCandidates: [],
        peer2RemoteCandidates: [],
        peer1IceState: 'new',
        peer2IceState: 'new',
        peer1ConnState: 'new',
        peer2ConnState: 'new',
        connected: false,
        dataChannelWorks: false
      }

      // Track ICE connection states
      peer1.oniceconnectionstatechange = () => {
        results.peer1IceState = peer1.iceConnectionState
        log(`Peer1 ICE state: ${peer1.iceConnectionState}`)
        if (peer1.iceConnectionState === 'connected') {
          results.connected = true
        }
      }

      peer2.oniceconnectionstatechange = () => {
        results.peer2IceState = peer2.iceConnectionState
        log(`Peer2 ICE state: ${peer2.iceConnectionState}`)
      }

      peer1.onconnectionstatechange = () => {
        results.peer1ConnState = peer1.connectionState
        log(`Peer1 Connection state: ${peer1.connectionState}`)
      }

      peer2.onconnectionstatechange = () => {
        results.peer2ConnState = peer2.connectionState
        log(`Peer2 Connection state: ${peer2.connectionState}`)
      }

      // Create data channel for testing
      const dataChannel = peer1.createDataChannel('test')
      let messageReceived = false

      dataChannel.onopen = () => {
        log('✅ Data channel opened!')
        dataChannel.send('Hello from Peer1!')
      }

      peer2.ondatachannel = (event) => {
        log('✅ Peer2 received data channel')
        event.channel.onmessage = (e) => {
          log(`✅ Peer2 received message: ${e.data}`)
          messageReceived = true
          results.dataChannelWorks = true
        }
      }

      // Collect ICE candidates from Peer1
      log('\n2️⃣ Collecting ICE candidates from Peer1...')
      const peer1CandidatesPromise = new Promise((resolve) => {
        const candidates = []
        peer1.onicecandidate = (event) => {
          if (event.candidate) {
            const c = event.candidate
            log(`🧊 Peer1 ICE candidate: ${c.type} ${c.protocol} ${c.address}:${c.port} priority=${c.priority}`)
            candidates.push(c)
            results.peer1Candidates.push({
              type: c.type,
              protocol: c.protocol,
              address: c.address,
              port: c.port,
              priority: c.priority,
              candidate: c.candidate // Full candidate string
            })
          } else {
            log(`✅ Peer1 ICE gathering complete - gathered ${candidates.length} candidates`)
            resolve(candidates)
          }
        }
      })

      // Collect ICE candidates from Peer2
      log('\n3️⃣ Collecting ICE candidates from Peer2...')
      const peer2CandidatesPromise = new Promise((resolve) => {
        const candidates = []
        peer2.onicecandidate = (event) => {
          if (event.candidate) {
            const c = event.candidate
            log(`🧊 Peer2 ICE candidate: ${c.type} ${c.protocol} ${c.address}:${c.port} priority=${c.priority}`)
            candidates.push(c)
            results.peer2Candidates.push({
              type: c.type,
              protocol: c.protocol,
              address: c.address,
              port: c.port,
              priority: c.priority,
              candidate: c.candidate // Full candidate string
            })
          } else {
            log(`✅ Peer2 ICE gathering complete - gathered ${candidates.length} candidates`)
            resolve(candidates)
          }
        }
      })

      // Peer1 creates offer
      log('\n4️⃣ Peer1 creating offer...')
      const offer = await peer1.createOffer()
      await peer1.setLocalDescription(offer)
      log(`Peer1 offer created (SDP length: ${offer.sdp.length})`)

      // Peer2 receives offer and creates answer
      log('\n5️⃣ Peer2 receiving offer and creating answer...')
      await peer2.setRemoteDescription(offer)
      log('Peer2 set remote description (offer)')

      const answer = await peer2.createAnswer()  // ← FIXED: Must be createAnswer() not createOffer()
      await peer2.setLocalDescription(answer)
      log(`Peer2 answer created (SDP length: ${answer.sdp.length})`)

      // Peer1 receives answer
      log('\n6️⃣ Peer1 receiving answer...')
      await peer1.setRemoteDescription(answer)
      log('Peer1 set remote description (answer)')

      // Wait for ICE candidates to be gathered
      log('\n7️⃣ Waiting for ICE candidate gathering...')
      const [peer1Candidates, peer2Candidates] = await Promise.all([
        peer1CandidatesPromise,
        peer2CandidatesPromise
      ])

      log(`Peer1 gathered ${peer1Candidates.length} candidates`)
      log(`Peer2 gathered ${peer2Candidates.length} candidates`)

      // Exchange ICE candidates (this is what libp2p signaling should do!)
      log('\n8️⃣ Exchanging ICE candidates (simulating libp2p signaling)...')
      
      // Send Peer1's candidates to Peer2
      for (const candidate of peer1Candidates) {
        log(`→ Adding Peer1 candidate to Peer2: ${candidate.type} ${candidate.address}`)
        await peer2.addIceCandidate(candidate)
        results.peer2RemoteCandidates.push({
          type: candidate.type,
          address: candidate.address
        })
      }

      // Send Peer2's candidates to Peer1
      for (const candidate of peer2Candidates) {
        log(`← Adding Peer2 candidate to Peer1: ${candidate.type} ${candidate.address}`)
        await peer1.addIceCandidate(candidate)
        results.peer1RemoteCandidates.push({
          type: candidate.type,
          address: candidate.address
        })
      }

      // Wait for connection
      log('\n9️⃣ Waiting for connection...')
      const connectionPromise = new Promise((resolve) => {
        const checkConnection = () => {
          if (peer1.iceConnectionState === 'connected' || peer1.iceConnectionState === 'completed') {
            log('✅ CONNECTION ESTABLISHED!')
            resolve(true)
          } else if (peer1.iceConnectionState === 'failed') {
            log('❌ CONNECTION FAILED!')
            resolve(false)
          }
        }

        peer1.oniceconnectionstatechange = checkConnection
        setTimeout(() => {
          log('⏱️ Connection timeout')
          resolve(false)
        }, 10000)
      })

      await connectionPromise

      // Wait a bit for data channel message
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Clean up
      peer1.close()
      peer2.close()

      return results
    })

    // Display results
    console.log('\n' + '='.repeat(80))
    console.log('MANUAL WEBRTC TEST RESULTS')
    console.log('='.repeat(80))
    
    console.log('\n📊 Peer1 Stats:')
    console.log(`   Local candidates gathered: ${result.peer1Candidates.length}`)
    result.peer1Candidates.forEach((c, i) => {
      console.log(`     ${i + 1}. ${c.type} ${c.protocol} ${c.address}:${c.port} [priority: ${c.priority}]`)
      if (c.candidate) {
        console.log(`        Full: ${c.candidate.substring(0, 100)}...`)
      }
    })
    console.log(`   Remote candidates received: ${result.peer1RemoteCandidates.length}`)
    console.log(`   ICE state: ${result.peer1IceState}`)
    console.log(`   Connection state: ${result.peer1ConnState}`)

    console.log('\n📊 Peer2 Stats:')
    console.log(`   Local candidates gathered: ${result.peer2Candidates.length}`)
    result.peer2Candidates.forEach((c, i) => {
      console.log(`     ${i + 1}. ${c.type} ${c.protocol} ${c.address}:${c.port} [priority: ${c.priority}]`)
      if (c.candidate) {
        console.log(`        Full: ${c.candidate.substring(0, 100)}...`)
      }
    })
    console.log(`   Remote candidates received: ${result.peer2RemoteCandidates.length}`)
    console.log(`   ICE state: ${result.peer2IceState}`)
    console.log(`   Connection state: ${result.peer2ConnState}`)

    console.log('\n🎯 Results:')
    console.log(`   Connected: ${result.connected ? '✅ YES' : '❌ NO'}`)
    console.log(`   Data channel works: ${result.dataChannelWorks ? '✅ YES' : '❌ NO'}`)

    if (result.connected) {
      console.log('\n✅ SUCCESS: Manual WebRTC connection with host candidates works!')
      console.log('   This proves that:')
      console.log('   - Host candidates CAN connect on same network')
      console.log('   - WebRTC itself works fine in Firefox')
      console.log('   - The problem is in libp2p\'s signaling/candidate exchange')
    } else {
      console.log('\n❌ FAILED: Even manual WebRTC connection failed')
      console.log('   This indicates:')
      console.log('   - Network/firewall issue preventing local connections')
      console.log('   - Firefox WebRTC configuration problem')
      console.log('   - Browser security restrictions')
    }

    console.log('='.repeat(80) + '\n')

    // Assertions
    expect(result.peer1Candidates.length).toBeGreaterThan(0)
    expect(result.peer2Candidates.length).toBeGreaterThan(0)
    expect(result.peer1RemoteCandidates.length).toBeGreaterThan(0)
    expect(result.peer2RemoteCandidates.length).toBeGreaterThan(0)
    
    // This should work!
    expect(result.connected).toBe(true)
    expect(result.dataChannelWorks).toBe(true)
  })
})

