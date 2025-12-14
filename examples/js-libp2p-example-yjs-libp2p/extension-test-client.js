/* eslint-disable no-console */

import { peerIdFromString } from '@libp2p/peer-id'
import { pbStream } from 'it-protobuf-stream'
import { ext } from './protobuf/extension.js'

/**
 * Simple Extension Test Client
 * 
 * Demonstrates how UC chat app discovers and uses extensions
 * Use this to test your extension without needing the full UC chat app
 */

const EXTENSION_PROTOCOL_PREFIX = '/uc/extension/'

export class ExtensionTestClient {
  constructor(libp2p) {
    this.libp2p = libp2p
    this.discoveredExtensions = new Map()
  }

  /**
   * Start discovering extensions
   */
  async start() {
    console.log('🔍 Extension Test Client: Starting...')

    // Listen for peer:identify events
    this.libp2p.addEventListener('peer:identify', (evt) => {
      this.handlePeerIdentify(evt)
    })

    console.log('✅ Extension Test Client: Listening for extensions')
  }

  /**
   * Handle peer identification
   */
  async handlePeerIdentify(evt) {
    const { peerId, protocols } = evt.detail
    const peerIdStr = peerId.toString()

    console.log(`🔍 Peer identified: ${peerIdStr.slice(0, 8)}... with ${protocols.length} protocols`)

    // Look for extension protocols
    for (const protocol of protocols) {
      if (protocol.startsWith(EXTENSION_PROTOCOL_PREFIX)) {
        const match = protocol.match(/^\/uc\/extension\/([^/]+)\/([^/]+)$/)
        if (match) {
          const [, extensionId, version] = match
          console.log(`📦 Found extension: ${extensionId} v${version} from peer ${peerIdStr.slice(0, 8)}...`)
          
          // Fetch manifest
          try {
            const manifest = await this.fetchManifest(peerIdStr, protocol)
            this.discoveredExtensions.set(extensionId, {
              manifest,
              peerId: peerIdStr,
              protocol
            })
            console.log(`✅ Extension discovered: ${manifest.name}`)
            console.log(`   Description: ${manifest.description}`)
            console.log(`   Commands: ${manifest.commands.map(c => c.name).join(', ')}`)
          } catch (error) {
            console.error(`❌ Failed to fetch manifest for ${extensionId}:`, error.message)
          }
        }
      }
    }
  }

  /**
   * Fetch extension manifest
   */
  async fetchManifest(peerIdStr, protocol) {
    const peerId = peerIdFromString(peerIdStr)
    const stream = await this.libp2p.dialProtocol(peerId, protocol)
    const datastream = pbStream(stream)

    try {
      const request = {
        payload: 'manifest',
        manifest: {
          timestamp: BigInt(Date.now())
        }
      }

      const signal = AbortSignal.timeout(5000)
      await datastream.write(request, ext.Request, { signal })

      const response = await datastream.read(ext.Response, { signal })

      if (response.payload === 'manifest' && response.manifest?.manifest) {
        return {
          id: response.manifest.manifest.id,
          name: response.manifest.manifest.name,
          version: response.manifest.manifest.version,
          description: response.manifest.manifest.description,
          author: response.manifest.manifest.author,
          publicUrl: response.manifest.manifest.publicUrl,
          icon: response.manifest.manifest.icon,
          commands: response.manifest.manifest.commands.map(cmd => ({
            name: cmd.name,
            syntax: cmd.syntax,
            description: cmd.description
          }))
        }
      }

      throw new Error('Invalid manifest response')
    } finally {
      try {
        await stream.close({ signal: AbortSignal.timeout(5000) })
      } catch (err) {
        stream.abort(err)
      }
    }
  }

  /**
   * Execute a command on an extension
   */
  async executeCommand(extensionId, command, args = []) {
    const extension = this.discoveredExtensions.get(extensionId)
    if (!extension) {
      throw new Error(`Extension '${extensionId}' not discovered`)
    }

    const peerId = peerIdFromString(extension.peerId)
    const stream = await this.libp2p.dialProtocol(peerId, extension.protocol)
    const datastream = pbStream(stream)

    try {
      const requestId = crypto.randomUUID()
      const request = {
        payload: 'command',
        command: {
          requestId,
          extensionId,
          command,
          args,
          timestamp: BigInt(Date.now())
        }
      }

      console.log(`📤 Sending command: /${extensionId}-${command} ${args.join(' ')}`)

      const signal = AbortSignal.timeout(5000)
      await datastream.write(request, ext.Request, { signal })

      const response = await datastream.read(ext.Response, { signal })

      if (response.payload === 'command' && response.command) {
        if (response.command.success) {
          console.log(`✅ Command succeeded`)
          return {
            success: true,
            data: response.command.data ? JSON.parse(response.command.data) : undefined
          }
        } else {
          console.error(`❌ Command failed: ${response.command.error}`)
          return {
            success: false,
            error: response.command.error
          }
        }
      }

      throw new Error('Invalid response')
    } finally {
      try {
        await stream.close({ signal: AbortSignal.timeout(5000) })
      } catch (err) {
        stream.abort(err)
      }
    }
  }

  /**
   * List all discovered extensions
   */
  listExtensions() {
    console.log(`\n📦 Discovered Extensions (${this.discoveredExtensions.size}):`)
    for (const [id, ext] of this.discoveredExtensions.entries()) {
      console.log(`\n  ${ext.manifest.name} (${id})`)
      console.log(`    Version: ${ext.manifest.version}`)
      console.log(`    Description: ${ext.manifest.description}`)
      console.log(`    Author: ${ext.manifest.author}`)
      console.log(`    Peer: ${ext.peerId.slice(0, 8)}...`)
      console.log(`    Commands:`)
      ext.manifest.commands.forEach(cmd => {
        console.log(`      - ${cmd.syntax}: ${cmd.description}`)
      })
    }
    console.log('')
  }
}

/**
 * Helper function to test an extension
 * Call this from browser console
 */
export async function testExtension(extensionId, command, args = []) {
  if (!window.extensionTestClient) {
    console.error('❌ Extension test client not initialized')
    return
  }

  try {
    const result = await window.extensionTestClient.executeCommand(extensionId, command, args)
    console.log('📥 Result:', result)
    return result
  } catch (error) {
    console.error('❌ Test failed:', error.message)
  }
}
