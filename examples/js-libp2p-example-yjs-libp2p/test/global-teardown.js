/* eslint-disable no-console */

import { readFileSync, unlinkSync } from 'fs'
import path from 'path'

export default async function globalTeardown () {
  console.log('Stopping relay server...')

  try {
    const relayInfoPath = path.resolve(process.cwd(), 'test/relay-info.json')
    const relayInfo = JSON.parse(readFileSync(relayInfoPath, 'utf8'))

    if (relayInfo.pid) {
      process.kill(relayInfo.pid, 'SIGTERM')
      console.log(`Relay server (PID ${relayInfo.pid}) stopped`)
    }

    // Clean up the relay info file
    unlinkSync(relayInfoPath)
  } catch (error) {
    console.error('Error stopping relay server:', error.message)
  }
}
