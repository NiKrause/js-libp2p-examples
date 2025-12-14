/* eslint-disable no-console */

import { pbStream } from 'it-protobuf-stream'
import { ext } from './protobuf/extension.js'
import manifest from './extension-manifest.json'

/**
 * UC Extension Service for Spreadsheet
 * 
 * Implements UC's extension pattern with proper service lifecycle:
 * - Uses topology tracking via register()/unregister()
 * - Handles manifest and command requests via pbStream
 * - Follows the same pattern as DirectMessage service
 * 
 * Protocol: /uc/extension/{extensionId}/{version}
 */

const EXTENSION_PROTOCOL = `/uc/extension/${manifest.id}/${manifest.version}`
const REQUEST_TIMEOUT = 5000

export class UCExtensionService {
  /**
   * @param {object} components - Service components
   * @param {object} components.libp2p - libp2p instance
   * @param {object} components.spreadsheetEngine - spreadsheet engine
   * @param {string} components.topic - current spreadsheet topic
   */
  constructor (components) {
    this.libp2p = components.libp2p
    this.spreadsheetEngine = components.spreadsheetEngine
    this.topic = components.topic
    this.topics = new Set([components.topic])
    this.extensionPeers = new Set()
    this.topologyId = null
  }

  /**
   * Start the extension service
   * Register topology to track peers that support this protocol
   */
  async start () {
    console.log(`🔧 UC Extension: Starting service for ${manifest.name}...`)

    // Register topology to track peers
    this.topologyId = await this.libp2p.register(EXTENSION_PROTOCOL, {
      onConnect: (peerId) => {
        const peerIdStr = peerId.toString()
        this.extensionPeers.add(peerIdStr)
        console.log(`📦 UC Extension: Peer connected: ${peerIdStr.slice(0, 8)}...`)
      },
      onDisconnect: (peerId) => {
        const peerIdStr = peerId.toString()
        this.extensionPeers.delete(peerIdStr)
        console.log(`📦 UC Extension: Peer disconnected: ${peerIdStr.slice(0, 8)}...`)
      }
    })

    console.log(`✅ UC Extension: Registered topology for ${EXTENSION_PROTOCOL}`)
  }

  /**
   * After start hook - register protocol handler
   * This is called after libp2p has fully started
   */
  async afterStart () {
    // Register protocol handler for incoming requests
    await this.libp2p.handle(EXTENSION_PROTOCOL, async ({ stream, connection }) => {
      await this.handleRequest(stream, connection)
    })

    console.log(`✅ UC Extension: Registered protocol handler ${EXTENSION_PROTOCOL}`)
    console.log(`📦 Extension "${manifest.name}" is now discoverable`)
    console.log(`📍 Current topic: ${this.topic}`)
  }

  /**
   * Stop the extension service
   */
  stop () {
    if (this.topologyId != null) {
      this.libp2p.unregister(this.topologyId)
    }
    this.extensionPeers.clear()
    console.log('✅ UC Extension: Service stopped')
  }

  /**
   * Handle incoming extension request
   * Uses pbStream exactly like DirectMessage
   * 
   * @param {object} stream - Incoming stream
   * @param {object} connection - Connection object
   */
  async handleRequest (stream, connection) {
    try {
      const datastream = pbStream(stream)
      const signal = AbortSignal.timeout(REQUEST_TIMEOUT)

      // Read the Request wrapper message
      const request = await datastream.read(ext.Request, { signal })

      let response

      // Handle based on request type
      if (request.payload === 'manifest') {
        console.log(`📨 UC Extension: Manifest request from ${connection.remotePeer.toString().slice(0, 8)}...`)
        response = this.createManifestResponse()
      } else if (request.payload === 'command') {
        console.log(`📨 UC Extension: Command "${request.command.command}" from ${connection.remotePeer.toString().slice(0, 8)}...`)
        response = await this.createCommandResponse(request.command)
      } else {
        throw new Error('Unknown request type')
      }

      // Send response if we have one (commands may return null to ignore)
      if (response) {
        await datastream.write(response, ext.Response, { signal })
        console.log(`📤 UC Extension: Response sent`)
      }
    } catch (e) {
      console.error(`❌ UC Extension: Request handler error:`, e?.message || e)
      stream?.abort(e)
      throw e
    } finally {
      try {
        await stream?.close({
          signal: AbortSignal.timeout(5000)
        })
      } catch (err) {
        stream?.abort(err)
        throw err
      }
    }
  }

  /**
   * Create manifest response
   */
  createManifestResponse () {
    return {
      payload: 'manifest',
      manifest: {
        manifest: {
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description,
          author: manifest.author,
          publicUrl: manifest.publicUrl,
          icon: manifest.icon,
          commands: manifest.commands.map(cmd => ({
            name: cmd.name,
            syntax: cmd.syntax,
            description: cmd.description
          }))
        },
        timestamp: BigInt(Date.now())
      }
    }
  }

  /**
   * Create command response
   * Returns null if command should be ignored (wrong topic)
   */
  async createCommandResponse (commandRequest) {
    const { command, args, requestId } = commandRequest

    try {
      let result

      switch (command) {
        case 'help':
          result = await this.handleHelp(args)
          break
        case 'show':
          result = await this.handleShow(args)
          break
        case 'write':
          result = await this.handleWrite(args)
          break
        case 'list':
          result = await this.handleList(args)
          break
        default:
          result = {
            success: false,
            error: `Unknown command: ${command}. Type /sheet-help for available commands.`
          }
      }

      // If command returned null, ignore it (wrong topic)
      if (result === null) {
        return null
      }

      return {
        payload: 'command',
        command: {
          requestId,
          success: result.success,
          data: result.data ? JSON.stringify(result.data) : undefined,
          error: result.error,
          timestamp: BigInt(Date.now())
        }
      }
    } catch (error) {
      return {
        payload: 'command',
        command: {
          requestId,
          success: false,
          error: error.message,
          timestamp: BigInt(Date.now())
        }
      }
    }
  }

  /**
   * Handle help command: /sheet-help
   */
  async handleHelp (args) {
    const helpText = `
📊 ${manifest.name} v${manifest.version}
${manifest.description}

🌐 Open Spreadsheet UI: ${manifest.publicUrl}

Available Commands:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/sheet-help
  Show this help message

/sheet-list
  List all active spreadsheet topics

/sheet-show <topic> <cell>
  Show the value of a cell
  Example: /sheet-show hackathon A1

/sheet-write <topic> <cell>=<value>
  Write a value to a cell
  Example: /sheet-write hackathon A1=100

/sheet-write <topic> <cell>=<formula>
  Write a formula to a cell (start with =)
  Example: /sheet-write hackathon B1==A1*2

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 Current topic: ${this.topic}
👤 Author: ${manifest.author}
🔗 Protocol: ${EXTENSION_PROTOCOL}
`.trim()

    return {
      success: true,
      data: {
        help: helpText,
        publicUrl: manifest.publicUrl,
        commands: manifest.commands
      }
    }
  }

  /**
   * Handle show command: /sheet-show <topic> <cell>
   */
  async handleShow (args) {
    if (args.length < 2) {
      return {
        success: false,
        error: 'Usage: /sheet-show <topic> <cell>'
      }
    }

    const [requestedTopic, cellRef] = args

    // Silently ignore if we're not on the requested topic
    if (requestedTopic !== this.topic) {
      return null
    }

    const cell = this.spreadsheetEngine.getCell(cellRef)

    return {
      success: true,
      data: {
        topic: requestedTopic,
        cell: cellRef,
        value: cell.value,
        formula: cell.formula,
        error: cell.error
      }
    }
  }

  /**
   * Handle write command: /sheet-write <topic> <cell>=<value>
   */
  async handleWrite (args) {
    if (args.length < 2) {
      return {
        success: false,
        error: 'Usage: /sheet-write <topic> <cell>=<value>'
      }
    }

    const [requestedTopic, assignment] = args

    // Silently ignore if we're not on the requested topic
    if (requestedTopic !== this.topic) {
      return null
    }

    // Parse assignment (e.g., "A1=25" or "B2=hello")
    const match = assignment.match(/^([A-Z]+\d+)=(.+)$/)
    if (!match) {
      return {
        success: false,
        error: 'Invalid assignment format. Use: <cell>=<value> (e.g., A1=25)'
      }
    }

    const [, cellRef, value] = match

    // Try to parse value as number if possible, otherwise keep as string
    let parsedValue = value
    if (!value.startsWith('=')) {
      const num = parseFloat(value)
      if (!isNaN(num) && value.trim() === String(num)) {
        parsedValue = num
      }
    }

    // Write to cell
    this.spreadsheetEngine.setCell(cellRef, parsedValue)

    // Get updated cell value
    const cell = this.spreadsheetEngine.getCell(cellRef)

    return {
      success: true,
      data: {
        topic: requestedTopic,
        cell: cellRef,
        value: cell.value,
        formula: cell.formula
      }
    }
  }

  /**
   * Handle list command: /sheet-list
   */
  async handleList (args) {
    return {
      success: true,
      data: {
        topics: Array.from(this.topics),
        currentTopic: this.topic
      }
    }
  }

  /**
   * Get connected extension peers
   */
  getExtensionPeers () {
    return Array.from(this.extensionPeers)
  }

  /**
   * Add a topic to the list of active topics
   */
  addTopic (topic) {
    this.topics.add(topic)
  }

  /**
   * Set the current active topic
   */
  setCurrentTopic (topic) {
    this.topic = topic
    this.addTopic(topic)
  }
}

/**
 * Factory function to create extension service
 * Follows libp2p service pattern
 */
export function ucExtensionService (options = {}) {
  return (components) => {
    const service = new UCExtensionService({ ...components, ...options })
    return service
  }
}
