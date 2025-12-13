/* eslint-disable no-console */

import manifest from './extension-manifest.json'

/**
 * UC Extension Adapter for Spreadsheet
 * 
 * This adapter enables the spreadsheet to be used as an extension
 * within Universal Connectivity chat.
 * 
 * Features:
 * - Publishes extension manifest periodically on discovery topic
 * - Listens for commands on extension command topic
 * - Executes commands (show, write, list) on the spreadsheet
 * - Returns responses via pubsub
 */

const EXTENSION_DISCOVERY_TOPIC = 'universal-connectivity-extensions'
const COMMAND_TOPIC = 'uc-ext-sheet-commands'
const ANNOUNCE_INTERVAL = 30000 // 30 seconds

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
    this.announceTimer = null
    this.topics = new Set([topic]) // Track all active topics
  }

  /**
   * Start the extension adapter
   */
  async start () {
    try {
      // Subscribe to command topic
      await this.libp2p.services.pubsub.subscribe(COMMAND_TOPIC)
      console.log(`✅ UC Extension: Subscribed to ${COMMAND_TOPIC}`)

      // Listen for commands
      this.libp2p.services.pubsub.addEventListener('message', this.handleMessage.bind(this))

      // Start announcing extension periodically
      this.announceExtension()
      this.announceTimer = setInterval(() => {
        this.announceExtension()
      }, ANNOUNCE_INTERVAL)

      console.log('✅ UC Extension Adapter started')
    } catch (error) {
      console.error('Failed to start UC extension adapter:', error)
      throw error
    }
  }

  /**
   * Stop the extension adapter
   */
  stop () {
    if (this.announceTimer) {
      clearInterval(this.announceTimer)
      this.announceTimer = null
    }
    this.libp2p.services.pubsub.removeEventListener('message', this.handleMessage.bind(this))
    console.log('✅ UC Extension Adapter stopped')
  }

  /**
   * Announce extension on discovery topic
   */
  async announceExtension () {
    try {
      const message = {
        type: 'offer',
        manifest: manifest,
        timestamp: Date.now()
      }

      const data = new TextEncoder().encode(JSON.stringify(message))
      await this.libp2p.services.pubsub.publish(EXTENSION_DISCOVERY_TOPIC, data)
      console.log('📢 UC Extension: Announced spreadsheet extension')
    } catch (error) {
      console.error('Failed to announce extension:', error)
    }
  }

  /**
   * Handle incoming pubsub messages
   */
  handleMessage (evt) {
    const { topic, data } = evt.detail

    // Only process messages from our command topic
    if (topic !== COMMAND_TOPIC) {
      return
    }

    // Only process signed messages
    if (evt.detail.type !== 'signed') {
      console.warn('UC Extension: Ignoring unsigned command message')
      return
    }

    try {
      const messageText = new TextDecoder().decode(data)
      const message = JSON.parse(messageText)

      if (message.type === 'command') {
        this.handleCommand(message)
      }
    } catch (error) {
      console.error('UC Extension: Failed to parse command message:', error)
    }
  }

  /**
   * Handle a command request
   */
  async handleCommand (request) {
    const { command, args, requestId } = request

    console.log(`🎯 UC Extension: Received command: ${command} ${args.join(' ')}`)

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

    // If response is null, silently ignore (another peer handles this topic)
    if (response === null) {
      console.log(`⏭️  UC Extension: Ignoring command (topic mismatch)`)
      return
    }

    // Send response
    try {
      const data = new TextEncoder().encode(JSON.stringify(response))
      await this.libp2p.services.pubsub.publish(COMMAND_TOPIC, data)
      console.log(`✅ UC Extension: Sent response for ${command}`)
    } catch (error) {
      console.error('UC Extension: Failed to send response:', error)
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
