/* eslint-disable no-console */

import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const url = 'http://localhost:5173'

// Read adapter.js to inject into the page for cross-browser compatibility
const adapterPath = join(__dirname, '../../../node_modules/webrtc-adapter/out/adapter.js')
const adapterScript = readFileSync(adapterPath, 'utf8')

/**
 * Firefox-specific ICE connectivity test
 * Based on WebRTC samples trickle-ice example
 * Reference: https://github.com/webrtc/samples/tree/gh-pages/src/content/peerconnection/trickle-ice
 * 
 * This test verifies that Firefox can properly gather ICE candidates including:
 * - Host candidates (local network interfaces)
 * - SRFLX candidates (server reflexive, via STUN)
 * - Relay candidates (via TURN, if configured)
 */
test.describe('Firefox ICE Trickle Test', () => {
  test.setTimeout(90000) // 90 seconds timeout to handle slow Firefox ICE gathering

  test('should gather ICE candidates using trickle ICE pattern in Firefox', async ({ page, browserName }) => {
    // This test only runs on Firefox
    test.skip(browserName !== 'firefox', 'This test is Firefox-specific')

    console.log('Starting Firefox ICE Trickle Test')

    // Capture browser console logs
    page.on('console', msg => {
      const type = msg.type()
      const text = msg.text()
      if (type === 'log' && !text.includes('Vite')) {
        console.log(`  Browser: ${text}`)
      } else if (type === 'error') {
        console.log(`  ❌ Browser Error: ${text}`)
      }
    })

    await page.goto(url)

    // Inject webrtc-adapter for cross-browser compatibility
    await page.addScriptTag({ content: adapterScript })
    console.log('Injected webrtc-adapter for production-like environment\n')

    // Run the trickle ICE test
    const result = await page.evaluate(async () => {
      const log = (msg) => console.log(msg)

      // STUN servers configuration
      const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com' }
      ]

      log('Configuring RTCPeerConnection with STUN servers')
      const pc = new RTCPeerConnection({ iceServers })

      const candidates = {
        host: [],
        srflx: [],
        relay: [],
        all: []
      }

      let gatheringComplete = false
      let iceGatheringState = pc.iceGatheringState

      // Track timing
      const startTime = Date.now()
      let firstCandidateTime = null
      let firstSrflxTime = null

      // Promise that resolves when ICE gathering completes
      const gatheringPromise = new Promise((resolve) => {
        // Handle individual ICE candidates as they trickle in
        pc.onicecandidate = event => {
          if (event.candidate) {
            const candidate = event.candidate
            const now = Date.now() - startTime

            if (!firstCandidateTime) {
              firstCandidateTime = now
            }

            if (candidate.type === 'srflx' && !firstSrflxTime) {
              firstSrflxTime = now
            }

            const candidateInfo = {
              type: candidate.type,
              protocol: candidate.protocol,
              address: candidate.address,
              port: candidate.port,
              priority: candidate.priority,
              foundation: candidate.foundation,
              component: candidate.component,
              relatedAddress: candidate.relatedAddress,
              relatedPort: candidate.relatedPort,
              candidate: candidate.candidate,
              timestamp: now
            }

            candidates.all.push(candidateInfo)
            
            if (candidate.type) {
              candidates[candidate.type].push(candidateInfo)
            }

            log(`ICE candidate (${candidate.type}): ${candidate.address || 'N/A'}:${candidate.port || 'N/A'} [${candidate.protocol}]`)
          } else {
            // null candidate indicates gathering is complete
            log('ICE gathering complete (null candidate received)')
            gatheringComplete = true
            resolve()
          }
        }

        // Monitor ICE gathering state changes
        pc.onicegatheringstatechange = () => {
          iceGatheringState = pc.iceGatheringState
          log(`ICE gathering state changed: ${iceGatheringState}`)
          
          if (pc.iceGatheringState === 'complete') {
            gatheringComplete = true
            resolve()
          }
        }

        // Monitor connection state
        pc.oniceconnectionstatechange = () => {
          log(`ICE connection state: ${pc.iceConnectionState}`)
        }

        // Safety timeout - Firefox can be slow
        setTimeout(() => {
          log('ICE gathering timeout reached (15 seconds)')
          // Mark as complete even if we didn't get the final signal
          // Firefox sometimes doesn't send the null candidate
          if (candidates.all.length > 0) {
            gatheringComplete = true
          }
          resolve()
        }, 15000)
      })

      // Add a transceiver to trigger ICE gathering
      // Firefox requires a media line to properly gather candidates
      log('Adding audio transceiver (recvonly)')
      pc.addTransceiver('audio', { direction: 'recvonly' })

      // Create offer to start ICE gathering
      log('Creating SDP offer...')
      const offer = await pc.createOffer()
      
      log('Setting local description...')
      await pc.setLocalDescription(offer)

      log('Waiting for ICE candidates to trickle in...')
      await gatheringPromise

      const totalTime = Date.now() - startTime
      log(`Total gathering time: ${totalTime}ms`)

      // Get the local description with all candidates
      const localDescription = pc.localDescription

      // Close the peer connection
      pc.close()

      return {
        success: true,
        timing: {
          total: totalTime,
          firstCandidate: firstCandidateTime,
          firstSrflx: firstSrflxTime
        },
        counts: {
          total: candidates.all.length,
          host: candidates.host.length,
          srflx: candidates.srflx.length,
          relay: candidates.relay.length
        },
        gatheringComplete,
        finalGatheringState: iceGatheringState,
        candidates: {
          host: candidates.host.map(c => ({
            type: c.type,
            protocol: c.protocol,
            address: c.address,
            port: c.port
          })),
          srflx: candidates.srflx.map(c => ({
            type: c.type,
            protocol: c.protocol,
            address: c.address,
            port: c.port,
            relatedAddress: c.relatedAddress,
            relatedPort: c.relatedPort
          })),
          relay: candidates.relay.map(c => ({
            type: c.type,
            protocol: c.protocol,
            address: c.address,
            port: c.port
          }))
        },
        sdp: localDescription ? localDescription.sdp : null
      }
    })

    // Display results
    console.log('\n' + '='.repeat(80))
    console.log('FIREFOX ICE TRICKLE TEST RESULTS')
    console.log('='.repeat(80))
    console.log(`\n⏱️  Timing:`)
    console.log(`   Total gathering time: ${result.timing.total}ms`)
    console.log(`   Time to first candidate: ${result.timing.firstCandidate}ms`)
    console.log(`   Time to first SRFLX: ${result.timing.firstSrflx ? result.timing.firstSrflx + 'ms' : 'N/A'}`)
    
    console.log(`\n📊 Candidate Counts:`)
    console.log(`   Total: ${result.counts.total}`)
    console.log(`   Host: ${result.counts.host}`)
    console.log(`   SRFLX (via STUN): ${result.counts.srflx}`)
    console.log(`   Relay (via TURN): ${result.counts.relay}`)

    console.log(`\n✅ Gathering Status:`)
    console.log(`   Complete: ${result.gatheringComplete}`)
    console.log(`   Final state: ${result.finalGatheringState}`)

    // Show host candidates
    if (result.candidates.host.length > 0) {
      console.log(`\n🏠 Host Candidates (Local Network):`)
      result.candidates.host.forEach((c, i) => {
        console.log(`   ${i + 1}. ${c.address}:${c.port} [${c.protocol}]`)
      })
    }

    // Show SRFLX candidates (most important for NAT traversal)
    if (result.candidates.srflx.length > 0) {
      console.log(`\n🌐 SRFLX Candidates (Public IPs via STUN):`)
      result.candidates.srflx.forEach((c, i) => {
        console.log(`   ${i + 1}. ${c.address}:${c.port} [${c.protocol}]`)
        if (c.relatedAddress) {
          console.log(`      Related to: ${c.relatedAddress}:${c.relatedPort}`)
        }
      })
    } else {
      console.log(`\n⚠️  No SRFLX candidates gathered!`)
      console.log(`   This may indicate:`)
      console.log(`   - STUN servers are not reachable`)
      console.log(`   - Firewall blocking UDP traffic`)
      console.log(`   - Network/NAT configuration issues`)
    }

    // Show relay candidates if any
    if (result.candidates.relay.length > 0) {
      console.log(`\n🔄 Relay Candidates (via TURN):`)
      result.candidates.relay.forEach((c, i) => {
        console.log(`   ${i + 1}. ${c.address}:${c.port} [${c.protocol}]`)
      })
    }

    console.log('\n' + '='.repeat(80) + '\n')

    // Assertions
    expect(result.success).toBe(true)
    expect(result.counts.total).toBeGreaterThan(0)
    expect(result.counts.host).toBeGreaterThan(0)
    
    // SRFLX candidates are critical for P2P connectivity
    expect(result.counts.srflx).toBeGreaterThan(0)
    
    // Firefox should either complete gathering OR have gathered candidates
    // Sometimes Firefox doesn't send the final null candidate signal
    if (!result.gatheringComplete) {
      console.log('\n⚠️  Note: Firefox did not signal gathering complete, but candidates were gathered')
      console.log('   This is a known Firefox behavior and is acceptable if we have candidates')
    }
    expect(result.counts.total).toBeGreaterThan(0) // Main requirement: we got candidates
  })

  test('should test multiple STUN servers in parallel in Firefox', async ({ page, browserName }) => {
    test.skip(browserName !== 'firefox', 'This test is Firefox-specific')

    console.log('Testing multiple STUN servers in parallel')

    await page.goto(url)

    // Inject webrtc-adapter for cross-browser compatibility
    await page.addScriptTag({ content: adapterScript })

    const result = await page.evaluate(async () => {
      const stunServers = [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun.services.mozilla.com',
        'stun:stun.stunprotocol.org:3478'
      ]

      const results = []

      for (const stunUrl of stunServers) {
        const startTime = Date.now()
        
        try {
          const pc = new RTCPeerConnection({
            iceServers: [{ urls: stunUrl }]
          })

          let srflxFound = false
          let firstSrflxTime = null
          const candidates = { host: 0, srflx: 0, relay: 0 }

          const gatheringPromise = new Promise((resolve) => {
            pc.onicecandidate = event => {
              if (event.candidate) {
                const type = event.candidate.type
                if (type) {
                  candidates[type]++
                }
                if (type === 'srflx' && !srflxFound) {
                  srflxFound = true
                  firstSrflxTime = Date.now() - startTime
                }
              } else {
                resolve()
              }
            }

            pc.onicegatheringstatechange = () => {
              if (pc.iceGatheringState === 'complete') {
                resolve()
              }
            }

            // Firefox can be slow, give it more time
            setTimeout(() => resolve(), 15000)
          })

          pc.addTransceiver('audio', { direction: 'recvonly' })
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          await gatheringPromise

          const totalTime = Date.now() - startTime

          results.push({
            stunUrl,
            success: true,
            working: srflxFound,
            totalTime,
            firstSrflxTime,
            candidates
          })

          pc.close()
        } catch (error) {
          results.push({
            stunUrl,
            success: false,
            working: false,
            error: error.message
          })
        }
      }

      return results
    })

    console.log('\n' + '='.repeat(80))
    console.log('FIREFOX MULTIPLE STUN SERVERS TEST')
    console.log('='.repeat(80))

    result.forEach(r => {
      console.log(`\n${r.working ? '✅' : '❌'} ${r.stunUrl}`)
      if (r.success) {
        console.log(`   Time: ${r.totalTime}ms (first SRFLX: ${r.firstSrflxTime ? r.firstSrflxTime + 'ms' : 'N/A'})`)
        console.log(`   Candidates: Host=${r.candidates.host}, SRFLX=${r.candidates.srflx}, Relay=${r.candidates.relay}`)
      } else {
        console.log(`   Error: ${r.error}`)
      }
    })

    console.log('='.repeat(80) + '\n')

    const workingCount = result.filter(r => r.working).length
    console.log(`Working STUN servers: ${workingCount}/${result.length}`)

    expect(workingCount).toBeGreaterThan(0)
  })
})

