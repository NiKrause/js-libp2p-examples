/* eslint-disable no-console */

import manifest from './extension-manifest.json'
import { pbStream } from 'it-protobuf-stream'
import { ext } from './protobuf/extension.js'

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
      // Note: Different libp2p versions pass stream differently
      // This version passes the stream directly as first parameter
      await this.libp2p.handle(EXTENSION_PROTOCOL, async (stream) => {
        console.log('🔗 UC Extension: Handler called, stream:', !!stream)
        await this.handleProtocol(stream)
      })
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
   * Uses pbStream exactly like UC's direct-message.ts
   * Note: This libp2p version passes stream directly, not wrapped in object
   */
  async handleProtocol (stream) {
    if (!stream) {
      console.error('🔗 UC Extension: No stream in handler')
      return
    }
    
    console.log(`🔗 UC Extension: Stream received (protocol: ${stream.protocol || 'unknown'})`)
    const datastream = pbStream(stream)
    
    // Critical diagnostic: Check if ext and codecs exist BEFORE try block
    console.error('🚨 UC Extension: AFTER pbStream - checking ext:', typeof ext, ext)
    console.error('🚨 UC Extension: ext.Request exists?', typeof ext?.Request)
    console.error('🚨 UC Extension: ext.Request.codec exists?', typeof ext?.Request?.codec)
    console.error('🚨 UC Extension: ext.Response exists?', typeof ext?.Response)
    console.error('🚨 UC Extension: ext.Response.codec exists?', typeof ext?.Response?.codec)

    try {
      const signal = AbortSignal.timeout(5000)
      
      // Diagnostic tests: Check if protobuf codec exists
      console.log('🔍 UC Extension: Checking ext.Request:', typeof ext.Request, ext.Request)
      console.log('🔍 UC Extension: Checking ext.Request.codec:', typeof ext.Request?.codec)
      if (ext.Request?.codec) {
        console.log('🔍 UC Extension: ext.Request.codec exists:', typeof ext.Request.codec())
      } else {
        console.error('❌ UC Extension: ext.Request.codec is UNDEFINED! Protobuf not generated correctly!')
        throw new Error('ext.Request.codec is undefined - protobuf files need to be regenerated')
      }
      
      console.log('📥 UC Extension: Waiting for request...')
      
      // Read the Request wrapper message
      const request = await datastream.read(ext.Request, { signal })
      
      // Check which type of request it is using the oneof field
      if (request.payload === 'manifest') {
        console.log(`📨 UC Extension: Received manifest request`)
        
        // Create Response wrapper with manifest response
        const response = {
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
                description: cmd.description,
              })),
            },
            timestamp: BigInt(Date.now()),
          }
        }
        
        // Check Response codec before writing
        console.log('🔍 UC Extension: Checking ext.Response.codec:', typeof ext.Response?.codec)
        if (!ext.Response?.codec) {
          throw new Error('ext.Response.codec is undefined - protobuf files need to be regenerated')
        }
        
        console.log(`📤 UC Extension: Sending manifest response`)
        await datastream.write(response, ext.Response, { signal })
        console.log(`📤 UC Extension: Manifest sent!`)
      } else if (request.payload === 'command') {
        console.log(`📨 UC Extension: Received command: ${request.command.command}`)
        
        const commandResponse = await this.handleCommand(request.command)
        
        if (commandResponse !== null) {
          // Create Response wrapper with command response
          const response = {
            payload: 'command',
            command: {
              requestId: request.command.requestId,
              success: commandResponse.success,
              data: commandResponse.data ? JSON.stringify(commandResponse.data) : undefined,
              error: commandResponse.error,
              timestamp: BigInt(Date.now()),
            }
          }
          
          console.log(`📤 UC Extension: Sending command response`)
          await datastream.write(response, ext.Response, { signal })
          console.log(`📤 UC Extension: Command response sent!`)
        }
      } else {
        throw new Error('Unknown request type')
      }
    } catch (e) {
      console.error('❌ UC Extension: Protocol handler error:', e?.message || e)
      console.error('❌ UC Extension: Error stack:', e?.stack)
      console.error('❌ UC Extension: Full error object:', e)
      stream?.abort(e)
      throw e
    } finally {
      // Proper stream cleanup - exactly like direct-message.ts
      try {
        await stream?.close({
          signal: AbortSignal.timeout(5000)
        })
        console.log('🔗 UC Extension: Stream closed successfully')
      } catch (err) {
        console.error('UC Extension: Error closing stream:', err?.message)
        stream?.abort(err)
        throw err
      }
    }
  }

  /**
   * Handle a command request
   */
  async handleCommand (request) {
    const { command, args, requestId } = request

    console.log(`🎯 UC Extension: Command: ${command} ${args.join(' ')}`)

    let response = {
      success: false,
      data: null,
      error: null,
      timestamp: Date.now()
    }

    try {
      switch (command) {
        case 'help':
          response = await this.handleHelp(args)
          break
        case 'show':
          response = await this.handleShow(args)
          break
        case 'write':
          response = await this.handleWrite(args)
          break
        case 'list':
          response = await this.handleList(args)
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
    // Another peer handling that topic will respond
    if (requestedTopic !== this.topic) {
      return null
    }

    // Get cell value
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
    // Another peer handling that topic will respond
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
