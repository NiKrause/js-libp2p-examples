/* eslint-disable no-console */

import { test, expect } from '@playwright/test'

const url = 'http://localhost:5173'

/**
 * Firefox WebRTC Diagnostic Test
 * This test verifies that WebRTC is properly enabled in Playwright's Firefox
 * and helps diagnose why STUN might not be working
 */
test.describe('Firefox WebRTC Diagnostics', () => {
  test('should verify WebRTC APIs are available in Firefox', async ({ page, browserName }) => {
    test.skip(browserName !== 'firefox', 'This test is Firefox-specific')

    console.log('Running Firefox WebRTC diagnostic...\n')

    await page.goto(url)

    const diagnostics = await page.evaluate(async () => {
      const results = {}

      // Check if RTCPeerConnection exists
      results.hasRTCPeerConnection = typeof RTCPeerConnection !== 'undefined'
      
      // Check if getUserMedia exists
      results.hasGetUserMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
      
      // Get user agent
      results.userAgent = navigator.userAgent
      
      // Check WebRTC support
      results.webrtcSupport = {
        RTCPeerConnection: typeof RTCPeerConnection !== 'undefined',
        RTCSessionDescription: typeof RTCSessionDescription !== 'undefined',
        RTCIceCandidate: typeof RTCIceCandidate !== 'undefined'
      }

      // Try to create a peer connection
      try {
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        })
        results.canCreatePeerConnection = true
        results.iceGatheringState = pc.iceGatheringState
        results.iceConnectionState = pc.iceConnectionState
        results.signalingState = pc.signalingState
        pc.close()
      } catch (error) {
        results.canCreatePeerConnection = false
        results.peerConnectionError = error.message
      }

      // Try to add a transceiver
      try {
        const pc = new RTCPeerConnection()
        pc.addTransceiver('audio', { direction: 'recvonly' })
        results.canAddTransceiver = true
        pc.close()
      } catch (error) {
        results.canAddTransceiver = false
        results.transceiverError = error.message
      }

      // Try to create an offer
      try {
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        })
        pc.addTransceiver('audio', { direction: 'recvonly' })
        const offer = await pc.createOffer()
        results.canCreateOffer = true
        results.offerType = offer.type
        results.offerSdpLength = offer.sdp ? offer.sdp.length : 0
        
        // Try to set local description
        await pc.setLocalDescription(offer)
        results.canSetLocalDescription = true
        
        pc.close()
      } catch (error) {
        results.canCreateOffer = false
        results.offerError = error.message
      }

      // Check navigator.mediaDevices
      results.mediaDevices = {
        exists: !!navigator.mediaDevices,
        enumerateDevices: !!(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices),
        getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
      }

      return results
    })

    // Display diagnostics
    console.log('='.repeat(80))
    console.log('FIREFOX WEBRTC DIAGNOSTIC RESULTS')
    console.log('='.repeat(80))
    console.log('\n🌐 Browser Info:')
    console.log(`   User Agent: ${diagnostics.userAgent}`)
    
    console.log('\n✅ WebRTC API Availability:')
    console.log(`   RTCPeerConnection: ${diagnostics.hasRTCPeerConnection ? '✅ Yes' : '❌ No'}`)
    console.log(`   getUserMedia: ${diagnostics.hasGetUserMedia ? '✅ Yes' : '❌ No'}`)
    console.log(`   RTCSessionDescription: ${diagnostics.webrtcSupport.RTCSessionDescription ? '✅ Yes' : '❌ No'}`)
    console.log(`   RTCIceCandidate: ${diagnostics.webrtcSupport.RTCIceCandidate ? '✅ Yes' : '❌ No'}`)
    
    console.log('\n🔧 Peer Connection:')
    console.log(`   Can create: ${diagnostics.canCreatePeerConnection ? '✅ Yes' : '❌ No'}`)
    if (diagnostics.canCreatePeerConnection) {
      console.log(`   ICE gathering state: ${diagnostics.iceGatheringState}`)
      console.log(`   ICE connection state: ${diagnostics.iceConnectionState}`)
      console.log(`   Signaling state: ${diagnostics.signalingState}`)
    } else {
      console.log(`   Error: ${diagnostics.peerConnectionError}`)
    }
    
    console.log('\n🎵 Transceiver:')
    console.log(`   Can add transceiver: ${diagnostics.canAddTransceiver ? '✅ Yes' : '❌ No'}`)
    if (!diagnostics.canAddTransceiver) {
      console.log(`   Error: ${diagnostics.transceiverError}`)
    }
    
    console.log('\n📝 SDP Offer:')
    console.log(`   Can create offer: ${diagnostics.canCreateOffer ? '✅ Yes' : '❌ No'}`)
    console.log(`   Can set local description: ${diagnostics.canSetLocalDescription ? '✅ Yes' : '❌ No'}`)
    if (diagnostics.canCreateOffer) {
      console.log(`   Offer type: ${diagnostics.offerType}`)
      console.log(`   SDP length: ${diagnostics.offerSdpLength} characters`)
    } else {
      console.log(`   Error: ${diagnostics.offerError}`)
    }
    
    console.log('\n📹 Media Devices:')
    console.log(`   navigator.mediaDevices exists: ${diagnostics.mediaDevices.exists ? '✅ Yes' : '❌ No'}`)
    console.log(`   enumerateDevices available: ${diagnostics.mediaDevices.enumerateDevices ? '✅ Yes' : '❌ No'}`)
    console.log(`   getUserMedia available: ${diagnostics.mediaDevices.getUserMedia ? '✅ Yes' : '❌ No'}`)
    
    console.log('\n' + '='.repeat(80))

    // Determine overall status
    const allGood = diagnostics.hasRTCPeerConnection &&
                    diagnostics.canCreatePeerConnection &&
                    diagnostics.canAddTransceiver &&
                    diagnostics.canCreateOffer &&
                    diagnostics.canSetLocalDescription

    if (allGood) {
      console.log('✅ ALL CHECKS PASSED - WebRTC should work in Firefox!')
    } else {
      console.log('❌ SOME CHECKS FAILED - WebRTC may not work properly')
      console.log('\n💡 Troubleshooting:')
      console.log('   1. Check that firefoxUserPrefs are being applied in playwright.config.js')
      console.log('   2. Verify media.peerconnection.enabled is set to true')
      console.log('   3. Check Firefox version compatibility')
      console.log('   4. Look for console errors in the browser')
    }
    console.log('='.repeat(80) + '\n')

    // Assertions
    expect(diagnostics.hasRTCPeerConnection).toBe(true)
    expect(diagnostics.canCreatePeerConnection).toBe(true)
    expect(diagnostics.canAddTransceiver).toBe(true)
    expect(diagnostics.canCreateOffer).toBe(true)
    expect(diagnostics.canSetLocalDescription).toBe(true)
  })

  test('should actually gather ICE candidates in Firefox', async ({ page, browserName }) => {
    test.skip(browserName !== 'firefox', 'This test is Firefox-specific')

    console.log('Testing actual ICE candidate gathering...\n')

    await page.goto(url)

    const result = await page.evaluate(async () => {
      console.log('Starting minimal ICE gathering test...')
      
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      })

      const candidates = []

      const promise = new Promise((resolve) => {
        pc.onicecandidate = event => {
          if (event.candidate) {
            console.log(`Got candidate: ${event.candidate.type} - ${event.candidate.candidate}`)
            candidates.push({
              type: event.candidate.type,
              candidate: event.candidate.candidate
            })
          } else {
            console.log('ICE gathering complete')
            resolve()
          }
        }

        setTimeout(() => {
          console.log('Timeout reached')
          resolve()
        }, 10000)
      })

      console.log('Adding transceiver...')
      pc.addTransceiver('audio', { direction: 'recvonly' })
      
      console.log('Creating offer...')
      const offer = await pc.createOffer()
      
      console.log('Setting local description...')
      await pc.setLocalDescription(offer)
      
      console.log('Waiting for candidates...')
      await promise

      pc.close()

      return {
        total: candidates.length,
        types: {
          host: candidates.filter(c => c.type === 'host').length,
          srflx: candidates.filter(c => c.type === 'srflx').length,
          relay: candidates.filter(c => c.type === 'relay').length
        },
        candidates
      }
    })

    console.log('='.repeat(80))
    console.log('ICE GATHERING TEST RESULTS')
    console.log('='.repeat(80))
    console.log(`\nTotal candidates: ${result.total}`)
    console.log(`  Host: ${result.types.host}`)
    console.log(`  SRFLX: ${result.types.srflx}`)
    console.log(`  Relay: ${result.types.relay}`)
    
    if (result.total === 0) {
      console.log('\n❌ NO CANDIDATES GATHERED!')
      console.log('\n💡 This indicates:')
      console.log('   - Firefox preferences may not be applied correctly')
      console.log('   - Network may be blocking ICE gathering')
      console.log('   - WebRTC may be disabled at a lower level')
    } else if (result.types.srflx === 0) {
      console.log('\n⚠️  No SRFLX candidates! STUN is not working.')
      console.log('\n💡 This indicates:')
      console.log('   - STUN servers may be blocked by firewall')
      console.log('   - Network may not allow UDP traffic')
      console.log('   - Privacy settings may be blocking STUN')
    } else {
      console.log('\n✅ ICE gathering is working! STUN is functional.')
    }
    
    console.log('='.repeat(80) + '\n')

    expect(result.total).toBeGreaterThan(0)
    expect(result.types.host).toBeGreaterThan(0)
  })
})

