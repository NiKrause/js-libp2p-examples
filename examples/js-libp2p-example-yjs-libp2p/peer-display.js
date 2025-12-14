/**
 * Determines transport type from a remote address.
 *
 * @param {string} remoteAddr - The remote address string
 * @returns {string} Transport type identifier
 */
export function getTransportType (remoteAddr) {
  if (remoteAddr.includes('/p2p-circuit')) {
    // Check if this is a WebRTC connection over relay
    if (remoteAddr.includes('/p2p-circuit/webrtc')) {
      return 'relay-webrtc'
    }
    return 'relay'
  }
  if (remoteAddr.includes('/webrtc')) {
    // Direct WebRTC connection (not relayed)
    return 'webrtc'
  }
  if (remoteAddr.includes('/wss') || remoteAddr.includes('/tls/ws')) {
    return 'websocket-secure'
  }
  if (remoteAddr.includes('/ws')) {
    return 'websocket'
  }
  return 'unknown'
}

/**
 * Creates transport badges for a peer's connections.
 *
 * @param {Array} transports - Array of connection objects
 * @returns {HTMLElement} Container with transport badges
 */
export function createTransportBadges (transports) {
  const transportDiv = document.createElement('div')

  // Group identical transport+direction combinations and count them
  const transportGroups = new Map()
  for (const conn of transports) {
    const key = `${conn.transport}-${conn.direction}`
    if (!transportGroups.has(key)) {
      transportGroups.set(key, [])
    }
    transportGroups.get(key).push(conn)
  }

  // Show each unique transport+direction with count
  for (const conns of transportGroups.values()) {
    const { transport, direction } = conns[0]
    const badge = document.createElement('span')
    badge.className = `transport ${transport}`

    // Add direction indicator to badge text
    let directionIcon = '•'
    if (direction === 'inbound') {
      directionIcon = '←'
    } else if (direction === 'outbound') {
      directionIcon = '→'
    }
    const countText = conns.length > 1 ? ` ×${conns.length}` : ''
    badge.textContent = `${transport} ${directionIcon}${countText}`

    // Enhanced tooltip with connection details for all connections in this group
    const tooltipLines = [`${transport} (${direction}) - ${conns.length} connection(s)`, '']
    conns.forEach((conn, idx) => {
      tooltipLines.push(`Connection ${idx + 1}:`)
      tooltipLines.push(`  Address: ${conn.addr}`)
      tooltipLines.push(`  Status: ${conn.status}`)
      tooltipLines.push(`  ID: ${conn.connId}`)
      tooltipLines.push('')
    })
    badge.title = tooltipLines.join('\n')

    transportDiv.appendChild(badge)
  }

  return transportDiv
}

// Track if an update is in progress to prevent race conditions
let updateInProgress = false
let pendingUpdate = false

/**
 * Updates the peer display UI with current connections.
 *
 * @param {object} libp2pNode - The libp2p node instance
 * @param {HTMLElement} peerCountEl - Element to display peer count
 * @param {HTMLElement} peersEl - Element to show/hide peers section
 * @param {HTMLElement} peerListEl - Element to display peer list
 * @param {object} directMessageService - Direct message service instance (optional)
 * @param {Function} onPeerClick - Callback when clicking DM-capable peer (optional)
 * @param {string} chatTopic - Chat topic to filter by (optional, e.g., 'universal-connectivity')
 * @param {Map} unreadMessages - Map of peerId to unread message count (optional)
 */
export async function updatePeerDisplay (libp2pNode, peerCountEl, peersEl, peerListEl, directMessageService = null, onPeerClick = null, chatTopic = null, unreadMessages = null) {
  if (!libp2pNode) {
    return
  }
  
  // If an update is in progress, mark that we need another update and return
  if (updateInProgress) {
    pendingUpdate = true
    return
  }
  
  updateInProgress = true
  
  try {

  const connections = libp2pNode.getConnections()
  const peerMap = new Map()

  // Group connections by peer
  for (const conn of connections) {
    const peerId = conn.remotePeer.toString()
    if (!peerMap.has(peerId)) {
      peerMap.set(peerId, [])
    }

    const remoteAddr = conn.remoteAddr.toString()
    const transport = getTransportType(remoteAddr)

    // Gather connection metadata for tooltip
    const direction = conn.direction || 'unknown'
    const status = conn.status || 'unknown'
    const timeline = conn.timeline || {}
    const connId = conn.id || 'unknown'

    peerMap.get(peerId).push({
      transport,
      addr: remoteAddr,
      direction,
      status,
      connId,
      timeline
    })
  }

  // Get chat topic subscribers if filtering is enabled
  let chatSubscribers = new Set()
  if (chatTopic) {
    const subscribers = libp2pNode.services.pubsub.getSubscribers(chatTopic)
    subscribers.forEach(p => chatSubscribers.add(p.toString()))
  }

  // Batch all DM capability checks first to avoid DOM flickering
  const peerCapabilities = new Map()
  for (const [peerId] of peerMap) {
    const isDMCapable = directMessageService ? directMessageService.isDMPeer(peerId) : false
    const hasChat = chatTopic ? chatSubscribers.has(peerId) : true
    peerCapabilities.set(peerId, { isDMCapable, hasChat })
  }

  // Now build the DOM in one pass
  peerListEl.innerHTML = ''
  let displayedPeerCount = 0
  
  for (const [peerId, transports] of peerMap) {
    const { isDMCapable, hasChat } = peerCapabilities.get(peerId)
    
    // Show peer if they have chat OR DM support
    if (!hasChat && !isDMCapable) {
      continue
    }
    
    displayedPeerCount++

    const peerDiv = document.createElement('div')
    peerDiv.className = isDMCapable ? 'peer dm-capable' : 'peer no-dm'
    
    // Build tooltip with transport information
    const tooltipLines = []
    if (isDMCapable) {
      tooltipLines.push('🔐 Click to send private message')
    } else {
      tooltipLines.push('⚠️ Direct message not supported by this peer')
    }
    tooltipLines.push('')
    tooltipLines.push(`Connections (${transports.length}):`)  
    
    // Group and count transports
    const transportCounts = new Map()
    transports.forEach(t => {
      const key = `${t.transport}-${t.direction}`
      if (!transportCounts.has(key)) {
        transportCounts.set(key, { transport: t.transport, direction: t.direction, count: 0 })
      }
      transportCounts.get(key).count++
    })
    
    // Add transport info to tooltip
    transportCounts.forEach(({ transport, direction, count }) => {
      const dirIcon = direction === 'inbound' ? '←' : direction === 'outbound' ? '→' : '•'
      const countText = count > 1 ? ` ×${count}` : ''
      tooltipLines.push(`  ${transport} ${dirIcon}${countText}`)
    })
    
    peerDiv.title = tooltipLines.join('\n')

    const peerIdSpan = document.createElement('div')
    peerIdSpan.className = 'peer-id'
    const peerIdShort = peerId.slice(0, 8) + '...' + peerId.slice(-4)
    peerIdSpan.textContent = peerIdShort
    peerIdSpan.title = `${peerId}\nClick to copy full ID`
    peerIdSpan.style.cursor = 'pointer'
    peerIdSpan.onclick = (e) => {
      e.stopPropagation() // Prevent triggering peer click
      navigator.clipboard.writeText(peerId)
      const originalText = peerIdSpan.textContent
      peerIdSpan.textContent = 'Copied!'
      setTimeout(() => { peerIdSpan.textContent = originalText }, 1000)
    }
    peerDiv.appendChild(peerIdSpan)
    
    // Add unread message indicator if there are unread messages
    if (unreadMessages && unreadMessages.has(peerId)) {
      const unreadCount = unreadMessages.get(peerId)
      if (unreadCount > 0) {
        const unreadBadge = document.createElement('span')
        unreadBadge.className = 'unread-badge'
        unreadBadge.textContent = `${unreadCount} unread`
        unreadBadge.style.cssText = 'background: #ff5722; color: white; padding: 0.2rem 0.4rem; border-radius: 3px; font-size: 0.7em; margin-left: 0.5rem; font-weight: 600;'
        peerDiv.appendChild(unreadBadge)
      }
    }

    // Transport badges hidden - info only in tooltip
    // const transportDiv = createTransportBadges(transports)
    // peerDiv.appendChild(transportDiv)

    // Add click handler for DM-capable peers
    if (isDMCapable && onPeerClick) {
      peerDiv.style.cursor = 'pointer'
      peerDiv.onclick = (e) => {
        // Don't interfere with peer ID copy
        if (e.target !== peerIdSpan) {
          onPeerClick(peerId)
        }
      }
    }

    peerListEl.appendChild(peerDiv)
  }
  
  // Update count after displaying all peers
  peerCountEl.textContent = displayedPeerCount

  // Show/hide peers section
  if (displayedPeerCount > 0) {
    peersEl.style.display = 'flex'
  } else {
    peersEl.style.display = 'none'
  }
  
  } finally {
    updateInProgress = false
    
    // If there was a pending update request, run it now
    if (pendingUpdate) {
      pendingUpdate = false
      // Use setTimeout to avoid deep recursion
      setTimeout(() => {
        updatePeerDisplay(libp2pNode, peerCountEl, peersEl, peerListEl, directMessageService, onPeerClick, chatTopic, unreadMessages)
      }, 0)
    }
  }
}

/**
 * Updates the multiaddress display with current addresses.
 *
 * @param {object} libp2pNode - The libp2p node instance
 * @param {HTMLElement} multiaddrsEl - Element to show/hide multiaddrs section
 * @param {HTMLElement} multiaddrSelectEl - Select element to display addresses
 */
export function updateMultiaddrDisplay (libp2pNode, multiaddrsEl, multiaddrSelectEl) {
  if (!libp2pNode) {
    return
  }

  const multiaddrs = libp2pNode.getMultiaddrs()

  // Hide multiaddrs in new layout (technical details only)
  multiaddrsEl.style.display = 'none'

  if (multiaddrs.length > 0) {
    multiaddrSelectEl.innerHTML = ''
    for (const ma of multiaddrs) {
      const option = document.createElement('option')
      const maStr = ma.toString()

      // Add label for relay addresses
      if (maStr.includes('/p2p-circuit')) {
        option.textContent = `${maStr} (relay)`
      } else if (maStr.includes('/webrtc')) {
        option.textContent = `${maStr} (WebRTC)`
      } else if (maStr.includes('/ws')) {
        option.textContent = `${maStr} (WebSocket)`
      } else {
        option.textContent = maStr
      }

      multiaddrSelectEl.appendChild(option)
    }
  } else {
    // Show message when no addresses yet
    multiaddrSelectEl.innerHTML = '<option disabled>Waiting for addresses (relay reservation in progress...)</option>'
  }
}
