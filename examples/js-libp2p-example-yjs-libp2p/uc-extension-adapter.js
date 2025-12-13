/* eslint-disable no-console */

import { pipe } from 'it-pipe'
import * as lp from 'it-length-prefixed'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import manifest from './extension-manifest.json'

/**
 * UC Extension Adapter for Spreadsheet
 * 
 * This adapter enables the spreadsheet to be used as an extension
 * within Universal Connectivity chat.
 * 
 * Uses libp2p identify protocol for discovery and direct streams for communication:
 * - Registers protocol /uc/extension/sheet/1.0.0
 * - Discovery happens automatically via libp2p identify
 * - Handles manifest requests and command execution via direct streams
 */

// Protocol string following UC extension convention
const EXTENSION_PROTOCOL = `/uc/extension/${manifest.id}/${manifest.version}`

export class UCExtensionAdapter {
  /**
   * @param {import('libp2p').Libp2p} libp2p - libp2p node
   * @param {import('./spreadsheet-engine.js').SpreadsheetEngine} spreadsheetEngine - spreadsheet engine
   * @param {string} topic - current spreadsheet topic name
   */
  constructor (libp2p, spreadsheetEngine, topic) {
    this.libp2p = libp2p
    this.spreadsheetEngine = spreadsheetEngine
    this.topic = topic // Current spreadsheet room/topic
    this.topics = new Set([topic]) // Track all active topics
  }

  /**
   * Start the extension adapter - register protocol handler
   */
  async start () {
    try {
      // Register the extension protocol handler
      // This makes the extension discoverable via libp2p identify
      await this.libp2p.handle(EXTENSION_PROTOCOL, this.handleProtocol.bind(this))
      console.log(`✅ UC Extension: Registered protocol ${EXTENSION_PROTOCOL}`)
      console.log(`📦 Extension "${manifest.name}" is now discoverable via identify`)
      console.log(`📍 Current spreadsheet topic: ${this.topic}`)
    } catch (error) {
      console.error('Failed to start UC extension adapter:', error)
      throw error
    }
  }

  /**
   * Stop the extension adapter - unregister protocol handler
   */
  async stop () {
    try {
      await this.libp2p.unhandle(EXTENSION_PROTOCOL)
      console.log('✅ UC Extension Adapter stopped')
    } catch (error) {
      console.error('Failed to stop UC extension adapter:', error)
    }
  }

  /**
   * Handle incoming protocol stream
   */
  async handleProtocol ({ stream, connection }) {
    const remotePeer = connection.remotePeer.toString()
    console.log(`🔗 UC Extension: Stream from ${remotePeer.slice(-8)}`)

    try {
      await pipe(
        stream.source,
        (source) => lp.decode(source),
        async function * (source) {
          for await (const data of source) {
            const request = JSON.parse(uint8ArrayToString(data.subarray()))
            console.log(`📨 UC Extension: Received ${request.type} from ${remotePeer.slice(-8)}`)

            let response
            switch (request.type) {
              case 'manifest-request':
                response = this.handleManifestRequest(request)
                break
              case 'command':
                response = await this.handleCommand(request)
                break
              default:
                response = {
                  type: 'response',
                  requestId: request.requestId,
                  success: false,
                  error: `Unknown request type: ${request.type}`,
                  timestamp: Date.now()
                }
            }

            // Only send response if not null (null means silently ignore)
            if (response !== null) {
              yield uint8ArrayFromString(JSON.stringify(response))
            }
          }
        }.bind(this),
        (source) => lp.encode(source),
        stream.sink
      )
    } catch (error) {
      console.error('UC Extension: Protocol handler error:', error)
    }
  }

  /**
   * Handle manifest request
   */
  handleManifestRequest (request) {
    console.log('📋 UC Extension: Sending manifest')
    return {
      type: 'manifest-response',
      manifest: manifest,
      timestamp: Date.now()
    }
  }

  /**
   * Handle a command request
   */
  async handleCommand (request) {
    const { command, args, requestId } = request

    console.log(`🎯 UC Extension: Command: ${command} ${args.join(' ')}`)

    let response = {
      type: 'response',
      requestId,
      success: false,
      data: null,
      error: null,
      timestamp: Date.now()
    }

    try {
      switch (command) {
        case 'help':
          response = await this.handleHelp(args, requestId)
          break
        case 'show':
          response = await this.handleShow(args, requestId)
          break
        case 'write':
          response = await this.handleWrite(args, requestId)
          break
        case 'list':
          response = await this.handleList(args, requestId)
          break
        default:
          response.error = `Unknown command: ${command}. Type /sheet-help for available commands.`
      }
    } catch (error) {
      response.error = error.message
      console.error(`UC Extension: Command error:`, error)
    }

    return response
  }

  /**
   * Handle help command: /sheet-help
   */
  async handleHelp (args, requestId) {
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
      type: 'response',
      requestId,
      success: true,
      data: {
        help: helpText,
        publicUrl: manifest.publicUrl,
        commands: manifest.commands
      },
      timestamp: Date.now()
    }
  }

  /**
   * Handle show command: /sheet-show <topic> <cell>
   */
  async handleShow (args, requestId) {
    if (args.length < 2) {
      return {
        type: 'response',
        requestId,
        success: false,
        error: 'Usage: /sheet-show <topic> <cell>',
        timestamp: Date.now()
      }
    }

    const [requestedTopic, cellRef] = args

    // Silently ignore if we're not on the requested topic
    // Another peer handling that topic will respond
    if (requestedTopic !== this.topic) {
      return null
    }

    // Get cell value
    const cell = this.spreadsheetEngine.getCell(cellRef)

    return {
      type: 'response',
      requestId,
      success: true,
      data: {
        topic: requestedTopic,
        cell: cellRef,
        value: cell.value,
        formula: cell.formula,
        error: cell.error
      },
      timestamp: Date.now()
    }
  }

  /**
   * Handle write command: /sheet-write <topic> <cell>=<value>
   */
  async handleWrite (args, requestId) {
    if (args.length < 2) {
      return {
        type: 'response',
        requestId,
        success: false,
        error: 'Usage: /sheet-write <topic> <cell>=<value>',
        timestamp: Date.now()
      }
    }

    const [requestedTopic, assignment] = args

    // Silently ignore if we're not on the requested topic
    // Another peer handling that topic will respond
    if (requestedTopic !== this.topic) {
      return null
    }

    // Parse assignment (e.g., "A1=25" or "B2=hello")
    const match = assignment.match(/^([A-Z]+\d+)=(.+)$/)
    if (!match) {
      return {
        type: 'response',
        requestId,
        success: false,
        error: 'Invalid assignment format. Use: <cell>=<value> (e.g., A1=25)',
        timestamp: Date.now()
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
      type: 'response',
      requestId,
      success: true,
      data: {
        topic: requestedTopic,
        cell: cellRef,
        value: cell.value,
        formula: cell.formula
      },
      timestamp: Date.now()
    }
  }

  /**
   * Handle list command: /sheet-list
   */
  async handleList (args, requestId) {
    return {
      type: 'response',
      requestId,
      success: true,
      data: {
        topics: Array.from(this.topics),
        currentTopic: this.topic
      },
      timestamp: Date.now()
    }
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
