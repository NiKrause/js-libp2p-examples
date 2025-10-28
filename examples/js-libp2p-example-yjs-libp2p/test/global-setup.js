/* eslint-disable no-console, no-unused-vars */

import { spawn } from 'child_process'
import { writeFileSync } from 'fs'
import path from 'path'

export default async function globalSetup () {
  console.log('Starting relay server...')

  return new Promise((resolve, reject) => {
    // Start relay server as a child process
    const relayProcess = spawn('node', ['relay.js'], {
      cwd: path.resolve(process.cwd()),
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let relayMultiaddr = null
    let output = ''

    relayProcess.stdout.on('data', (data) => {
      const text = data.toString()
      output += text
      console.log(text)

      // Extract the first multiaddr (WebSocket address)
      const match = text.match(/\/ip4\/127\.0\.0\.1\/tcp\/\d+\/ws\/p2p\/[A-Za-z0-9]+/)
      if (match && !relayMultiaddr) {
        relayMultiaddr = match[0]
        console.log(`Relay server started with multiaddr: ${relayMultiaddr}`)

        // Store relay info for tests
        const relayInfo = {
          multiaddr: relayMultiaddr,
          pid: relayProcess.pid
        }

        writeFileSync(
          path.resolve(process.cwd(), 'test/relay-info.json'),
          JSON.stringify(relayInfo, null, 2)
        )

        // Give the relay a moment to fully initialize
        setTimeout(() => resolve(), 1000)
      }
    })

    relayProcess.stderr.on('data', (data) => {
      console.error('Relay stderr:', data.toString())
    })

    relayProcess.on('error', (error) => {
      console.error('Failed to start relay:', error)
      reject(error)
    })

    // Timeout if relay doesn't start
    setTimeout(() => {
      if (!relayMultiaddr) {
        relayProcess.kill()
        reject(new Error('Relay server failed to start within timeout'))
      }
    }, 10000)
  })
}
