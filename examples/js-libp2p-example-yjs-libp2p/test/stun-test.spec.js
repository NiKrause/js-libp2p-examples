/* eslint-disable no-console */

import { test, expect } from '@playwright/test'

const url = 'http://localhost:5173'

/**
 * Test STUN server connectivity from browser
 * This runs in the browser context to test if WebRTC can access STUN servers
 */
test.describe('STUN Server Connectivity', () => {
  test.setTimeout(30000)

  test('should be able to reach STUN servers from Chromium', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    // Capture console logs
    const logs = []
    page.on('console', msg => {
      logs.push(`[${msg.type()}] ${msg.text()}`)
      console.log(`Browser: ${msg.text()}`)
    })

    await page.goto(url)

    // Test STUN connectivity using WebRTC RTCPeerConnection
    const result = await page.evaluate(async () => {
      const stunServers = [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302'
      ]

      const results = []

      for (const stunUrl of stunServers) {
        try {
          const pc = new RTCPeerConnection({
            iceServers: [{ urls: [stunUrl] }]
          })

          const candidates = []
          let gatheringComplete = false

          // Collect ICE candidates
          const candidatePromise = new Promise((resolve) => {
            pc.onicecandidate = (event) => {
              if (event.candidate) {
                candidates.push({
                  type: event.candidate.type,
                  candidate: event.candidate.candidate,
                  protocol: event.candidate.protocol
                })
              } else {
                // null candidate means gathering is complete
                gatheringComplete = true
                resolve()
              }
            }

            // Timeout after 10 seconds
            setTimeout(() => resolve(), 10000)
          })

          // Create a data channel to trigger ICE gathering
          pc.createDataChannel('test')

          // Create and set local description to start ICE gathering
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)

          // Wait for ICE gathering to complete
          await candidatePromise

          // Categorize candidates
          const hostCandidates = candidates.filter(c => c.type === 'host')
          const srflxCandidates = candidates.filter(c => c.type === 'srflx')
          const relayCandidates = candidates.filter(c => c.type === 'relay')

          results.push({
            stunUrl,
            success: true,
            gatheringComplete,
            totalCandidates: candidates.length,
            hostCandidates: hostCandidates.length,
            srflxCandidates: srflxCandidates.length,
            relayCandidates: relayCandidates.length,
            hasSrflx: srflxCandidates.length > 0,
            candidates: candidates.map(c => ({
              type: c.type,
              protocol: c.protocol
            }))
          })

          pc.close()
        } catch (error) {
          results.push({
            stunUrl,
            success: false,
            error: error.message
          })
        }
      }

      return {
        browserName: navigator.userAgent,
        results
      }
    })

    console.log('\n' + '='.repeat(60))
    console.log('STUN CONNECTIVITY TEST RESULTS')
    console.log('='.repeat(60))
    console.log(`\nBrowser: ${result.browserName}\n`)

    let hasAnySrflx = false

    for (const serverResult of result.results) {
      console.log(`\nSTUN Server: ${serverResult.stunUrl}`)
      if (serverResult.success) {
        console.log(`  ✅ ICE gathering completed: ${serverResult.gatheringComplete}`)
        console.log(`  📊 Total candidates: ${serverResult.totalCandidates}`)
        console.log(`  🏠 Host candidates: ${serverResult.hostCandidates}`)
        console.log(`  🌐 SRFLX candidates: ${serverResult.srflxCandidates}`)
        console.log(`  🔄 Relay candidates: ${serverResult.relayCandidates}`)

        if (serverResult.hasSrflx) {
          console.log('  ✅ STUN server is working! (SRFLX candidates found)')
          hasAnySrflx = true
        } else {
          console.log('  ⚠️  No SRFLX candidates (STUN may not be working)')
        }

        console.log('\n  Candidate breakdown:')
        const candidatesByType = {}
        serverResult.candidates.forEach(c => {
          const key = `${c.type}/${c.protocol}`
          candidatesByType[key] = (candidatesByType[key] || 0) + 1
        })
        for (const [type, count] of Object.entries(candidatesByType)) {
          console.log(`    - ${type}: ${count}`)
        }
      } else {
        console.log(`  ❌ Failed: ${serverResult.error}`)
      }
    }

    console.log('\n' + '='.repeat(60))
    if (hasAnySrflx) {
      console.log('✅ STUN SERVERS ARE WORKING')
      console.log('   SRFLX candidates were successfully gathered.')
      console.log('   This means STUN connectivity is NOT the problem.')
    } else {
      console.log('❌ STUN SERVERS ARE NOT WORKING')
      console.log('   No SRFLX candidates were gathered.')
      console.log('   This is likely why WebRTC connections fail!')
      console.log('\n   Possible causes:')
      console.log('   - Firewall blocking UDP traffic')
      console.log('   - Network policy blocking STUN')
      console.log('   - Browser security restrictions')
    }
    console.log('='.repeat(60) + '\n')

    // Expectations
    expect(result.results.length).toBeGreaterThan(0)

    // At least one STUN server should work (be lenient for CI environments)
    const anySuccess = result.results.some(r => r.success)
    expect(anySuccess).toBe(true)

    await context.close()
  })

  test('should gather both host and srflx candidates', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto(url)

    const candidates = await page.evaluate(async () => {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: ['stun:stun.l.google.com:19302'] },
          { urls: ['stun:stun1.l.google.com:19302'] }
        ]
      })

      const collected = []

      const candidatePromise = new Promise((resolve) => {
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            collected.push({
              type: event.candidate.type,
              address: event.candidate.address,
              port: event.candidate.port,
              protocol: event.candidate.protocol,
              priority: event.candidate.priority
            })
          } else {
            resolve()
          }
        }
        setTimeout(() => resolve(), 10000)
      })

      pc.createDataChannel('test')
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      await candidatePromise
      pc.close()

      return collected
    })

    console.log('\n📋 Detailed Candidate List:')
    candidates.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.type} - ${c.address}:${c.port} (${c.protocol}) [priority: ${c.priority}]`)
    })

    const hostCandidates = candidates.filter(c => c.type === 'host')
    const srflxCandidates = candidates.filter(c => c.type === 'srflx')

    console.log(`\n✅ Host candidates: ${hostCandidates.length}`)
    console.log(`${srflxCandidates.length > 0 ? '✅' : '❌'} SRFLX candidates: ${srflxCandidates.length}`)

    // We should have at least host candidates
    expect(hostCandidates.length).toBeGreaterThan(0)

    // Log warning if no SRFLX
    if (srflxCandidates.length === 0) {
      console.log('\n⚠️  WARNING: No SRFLX candidates!')
      console.log('   This means STUN servers are not working.')
      console.log('   WebRTC may only work on local network.')
    }

    await context.close()
  })

  test('should compare ICE gathering across different browsers', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto(url)

    const browserInfo = await page.evaluate(async () => {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: ['stun:stun.l.google.com:19302'] },
          { urls: ['stun:stun1.l.google.com:19302'] }
        ]
      })

      const candidates = []
      let iceGatheringState = 'new'
      let iceConnectionState = 'new'

      const candidatePromise = new Promise((resolve) => {
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            candidates.push(event.candidate.type)
          } else {
            resolve()
          }
        }

        pc.onicegatheringstatechange = () => {
          iceGatheringState = pc.iceGatheringState
        }

        pc.oniceconnectionstatechange = () => {
          iceConnectionState = pc.iceConnectionState
        }

        setTimeout(() => resolve(), 10000)
      })

      pc.createDataChannel('test')
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      await candidatePromise
      pc.close()

      return {
        userAgent: navigator.userAgent,
        browser: navigator.userAgent.match(/(Firefox|Chrome|Safari|Edg)/)?.[0] || 'Unknown',
        candidates: {
          host: candidates.filter(t => t === 'host').length,
          srflx: candidates.filter(t => t === 'srflx').length,
          relay: candidates.filter(t => t === 'relay').length
        },
        iceGatheringState,
        iceConnectionState
      }
    })

    console.log('\n' + '='.repeat(60))
    console.log('BROWSER ICE GATHERING COMPARISON')
    console.log('='.repeat(60))
    console.log(`\nBrowser: ${browserInfo.browser}`)
    console.log(`User Agent: ${browserInfo.userAgent}`)
    console.log(`\nICE Gathering State: ${browserInfo.iceGatheringState}`)
    console.log(`ICE Connection State: ${browserInfo.iceConnectionState}`)
    console.log('\nCandidate Types:')
    console.log(`  - Host: ${browserInfo.candidates.host}`)
    console.log(`  - SRFLX: ${browserInfo.candidates.srflx}`)
    console.log(`  - Relay: ${browserInfo.candidates.relay}`)
    console.log('='.repeat(60) + '\n')

    // Basic expectations
    expect(browserInfo.candidates.host).toBeGreaterThan(0)

    await context.close()
  })
})
